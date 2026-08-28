import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import {
  readJournal,
  type JournalTaskVerifyEvidence,
  type JournalTaskVerifyFingerprintEntry,
} from '../../state/journal.js';
import type { Task } from '../../state/schemas.js';
import { TaskUpdateError } from './update-error.js';

// M039/T001: extracted verbatim from src/core/tasks/update.ts -- a responsibility split, not a redesign.

// The fixed hash value recorded for a declared path that does not exist on
// disk (moved here from verify.ts in M039/T001 so task-verify and task
// completion share one definition; verify.ts re-exports it).
export const MISSING_HASH_MARKER = 'MISSING';

// Mirrors src/core/tasks/verify.ts's own normalizeRepoRelativePath (itself a
// local copy of src/core/verification/repair.ts's convention) -- written
// locally rather than imported, matching this codebase's established
// per-task duplication of small helpers rather than a cross-task dependency
// on a sibling module for a five-line function.
export function normalizeRepoRelativePath(root: string, inputPath: string): string {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(root, inputPath);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(resolvedRoot + sep)) {
    throw new TaskUpdateError(`declared path resolves outside the repository: ${inputPath}`);
  }
  return relative(resolvedRoot, resolvedPath).split(sep).join('/');
}

// Mirrors verify.ts's buildFingerprint exactly (same declared-path sort,
// same present/missing marker logic, same MISSING_HASH_MARKER import) so a
// freshly recomputed fingerprint is directly comparable, entry-for-entry,
// against a record's persisted one.
export function buildFingerprint(root: string, declaredPaths: string[]): JournalTaskVerifyFingerprintEntry[] {
  return [...declaredPaths].sort().map((relPath) => {
    const abs = resolve(root, relPath);
    if (!existsSync(abs)) {
      return { path: relPath, state: 'missing', hash: MISSING_HASH_MARKER };
    }
    const content = readFileSync(abs);
    return {
      path: relPath,
      state: 'present',
      hash: `sha256:${createHash('sha256').update(content).digest('hex')}`,
    };
  });
}

// M030/T001 (AC001): a record's execution outcome alone, independent of
// staleness -- shared by validateTaskVerifyEvidence's pass/fail check below
// and resolveTaskVerifyEvidence's backward search, so the two never define
// "passing" differently.
export function isExecutionPassing(record: JournalTaskVerifyEvidence): boolean {
  const typecheckFailed = record.typecheck !== undefined && record.typecheck.exitCode !== 0;
  return record.terminationReason === 'exited' && record.exitCode === 0 && !typecheckFailed;
}

// Selection-then-validate (T002/AC001): validates a single already-selected
// candidate record, naming exactly what differs on any mismatch -- never
// falling back to search for an older record that happens to match.
export function validateTaskVerifyEvidence(root: string, task: Task, record: JournalTaskVerifyEvidence): void {
  if (record.taskId !== task.id) {
    throw new TaskUpdateError(
      `evidence record ${record.id} is stale: task mismatch (recorded for ${record.taskId}, current task ${task.id})`,
    );
  }
  if (!isExecutionPassing(record)) {
    const typecheckFailed = record.typecheck !== undefined && record.typecheck.exitCode !== 0;
    throw new TaskUpdateError(
      `evidence record ${record.id} represents a failing run (terminationReason=${record.terminationReason}, ` +
        `exitCode=${record.exitCode}${typecheckFailed ? `, typecheck.exitCode=${record.typecheck?.exitCode}` : ''})`,
    );
  }
  const currentAttempts = task.attempts ?? 0;
  if (record.attempts !== currentAttempts) {
    throw new TaskUpdateError(
      `evidence record ${record.id} is stale: attempt mismatch (recorded ${record.attempts}, current ${currentAttempts})`,
    );
  }
  if (record.command !== task.verification.detail) {
    throw new TaskUpdateError(
      `evidence record ${record.id} is stale: command mismatch (recorded "${record.command}", ` +
        `current "${task.verification.detail}")`,
    );
  }
  const declared = new Set(
    (task.write_scope ?? task.relevant_files ?? []).map((p) => normalizeRepoRelativePath(root, p)),
  );
  const recordPaths = new Set(record.fingerprint.entries.map((e) => e.path));
  const declaredList = [...declared].sort();
  const recordList = [...recordPaths].sort();
  if (declared.size !== recordPaths.size || declaredList.some((p, i) => p !== recordList[i])) {
    throw new TaskUpdateError(
      `evidence record ${record.id} is stale: write_scope mismatch (declared ${declaredList.join(', ')}, ` +
        `evidence covers ${recordList.join(', ')})`,
    );
  }
  const fresh = buildFingerprint(root, declaredList);
  const freshByPath = new Map(fresh.map((e) => [e.path, e]));
  for (const entry of record.fingerprint.entries) {
    const current = freshByPath.get(entry.path);
    if (current === undefined || current.hash !== entry.hash || current.state !== entry.state) {
      throw new TaskUpdateError(
        `evidence record ${record.id} is stale: fingerprint mismatch for ${entry.path} ` +
          `(recorded ${entry.state}/${entry.hash}, current ${current?.state ?? 'absent'}/${current?.hash ?? 'absent'})`,
      );
    }
  }
}

