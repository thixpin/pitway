import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { relative, resolve, sep } from 'node:path';
import { git } from '../../git/exec.js';
import { checkWorkingTreeClean, classifyDirtyPaths } from '../../git/safety.js';
import { resolvePendingJournalTargets } from '../journal/pending-targets.js';
import {
  appendTaskVerifyEvidenceRecord,
  type JournalTaskVerifyEvidence,
  type JournalTaskVerifyFingerprintEntry,
} from '../../state/journal.js';
import type { Task } from '../../state/schemas.js';
import { loadState, loadTasks, resolveMilestoneDirName } from '../../state/store.js';
import { DEFAULT_TIMEOUT_MS, executeCommand } from '../verification/process-exec.js';
import { trimTail } from '../verification/text-trim.js';
import { buildEvidence, parseTestCounts } from '../verification/failure-evidence.js';

export class TaskVerifyError extends Error {}

export interface RunTaskVerifyInputs {
  typecheckCommand?: string;
  // M029/T001 (AC001): optional explicit budget for both the verification
  // command and the typecheck. Default stays DEFAULT_TIMEOUT_MS (120000ms);
  // bounds mirror the contract check-timeout schema (1s..1h).
  timeoutMs?: number;
}

// Fixed, documented marker for a declared path that does not exist on disk
// at fingerprint time -- never skipped, never thrown. This is what makes a
// rename representable without any dedicated pairing logic: the old half of
// a rename fingerprints via this marker, the new half fingerprints its real
// content, and both are just ordinary entries in the same array.
// M039: the marker and buildFingerprint live in ./evidence.ts, shared with
// task completion; the marker is re-exported here for existing importers.
export { MISSING_HASH_MARKER } from './evidence.js';
import { buildFingerprint } from './evidence.js';

function resolveActiveMilestone(root: string): string {
  const state = loadState(root);
  if (!state.active_milestone) {
    throw new TaskVerifyError('no active milestone; run milestone-add first');
  }
  return state.active_milestone;
}

function findTask(tasks: Task[], id: string): Task {
  const task = tasks.find((t) => t.id === id);
  if (!task) throw new TaskVerifyError(`task ${id} not found`);
  return task;
}

// Mirrors src/core/verification/repair.ts's normalizeRepoRelativePath (and
// src/core/quick-change/create.ts's own copy of the same convention) --
// written locally rather than imported, to avoid a cross-task dependency on
// a sibling module for a five-line helper.
function normalizeRepoRelativePath(root: string, inputPath: string): string {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(root, inputPath);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(resolvedRoot + sep)) {
    throw new TaskVerifyError(`declared path resolves outside the repository: ${inputPath}`);
  }
  return relative(resolvedRoot, resolvedPath).split(sep).join('/');
}

// Directory names are assigned once at creation and never renamed, so
// resolving against the current on-disk listing is correct here too --
// mirrors completeTask's own tasksRepoPath (src/core/tasks/update.ts),
// written locally to avoid a cross-task dependency on that sibling module.
const tasksRepoPath = (root: string, milestoneId: string): string =>
  `.pitway/milestones/${resolveMilestoneDirName(root, milestoneId)}/tasks.yaml`;

// git check-ignore's own exit code IS its answer (0 = ignored, 1 = not
// ignored) -- unlike every other git subcommand this codebase calls through
// the shared git() helper (src/git/exec.ts), which throws on any non-zero
// exit. Called directly via execFileSync so a real "not ignored" (status 1)
// is distinguished from a genuine error (anything else, including a missing
// git binary or a non-repo cwd).
function isGitIgnored(root: string, relPath: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', relPath], { cwd: root, stdio: 'pipe' });
    return true;
  } catch (error) {
    const status = (error as { status?: number | null }).status;
    if (status === 1) return false;
    throw new TaskVerifyError(`git check-ignore failed for ${relPath}: ${(error as Error).message}`);
  }
}

// Each declared path fingerprints independently from its own real on-disk
// state -- present -> sha256 of real file bytes, missing -> the fixed
// MISSING_HASH_MARKER. Sorted for a deterministic, order-independent
// comparison (AC001: write_scope declared in a different order still
// fingerprints identically). M039/T002: ONE implementation, in
// ./evidence.ts -- the same function task completion recomputes with, so a
// recorded fingerprint and a fresh one can never drift apart.

// git status --porcelain's own status code for one dirty path, used only to
// build a precise refusal diagnostic -- never to classify expected/
// unexpected (that stays exactly checkWorkingTreeClean's dirtyPaths).
function describeStatusCode(code: string): string {
  if (code === '??') return 'untracked';
  if (code.includes('D')) return 'deleted';
  if (code.includes('R')) return 'renamed';
  if (code.includes('A')) return 'added';
  if (code.includes('M')) return 'modified';
  return 'changed';
}

function describeDirtyPaths(root: string, paths: string[]): string {
  const raw = git(['status', '--porcelain', '--untracked-files=all'], root);
  const codeByPath = new Map<string, string>();
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue;
    codeByPath.set(line.slice(3).trim(), line.slice(0, 2));
  }
  return paths.map((p) => `${p} (${describeStatusCode(codeByPath.get(p) ?? '')})`).join(', ');
}

