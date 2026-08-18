import { git, GitError } from './exec.js';
import { checkWorkingTreeClean } from './safety.js';
import { composeMessage } from './trailers.js';
import { createCommit } from './commit.js';

export interface BaselineCommitOptions {
  milestoneId: string;
  paths: string[];
}

function pathsOverlap(a: string, b: string): boolean {
  const na = a.replace(/\/+$/, '');
  const nb = b.replace(/\/+$/, '');
  return na === nb || na.startsWith(`${nb}/`) || nb.startsWith(`${na}/`);
}

// git status --porcelain collapses an entirely-untracked directory (e.g.
// ".pitway/") into a single entry, so containment must be checked in both
// directions: the dirty entry may be a parent of an intended path, not only
// a child of one.
function isWithinIntendedPaths(dirtyPath: string, paths: string[]): boolean {
  return paths.some((intended) => pathsOverlap(dirtyPath, intended));
}

// Stages only the intended milestone artifacts and creates the baseline
// commit. Distinguishes those intended paths from any unrelated dirty
// working-tree changes: an unrelated change refuses the commit and stages
// nothing, rather than being silently absorbed.
export function createBaselineCommit(cwd: string, options: BaselineCommitOptions): string {
  const { dirtyPaths } = checkWorkingTreeClean(cwd);

  const unexpected = dirtyPaths.filter((p) => !isWithinIntendedPaths(p, options.paths));
  if (unexpected.length > 0) {
    throw new GitError(
      `refusing baseline commit: unrelated dirty changes present outside the milestone artifacts: ${unexpected.join(', ')}`,
    );
  }
  if (dirtyPaths.length === 0) {
    throw new GitError('refusing to create an empty baseline commit: nothing to stage');
  }

  git(['add', '--', ...options.paths], cwd);
  const message = composeMessage(`workflow: add milestone ${options.milestoneId}`, {
    'PitWay-Milestone': options.milestoneId,
  });
  return createCommit(cwd, message);
}
