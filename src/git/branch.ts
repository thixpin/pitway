import { git, GitError } from './exec.js';

// Thin, single-purpose Git-layer wrappers, in the same style as this
// project's other src/git/*.ts modules -- zero State-layer imports.

export function currentBranch(cwd: string): string {
  return git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).trim();
}

export function currentRevision(cwd: string): string {
  return git(['rev-parse', 'HEAD'], cwd).trim();
}

// Existence checked via exit code (git show-ref --verify --quiet), never by
// string-matching command output.
export function branchExists(cwd: string, name: string): boolean {
  try {
    git(['show-ref', '--verify', '--quiet', `refs/heads/${name}`], cwd);
    return true;
  } catch {
    return false;
  }
}

export function createAndCheckoutBranch(cwd: string, name: string): void {
  git(['checkout', '-b', name], cwd);
}

// AC003/T003 (M012): the one shared guard, wired into every commit-producing
// operation for an active milestone-strategy milestone. A no-op when no
// branch is tracked (main strategy, or an untracked milestone) -- callers
// pass null in that case rather than this module re-deriving strategy
// itself (this module stays free of any State-layer import). Never
// auto-checks-out to correct a mismatch -- that is a human decision.
export function assertOnMilestoneBranch(cwd: string, expectedBranchName: string | null): void {
  if (expectedBranchName === null) return;
  const actual = currentBranch(cwd);
  if (actual !== expectedBranchName) {
    throw new GitError(
      `expected branch ${expectedBranchName} to be checked out, found ${actual}`,
    );
  }
}