// Implicit (M030/T001, AC001): matches are searched newest-to-oldest by
// append order for the first record whose *execution* passed
// (isExecutionPassing) -- so a later execution-failing record never masks
// an earlier execution-passing one. That single candidate then undergoes
// the same validateTaskVerifyEvidence staleness check as before; a
// staleness mismatch on it still refuses immediately, citing that record --
// the backward search never crosses into staleness, it only skips
// execution-failing records. When no record's execution passed at all,
// falls through to the newest record's own failing-run error, matching
// today's behavior. Explicit (--evidence <id>): the id alone is the lookup
// key, never a milestone/task filter, and never a backward search -- an
// unknown id is its own distinct refusal, separate from a found-but-
// diverged record's mismatch refusal. No record at all (implicit, nothing
// matches; explicit, never supplied) falls through to the existing
// --result/--message path unchanged.
export function resolveTaskVerifyEvidence(
  root: string,
  milestoneId: string,
  task: Task,
  evidenceId: string | undefined,
): JournalTaskVerifyEvidence | undefined {
  const records = readJournal(root);
  const isEvidence = (r: (typeof records)[number]): r is JournalTaskVerifyEvidence =>
    r.kind === 'task_verify_evidence';

  if (evidenceId !== undefined) {
    const matches = records.filter((r) => isEvidence(r) && r.id === evidenceId) as JournalTaskVerifyEvidence[];
    const record = matches.length > 0 ? matches[matches.length - 1] : undefined;
    if (record === undefined) {
      throw new TaskUpdateError(`unknown evidence id: ${evidenceId}`);
    }
    validateTaskVerifyEvidence(root, task, record);
    return record;
  }

  const matches = records.filter(
    (r) => isEvidence(r) && r.milestone === milestoneId && r.taskId === task.id,
  ) as JournalTaskVerifyEvidence[];
  if (matches.length === 0) return undefined;

  const passing = [...matches].reverse().find(isExecutionPassing);
  // matches.length > 0 was just checked above, so the fallback index is
  // always in bounds; the non-null assertion documents that invariant for
  // noUncheckedIndexedAccess rather than widening selected's type.
  const selected = passing ?? matches[matches.length - 1]!;
  validateTaskVerifyEvidence(root, task, selected);
  return selected;
}

// AC007 (M013): evidence-honest labeling for a completed task -- there is no
// field on the task record itself distinguishing a task-verify-backed
// completion from a plain --result/--message one; provenance lives only in
// the append-only journal. True only when a task_verify_evidence record for
// this exact milestone+task carries the same evidence text now persisted in
// task.result -- proving the currently-recorded result actually came from
// that record, not merely that a verify run happened at some point.
// Deliberately does not call validateTaskVerifyEvidence -- this is a
// historical-provenance check on an already-completed task, not a
// freshness/staleness gate on a not-yet-completed one.
export function hasVerifiedEvidence(root: string, milestoneId: string, task: Task): boolean {
  if (task.result === null) return false;
  const records = readJournal(root).filter(
    (r): r is JournalTaskVerifyEvidence =>
      r.kind === 'task_verify_evidence' && r.milestone === milestoneId && r.taskId === task.id,
  );
  return records.some((r) => r.evidence === task.result!.evidence);
}
