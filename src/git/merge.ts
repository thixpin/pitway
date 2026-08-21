import { git } from './exec.js';

// Thin, single-purpose Git-layer wrappers for milestone-merge (M019/T001),
// in the same style as this project's other src/git/*.ts modules -- zero
// State-layer imports.

// Always a real merge commit (--no-ff), even when the source is already a
// fast-forward -- a milestone merge is a deliberate, visible event in
// history, never silently collapsed into the target's own commit list.
// Throws (via git()'s GitError) on any failure, conflict or otherwise; the
// caller (src/core/milestones/merge.ts) is responsible for inspecting
// isMergeInProgress and recovering.
export function mergeBranches(cwd: string, sourceBranch: string, message: string): string {
  git(['merge', '--no-ff', '-m', message, sourceBranch], cwd);
  return git(['rev-parse', 'HEAD'], cwd).trim();
}

// Discards an in-progress merge (conflicted or blocked by a pre-merge-commit
// hook) and restores the working tree to its pre-merge state. Never called
// speculatively -- only after isMergeInProgress confirms MERGE_HEAD is
// actually present.
export function abortMerge(cwd: string): void {
  git(['merge', '--abort'], cwd);
}

// True when MERGE_HEAD exists and resolves to a real object -- an
// interrupted prior merge (conflicted, or blocked by a pre-merge-commit
// hook rejecting the commit; both leave MERGE_HEAD set, confirmed by
// inspection). Existence checked via exit code, never string-matching.
export function isMergeInProgress(cwd: string): boolean {
  try {
    git(['rev-parse', '--verify', '-q', 'MERGE_HEAD'], cwd);
    return true;
  } catch {
    return false;
  }
}

// Checked against a commit SHA, not a branch tip -- the milestone's own
// branch may already be deleted by the time this is asked (AC005). Exit
// code only, never string-matching: 0 means ancestor, 1 means not, and any
// other failure (e.g. an unresolvable ref) also collapses to false here --
// the caller has already validated branch/commit existence separately
// wherever that distinction matters.
export function isAncestor(cwd: string, ancestorSha: string, branch: string): boolean {
  try {
    git(['merge-base', '--is-ancestor', ancestorSha, branch], cwd);
    return true;
  } catch {
    return false;
  }
}
