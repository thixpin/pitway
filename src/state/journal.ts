import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { parse, stringify } from 'yaml';
import { git } from '../git/exec.js';
import { resolvePitwayJournalPath } from '../git/paths.js';
import { derivePending, resolveTargetPath } from './journal-operations.js';
import { formatIssues } from './contract-file.js';
import { resolveMilestoneDirName } from './store.js';
import {
  journalFileSchema,
  type JournalAutoRun,
  type JournalBacklogAddUnscoped,
  type JournalBacklogArchive,
  type JournalCheckpoint,
  type JournalEntry,
  type JournalFile,
  type JournalMilestoneMerge,
  type JournalQuickChange,
  type JournalRecord,
  type JournalTaskVerifyEvidence,
  type JournalWorktreeDiscard,
  type JournalWorktreeDispatch,
  type JournalWorktreeIntegrate,
} from './journal-schemas.js';

export * from './journal-schemas.js';

export class JournalError extends Error {}

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

// Writes to a temp file in the same directory as `path`, then renames it
// into place. rename(2) within one directory is atomic, so a crash or kill
// mid-write can only ever leave a stray, distinctly-named temp file behind
// -- the target path itself either still holds its prior content or the
// full new content, never a torn write. The temp name embeds a random
// suffix so concurrent writers (there are none today, but nothing here
// assumes otherwise) can't collide.
function writeFileAtomic(path: string, data: string): void {
  const tmpPath = `${path}.tmp-${randomUUID()}`;
  writeFileSync(tmpPath, data);
  renameSync(tmpPath, path);
}

function saveJournalFile(cwd: string, file: JournalFile): void {
  const path = resolvePitwayJournalPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomic(path, stringify(file));
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

// Appends a task_verify_evidence record -- a full, self-contained evidence
// snapshot for one task-verify run, never a patch. Callers
// (src/core/tasks/verify.ts) compute the full field set (including
// generating the evidence id) before calling this; this function only ever
// appends what it's given, exactly like appendAutoRunRecord/
// appendQuickChangeRecord.
export function appendTaskVerifyEvidenceRecord(
  cwd: string,
  record: Omit<JournalTaskVerifyEvidence, 'kind'>,
): JournalTaskVerifyEvidence {
  const file = loadJournalFile(cwd);
  const full: JournalTaskVerifyEvidence = { kind: 'task_verify_evidence', ...record };
  const result = journalFileSchema.safeParse({ ...file, entries: [...file.entries, full] });
  if (!result.success) {
    throw new JournalError(`refusing to append invalid task_verify_evidence record: ${formatIssues(result.error)}`);
  }
  saveJournalFile(cwd, result.data);
  return full;
}

// Appends a worktree_dispatch record -- a full, self-contained snapshot of
// one task dispatch, never a patch. Callers (src/core/tasks/dispatch.ts)
// compute the full field set (including the dispatch id) before calling
// this; this function only ever appends what it's given, exactly like its
// sibling appenders above.
export function appendWorktreeDispatchRecord(
  cwd: string,
  record: Omit<JournalWorktreeDispatch, 'kind'>,
): JournalWorktreeDispatch {
  const file = loadJournalFile(cwd);
  const full: JournalWorktreeDispatch = { kind: 'worktree_dispatch', ...record };
  const result = journalFileSchema.safeParse({ ...file, entries: [...file.entries, full] });
  if (!result.success) {
    throw new JournalError(`refusing to append invalid worktree_dispatch record: ${formatIssues(result.error)}`);
  }
  saveJournalFile(cwd, result.data);
  return full;
}

// Appends a worktree_integrate record -- a full, self-contained snapshot,
// never a patch; same discipline as every sibling appender above.
export function appendWorktreeIntegrateRecord(
  cwd: string,
  record: Omit<JournalWorktreeIntegrate, 'kind'>,
): JournalWorktreeIntegrate {
  const file = loadJournalFile(cwd);
  const full: JournalWorktreeIntegrate = { kind: 'worktree_integrate', ...record };
  const result = journalFileSchema.safeParse({ ...file, entries: [...file.entries, full] });
  if (!result.success) {
    throw new JournalError(`refusing to append invalid worktree_integrate record: ${formatIssues(result.error)}`);
  }
  saveJournalFile(cwd, result.data);
  return full;
}

// Appends a worktree_discard record -- same sibling-record discipline.
export function appendWorktreeDiscardRecord(
  cwd: string,
  record: Omit<JournalWorktreeDiscard, 'kind'>,
): JournalWorktreeDiscard {
  const file = loadJournalFile(cwd);
  const full: JournalWorktreeDiscard = { kind: 'worktree_discard', ...record };
  const result = journalFileSchema.safeParse({ ...file, entries: [...file.entries, full] });
  if (!result.success) {
    throw new JournalError(`refusing to append invalid worktree_discard record: ${formatIssues(result.error)}`);
  }
  saveJournalFile(cwd, result.data);
  return full;
}

// Appends a milestone_merge record -- a full, self-contained snapshot of one
// merge outcome, never a patch; same sibling-record discipline as every
// appender above.
export function appendMilestoneMergeRecord(
  cwd: string,
  record: Omit<JournalMilestoneMerge, 'kind'>,
): JournalMilestoneMerge {
  const file = loadJournalFile(cwd);
  const full: JournalMilestoneMerge = { kind: 'milestone_merge', ...record };
  const result = journalFileSchema.safeParse({ ...file, entries: [...file.entries, full] });
  if (!result.success) {
    throw new JournalError(`refusing to append invalid milestone_merge record: ${formatIssues(result.error)}`);
  }
  saveJournalFile(cwd, result.data);
  return full;
}

// Appends a backlog_archive record -- a full, self-contained snapshot of one
// `backlog archive` outcome, never a patch; same sibling-record discipline
// as every appender above.
export function appendBacklogArchiveRecord(
  cwd: string,
  record: Omit<JournalBacklogArchive, 'kind'>,
): JournalBacklogArchive {
  const file = loadJournalFile(cwd);
  const full: JournalBacklogArchive = { kind: 'backlog_archive', ...record };
  const result = journalFileSchema.safeParse({ ...file, entries: [...file.entries, full] });
  if (!result.success) {
    throw new JournalError(`refusing to append invalid backlog_archive record: ${formatIssues(result.error)}`);
  }
  saveJournalFile(cwd, result.data);
  return full;
}

// Appends a backlog_add_unscoped record -- a full, self-contained snapshot
// of one milestone-less `backlog add` outcome, never a patch; same
// sibling-record discipline as every appender above.
export function appendBacklogAddUnscopedRecord(
  cwd: string,
  record: Omit<JournalBacklogAddUnscoped, 'kind'>,
): JournalBacklogAddUnscoped {
  const file = loadJournalFile(cwd);
  const full: JournalBacklogAddUnscoped = { kind: 'backlog_add_unscoped', ...record };
  const result = journalFileSchema.safeParse({ ...file, entries: [...file.entries, full] });
  if (!result.success) {
    throw new JournalError(`refusing to append invalid backlog_add_unscoped record: ${formatIssues(result.error)}`);
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
