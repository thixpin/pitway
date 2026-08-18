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
