import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import { git } from '../git/exec.js';
import { resolvePitwayJournalPath } from '../git/paths.js';
import { derivePending, resolveTargetPath } from '../core/journal/operations.js';
import { formatIssues } from './contract-file.js';
import { resolveMilestoneDirName } from './store.js';

export class JournalError extends Error {}

// Journal-local schemas (M005 T001): append-only, git-invisible log of
// pending state-changing operations (usage recordings, contract/task
// amendments) awaiting a checkpoint commit. task_transition and
// verification_result are deliberately excluded — this schema's type enum
// is the enforcement point. Defined here rather than in state/schemas.ts:
// nothing outside this module depends on these types yet, and keeping them
// local avoids widening this task's write scope onto the shared schemas
// file for schema additions no other module currently needs.
const journalMilestoneId = z.string().regex(/^M\d{3}$/, 'milestone id must match M000');

export const journalOperationTypeSchema = z.enum([
  'usage_recording',
  'contract_amendment',
  'task_amendment',
]);

export const journalEntrySchema = z.strictObject({
  kind: z.literal('entry'),
  milestone: journalMilestoneId,
  type: journalOperationTypeSchema,
  operationId: z.string().min(1),
  target: z.string().min(1).optional(),
  payload: z.record(z.string(), z.unknown()),
});

// Marks an entry as checkpointed by a commit; never replaces or removes the
// original entry. More than one marker may reference the same commitSha
// (a single commit can fold in multiple pending operations).
export const journalCheckpointSchema = z.strictObject({
  kind: z.literal('checkpoint'),
  milestone: journalMilestoneId,
  entryOperationId: z.string().min(1),
  commitSha: z.string().min(1),
});

export const journalRecordSchema = z.discriminatedUnion('kind', [
  journalEntrySchema,
  journalCheckpointSchema,
]);

export const journalFileSchema = z.strictObject({
  schema_version: z.literal(1),
  entries: z.array(journalRecordSchema),
});

export type JournalOperationType = z.infer<typeof journalOperationTypeSchema>;
export type JournalEntry = z.infer<typeof journalEntrySchema>;
export type JournalCheckpoint = z.infer<typeof journalCheckpointSchema>;
export type JournalRecord = z.infer<typeof journalRecordSchema>;
export type JournalFile = z.infer<typeof journalFileSchema>;

function loadJournalFile(cwd: string): JournalFile {
  const path = resolvePitwayJournalPath(cwd);
  if (!existsSync(path)) {
    return { schema_version: 1, entries: [] };
  }
  const text = readFileSync(path, 'utf8');
  let data: unknown;
  try {
    data = parse(text);
  } catch (error) {
    throw new JournalError(`malformed YAML in ${path}: ${(error as Error).message}`);
  }
  const result = journalFileSchema.safeParse(data);
  if (!result.success) {
    throw new JournalError(`invalid ${path}: ${formatIssues(result.error)}`);
  }
  return result.data;
}

function saveJournalFile(cwd: string, file: JournalFile): void {
  const path = resolvePitwayJournalPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stringify(file));
}

// Returns every raw journal record (entries and checkpoint markers), oldest
// first. Never appears in `git status` — the file lives inside the
// git-private directory (resolved via resolvePitwayJournalPath), never in
// the working tree.
export function readJournal(cwd: string): JournalRecord[] {
  return loadJournalFile(cwd).entries;
}

// Append-only: reads the current array, pushes the new entry, rewrites the
// whole file (same pattern as every other PitWay append-only state file,
// e.g. verification-results.yaml). Never clears or overwrites prior
// entries.
export function appendJournalEntry(cwd: string, entry: Omit<JournalEntry, 'kind'>): JournalEntry {
  const file = loadJournalFile(cwd);
  const record: JournalEntry = { kind: 'entry', ...entry };
  const result = journalFileSchema.safeParse({ ...file, entries: [...file.entries, record] });
  if (!result.success) {
    throw new JournalError(`refusing to append invalid journal entry: ${formatIssues(result.error)}`);
  }
  saveJournalFile(cwd, result.data);
  return record;
}

// Appends a checkpoint marker referencing an existing entry's operationId
// and the commit SHA that captured it. Never deletes or mutates the
// original entry. More than one marker may reference the same commitSha
// (a single commit can fold in multiple pending operations).
export function appendCheckpointMarker(
  cwd: string,
  milestone: string,
  entryOperationId: string,
  commitSha: string,
): JournalCheckpoint {
  const file = loadJournalFile(cwd);
  const record: JournalCheckpoint = { kind: 'checkpoint', milestone, entryOperationId, commitSha };
  const result = journalFileSchema.safeParse({ ...file, entries: [...file.entries, record] });
  if (!result.success) {
    throw new JournalError(`refusing to append invalid checkpoint marker: ${formatIssues(result.error)}`);
  }
  saveJournalFile(cwd, result.data);
  return record;
}

// HEAD carries the PitWay-Milestone trailer this milestone would produce on
// either a task-completion commit (which also carries PitWay-Task) or a
// milestone-terminal commit — mirrors the trailer-matching convention in
// src/git/trailers.ts's resolveCommitSha, applied to HEAD specifically.
function headIsPitwayCheckpoint(cwd: string, milestone: string): boolean {
  const body = git(['log', '-1', '--format=%B', 'HEAD'], cwd);
  const lines = body.split('\n').map((l) => l.trim());
  return lines.includes(`PitWay-Milestone: ${milestone}`);
}

// Self-healing crash recovery: if a checkpoint commit for `milestone`
// actually happened (HEAD carries the right trailer and a pending entry's
// target file matches, byte-for-byte, what that commit put at HEAD) but the
// process crashed before appending the marker, this reuses the existing
// commit-identity-lookup pattern (checking HEAD's trailers, then comparing
// committed content) to append the missing marker instead of re-applying
// the change or leaving it stuck pending. Idempotent: entries that already
// have a marker are skipped by derivePending on every call.
export function reconcilePending(cwd: string, milestone: string): JournalCheckpoint[] {
  const file = loadJournalFile(cwd);
  const pending = derivePending(file.entries).filter((e) => e.milestone === milestone);
  if (pending.length === 0) return [];

  let head: string;
  try {
    head = git(['rev-parse', 'HEAD'], cwd).trim();
  } catch {
    return [];
  }
  if (!headIsPitwayCheckpoint(cwd, milestone)) return [];

  let milestoneDir: string;
  try {
    milestoneDir = resolveMilestoneDirName(cwd, milestone);
  } catch {
    // Directory not (yet, or ambiguously) resolvable — every entry stays
    // genuinely pending rather than throwing out of a reconciliation call
    // that other code paths invoke defensively after every commit.
    return [];
  }

  const created: JournalCheckpoint[] = [];
  for (const entry of pending) {
    const relTarget = resolveTargetPath(entry, milestoneDir);
    const absTarget = resolve(cwd, relTarget);

    let onDisk: string;
    try {
      onDisk = readFileSync(absTarget, 'utf8');
    } catch {
      continue; // target file doesn't exist on disk — genuinely still pending
    }

    let atHead: string;
    try {
      atHead = git(['show', `HEAD:${relTarget}`], cwd);
    } catch {
      continue; // target file wasn't committed at HEAD — genuinely still pending
    }

    if (onDisk !== atHead) continue; // not yet committed to match — genuinely still pending

    created.push(appendCheckpointMarker(cwd, milestone, entry.operationId, head));
  }
  return created;
}