// Mirrors completeTask's own assertDirtySubset (src/core/tasks/update.ts) --
// written locally to avoid a cross-task dependency -- but with a precise
// diagnostic: each offending path is named alongside its git status, noting
// that an incompletely-declared rename is a likely cause when a path shows
// deleted or untracked (the exact signature a one-sided rename leaves,
// since git status --porcelain never reports an unstaged worktree rename as
// a paired entry -- only a separate delete and a separate untracked add).
function assertDirtySubset(root: string, expectedPaths: string[]): void {
  const expected = new Set(expectedPaths);
  const unexpected = checkWorkingTreeClean(root).dirtyPaths.filter((p) => !expected.has(p));
  if (unexpected.length === 0) return;
  throw new TaskVerifyError(
    `cannot verify: unrelated dirty changes present: ${describeDirtyPaths(root, unexpected)} ` +
      `(a path shown as deleted or untracked here often means an incompletely-declared rename -- ` +
      `declare both the old and new path in write_scope)`,
  );
}

function generateEvidenceId(): string {
  return `tve-${randomBytes(6).toString('hex')}`;
}

// M017/T004 (AC004) kept buildEvidence and parseTestCounts as private copies
// here because run.ts and this file were independent call sites with no
// shared evidence-building module in that task's write_scope. M048/T001
// reversed that: both call sites now consume failure-evidence.ts, and this
// one relies on the shared buildEvidence's default '(no output)' fallback.

// Task-verify evidence engine (no CLI yet): executes a task's own
// verification command (and, optionally, a typecheck command) against an
// in_progress command/tdd task, refusing anything else, and persists a full
// evidence record to the journal (src/state/journal.ts's
// appendTaskVerifyEvidenceRecord) -- never a commit of its own.
//
// Two distinct safety mechanisms, never conflated:
// - The fingerprint (buildFingerprint) covers exactly the task's own
//   declared write_scope/relevant_files paths, nothing more.
// - The dirty-path allowance (assertDirtySubset) is a separate, broader
//   check on the whole working tree -- declared paths + this milestone's
//   own tasks.yaml + any real pending journal-backed path -- refusing
//   anything outside it before the command ever runs.
export function runTaskVerify(
  root: string,
  taskId: string,
  inputs: RunTaskVerifyInputs = {},
): JournalTaskVerifyEvidence {
  let explicitTimeoutMs: number | undefined;
  if (inputs.timeoutMs !== undefined) {
    const t = inputs.timeoutMs;
    if (!Number.isInteger(t) || t < 1000 || t > 3_600_000) {
      throw new TaskVerifyError(
        `invalid --timeout ${inputs.timeoutMs}: must be an integer between 1000 and 3600000 ms`,
      );
    }
    explicitTimeoutMs = t;
  }

  const milestoneId = resolveActiveMilestone(root);
  const tasksFile = loadTasks(root, milestoneId);
  const task = findTask(tasksFile.tasks, taskId);

  if (task.status !== 'in_progress') {
    throw new TaskVerifyError(`cannot verify ${taskId}: status is "${task.status}", not in_progress`);
  }
  if (task.verification.strategy !== 'command' && task.verification.strategy !== 'tdd') {
    throw new TaskVerifyError(
      `cannot verify ${taskId}: verification.strategy is "${task.verification.strategy}" -- ` +
        `task-verify only runs command or tdd strategies (manual/review checks are developer-recorded)`,
    );
  }

  const declaredPaths = [
    ...new Set((task.write_scope ?? task.relevant_files ?? []).map((p) => normalizeRepoRelativePath(root, p))),
  ];

  for (const path of declaredPaths) {
    if (isGitIgnored(root, path)) {
      throw new TaskVerifyError(`cannot verify ${taskId}: declared path ${path} is git-ignored`);
    }
  }

  const journalExpected = classifyDirtyPaths(root, { journalTargetPaths: resolvePendingJournalTargets(root, milestoneId) }).expected;
  const allowedPaths = [...new Set([...declaredPaths, tasksRepoPath(root, milestoneId), ...journalExpected])];
  assertDirtySubset(root, allowedPaths);

  const fingerprint = { entries: buildFingerprint(root, declaredPaths) };

  // M045/T001 (W1): explicit --timeout wins; else the task's own declared
  // verification.timeout_ms; else the documented default.
  const timeoutMs = explicitTimeoutMs ?? task.verification.timeout_ms ?? DEFAULT_TIMEOUT_MS;

  const start = Date.now();
  const result = executeCommand(task.verification.detail, { cwd: root, timeoutMs });
  const durationMs = Date.now() - start;
  const combined = `${result.stdout}${result.stderr}`;
  const counts = parseTestCounts(combined);
  const failed = !(result.terminationReason === 'exited' && result.exitCode === 0);
  const evidence = buildEvidence(combined, failed);

  let typecheck: JournalTaskVerifyEvidence['typecheck'];
  if (inputs.typecheckCommand !== undefined) {
    const tcResult = executeCommand(inputs.typecheckCommand, { cwd: root, timeoutMs });
    typecheck = {
      command: inputs.typecheckCommand,
      exitCode: tcResult.exitCode,
      evidence: trimTail(`${tcResult.stdout}${tcResult.stderr}`),
    };
  }

  return appendTaskVerifyEvidenceRecord(root, {
    id: generateEvidenceId(),
    milestone: milestoneId,
    taskId: task.id,
    attempts: task.attempts ?? 0,
    command: task.verification.detail,
    exitCode: result.exitCode,
    ...(counts.passCount !== undefined ? { passCount: counts.passCount } : {}),
    ...(counts.failCount !== undefined ? { failCount: counts.failCount } : {}),
    evidence,
    durationMs,
    terminationReason: result.terminationReason,
    ...(typecheck !== undefined ? { typecheck } : {}),
    fingerprint,
    at: new Date().toISOString(),
  });
}
