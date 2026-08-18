import { GitError } from './exec.js';
import { checkWorkingTreeClean } from './safety.js';
import { git } from './exec.js';
import { createCommit } from './commit.js';

export interface CommitOrResumeOptions {
  // Exact file paths (repo-relative) this operation is allowed to stage.
  expectedPaths: string[];
  // Operation-specific identity: returns the SHA of this operation's own
  // commit if it already exists (see contract AC012/AC018), else undefined.
  findExistingCommit: () => string | undefined;
  // Whether local .pitway/ state already reflects this operation.
  localStateAdvanced: boolean;
  message: string;
}

export interface CommitOrResumeResult {
  outcome: 'committed' | 'already-committed';
  sha: string;
}

// Completes a state-write + commit operation deterministically, whether this
// is the first attempt or a re-entry after a failure. Never resets, stashes,
// checks out, cleans, or rewrites history — reads status/history, then at
// most performs a plain add + commit of the expected paths.
export function commitOrResume(cwd: string, options: CommitOrResumeOptions): CommitOrResumeResult {
  const existing = options.findExistingCommit();

  if (existing !== undefined) {
    if (!options.localStateAdvanced) {
      throw new GitError(
        `ambiguous state: commit ${existing} already matches this operation but local state does not reflect it; inspect manually`,
      );
    }
    return { outcome: 'already-committed', sha: existing };
  }

  const { dirtyPaths } = checkWorkingTreeClean(cwd);
  const expected = new Set(options.expectedPaths);
  const unexpected = dirtyPaths.filter((p) => !expected.has(p));
  if (unexpected.length > 0) {
    throw new GitError(
      `cannot safely proceed: unrelated dirty changes present: ${unexpected.join(', ')}`,
    );
  }
  if (dirtyPaths.length === 0) {
    throw new GitError('refusing to create an empty commit: nothing to stage');
  }

  // Stage the dirty subset (already validated ⊆ expected): expected paths
  // that are currently clean or absent must not produce pathspec errors.
  git(['add', '--', ...dirtyPaths], cwd);
  const sha = createCommit(cwd, options.message);
  return { outcome: 'committed', sha };
}
