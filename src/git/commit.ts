import { git, GitError } from './exec.js';

// Commits currently staged changes and returns the resulting SHA. Refuses
// to create an empty commit.
export function createCommit(cwd: string, message: string): string {
  const staged = git(['diff', '--cached', '--name-only'], cwd).trim();
  if (!staged) {
    throw new GitError('refusing to create an empty commit: nothing is staged');
  }
  git(['commit', '-m', message], cwd);
  return git(['rev-parse', 'HEAD'], cwd).trim();
}
