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

// Sibling third member of the discriminated union (M005 T005): records an
// auto-run authorization decision. Never referenced by a checkpoint marker
// -- there is no target state file for one to check against -- and never
// folded into a commit. `action: 'enable'` is never a 4th value of
// journalOperationTypeSchema's operation-type enum; it's a field on a wholly
// separate top-level `kind`. `hash` records the milestone's
// verification_approved_hash at the moment of an `enable`; a `disable`
// record carries no hash. See src/core/journal/auto-run.ts's
// isAutoRunAuthorized for how authorization is derived, purely, from these
// records' position in the existing log order.
export const journalAutoRunSchema = z.strictObject({
  kind: z.literal('auto_run'),
  milestone: journalMilestoneId,
  action: z.enum(['enable', 'disable']),
  hash: z.string().min(1).optional(),
});

// Fourth sibling member of the discriminated union (M007/T003): records one
// step of a quick-change's draft -> approved -> committed lifecycle (plus
// draft|approved -> cancelled and approved -> promoted). Like auto_run, this
// is never referenced by a checkpoint marker and never folded into a
// milestone commit -- there is no target state file for resolveTargetPath to
// map it to, and derivePending's `kind === 'entry'` filter already excludes
// it structurally, the same way it already excludes auto_run.
//
// Storage decision (documented per T003's brief): appendJournalEntry/
// appendCheckpointMarker/appendAutoRunRecord only ever APPEND; none of them
// mutate an existing record. A quick-change's lifecycle needs to move
// through several states over time, so every transition (create, approve, a
// run attempt, cancel, promote) appends a NEW quick_change record carrying
// the change's id and its full current field set -- never a partial patch.
// "Current state" is derived by folding over every record sharing that id,
// in append order, and taking the latest one (see deriveQuickChangeState in
// src/core/quick-change/create.ts, mirroring isAutoRunAuthorized's
// pure-derivation-over-record-order style). `runs` is itself append-only
// within each snapshot -- a later record's `runs` array is always the prior
// one plus zero or one newly appended attempt, never shorter -- which is how
// "every quick-change run attempt, pass or fail, is preserved" holds even
// though the underlying journal file only ever appends whole records.
export const journalQuickChangeStatusSchema = z.enum([
  'draft',
  'approved',
  'committed',
  'cancelled',
  'promoted',
]);

export const journalQuickChangeRunSchema = z.strictObject({
  at: z.string().min(1),
  status: z.enum(['pass', 'fail']),
  evidence: z.string().min(1),
});

export const journalQuickChangeSchema = z.strictObject({
  kind: z.literal('quick_change'),
  id: z.string().min(1),
  status: journalQuickChangeStatusSchema,
  objective: z.string().min(1),
  // The exact file census declared at create time -- locked (never
  // widened/narrowed) once approvedHash is set at approve.
  scope: z.array(z.string().min(1)),
  verifyCommand: z.string().min(1),
  // Set once approved: sha256 over {scope, verifyCommand} exactly as
  // declared at create. Absent on a still-draft record. Gates `quick-change
  // run` (T004's job) the same way verification_approved_hash gates
  // `pitway verify` today.
  approvedHash: z.string().min(1).optional(),
  runs: z.array(journalQuickChangeRunSchema),
});

export const journalRecordSchema = z.discriminatedUnion('kind', [
  journalEntrySchema,
  journalCheckpointSchema,
  journalAutoRunSchema,
  journalQuickChangeSchema,
]);

export const journalFileSchema = z.strictObject({
  schema_version: z.literal(1),
  entries: z.array(journalRecordSchema),
});

export type JournalOperationType = z.infer<typeof journalOperationTypeSchema>;
export type JournalEntry = z.infer<typeof journalEntrySchema>;
export type JournalCheckpoint = z.infer<typeof journalCheckpointSchema>;
export type JournalAutoRun = z.infer<typeof journalAutoRunSchema>;
export type JournalQuickChangeStatus = z.infer<typeof journalQuickChangeStatusSchema>;
export type JournalQuickChangeRun = z.infer<typeof journalQuickChangeRunSchema>;
export type JournalQuickChange = z.infer<typeof journalQuickChangeSchema>;
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

// Appends an auto_run authorization record -- enable or disable -- as a
// sibling record kind, never a checkpoint-eligible entry. Idempotency and
// authorization derivation are the caller's job (isAutoRunAuthorized in
// src/core/journal/auto-run.ts, a pure function over already-read records);
// this function only ever appends what it's given.
export function appendAutoRunRecord(
  cwd: string,
  record: Omit<JournalAutoRun, 'kind'>,
): JournalAutoRun {
  const file = loadJournalFile(cwd);
  const full: JournalAutoRun = { kind: 'auto_run', ...record };
  const result = journalFileSchema.safeParse({ ...file, entries: [...file.entries, full] });
  if (!result.success) {
    throw new JournalError(`refusing to append invalid auto_run record: ${formatIssues(result.error)}`);
  }
  saveJournalFile(cwd, result.data);
  return full;
}

// Appends a quick_change lifecycle snapshot -- a full record, never a patch.
// Callers (src/core/quick-change/create.ts) are responsible for computing the
// next full field set (carrying forward runs/approvedHash/etc. as
// appropriate) before calling this; this function only ever appends what
// it's given, exactly like appendAutoRunRecord.
export function appendQuickChangeRecord(
  cwd: string,
  record: Omit<JournalQuickChange, 'kind'>,
): JournalQuickChange {
  const file = loadJournalFile(cwd);
  const full: JournalQuickChange = { kind: 'quick_change', ...record };
  const result = journalFileSchema.safeParse({ ...file, entries: [...file.entries, full] });
  if (!result.success) {
    throw new JournalError(`refusing to append invalid quick_change record: ${formatIssues(result.error)}`);
  }
  saveJournalFile(cwd, result.data);
  return full;
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
