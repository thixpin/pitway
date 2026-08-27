import { assertGitWorkTree, git, GitError } from './exec.js';

export { GitError };

export interface WorkingTreeStatus {
  clean: boolean;
  dirtyPaths: string[];
}

// Read-only: reports status without modifying, staging, stashing, or
// resetting anything.
export function checkWorkingTreeClean(cwd: string): WorkingTreeStatus {
  assertGitWorkTree(cwd);
  // --untracked-files=all lists every untracked file individually instead of
  // collapsing a fully-untracked directory into one entry, so a stray file
  // mixed into an intended directory can still be distinguished as dirty.
  const output = git(['status', '--porcelain', '--untracked-files=all'], cwd);
  const dirtyPaths = output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3).trim());
  return { clean: dirtyPaths.length === 0, dirtyPaths };
}

export interface DirtyPathClassification {
  expected: string[];
  unexpected: string[];
}

export interface ClassifyDirtyPathsOptions {
  // The current in_progress task's declared write scope. Only contributes
  // to "expected" when verifiedCleanStart is true — declaring a path here
  // grants no expectation by itself.
  taskWriteScope?: string[];
  // Whether the in_progress task itself began from a verified clean tree
  // (the existing invariant, unchanged). Without this, write_scope alone
  // never grants expectation.
  verifiedCleanStart?: boolean;
  // Repo-relative paths already known to be an ordinary pending
  // task_transition/verification_result write (e.g. the active milestone's
  // tasks.yaml / verification-results.yaml). Always expected, independent
  // of taskWriteScope/verifiedCleanStart.
  pendingTransitionPaths?: string[];
  // Repo-relative target files of the active milestone's pending journal
  // entries, already resolved by the caller (Core's
  // resolvePendingJournalTargets in src/core/journal/pending-targets.ts).
  // Always expected, independent of taskWriteScope/verifiedCleanStart.
  // This module never reads the journal itself (M038/T002): it stays a
  // pure Git classification layer fed from above.
  journalTargetPaths?: string[];
}

// Classifies each path reported by checkWorkingTreeClean as expected or
// unexpected, given what the caller knows about the current task and
// pending state writes. This function only classifies — it does not read,
// modify, stage, stash, or reset anything beyond the read-only git status
// check performed by checkWorkingTreeClean.
//
// Semantics (binding, do not weaken):
// - A path is expected from taskWriteScope only when verifiedCleanStart is
//   true. Declaring a path in write_scope grants no expectation by itself —
//   the task must have actually started from a verified clean tree for its
//   write scope to mean anything.
// - A path is expected when it appears in pendingTransitionPaths (an
//   ordinary pending task_transition/verification_result write) or in
//   journalTargetPaths (the target file of a pending journal entry, T001,
//   resolved by the caller) — both regardless of taskWriteScope/
//   verifiedCleanStart.
// - Everything else is unexpected.
//
// Known limitation, disclosed rather than hidden: classification works by
// path alone. If a developer edits a file that is also in the in_progress
// task's write_scope while the task is running (after a verified clean
// start), PitWay cannot distinguish that concurrent developer edit from the
// task's own edit — both are classified expected. This is an accepted
// limitation of path-based classification, not a bug; see the
// concurrent-edit test in tests/unit/git-safety.test.ts.
export function classifyDirtyPaths(
  cwd: string,
  options: ClassifyDirtyPathsOptions,
): DirtyPathClassification {
  const { dirtyPaths } = checkWorkingTreeClean(cwd);
  const writeScope = new Set(options.taskWriteScope ?? []);
  const pendingTransitionPaths = new Set(options.pendingTransitionPaths ?? []);

  const journalTargets = new Set(options.journalTargetPaths ?? []);

  const expected: string[] = [];
  const unexpected: string[] = [];

  for (const path of dirtyPaths) {
    const expectedFromWriteScope = options.verifiedCleanStart === true && writeScope.has(path);
    const expectedFromPendingTransition = pendingTransitionPaths.has(path);
    const expectedFromJournal = journalTargets.has(path);

    if (expectedFromWriteScope || expectedFromPendingTransition || expectedFromJournal) {
      expected.push(path);
    } else {
      unexpected.push(path);
    }
  }

  return { expected, unexpected };
}
