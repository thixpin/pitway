import { execFileSync } from 'node:child_process';

export class GitError extends Error {}

export function git(args: string[], cwd: string): string {
  try {
    return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim();
    throw new GitError(stderr || (error as Error).message);
  }
}

export function assertGitWorkTree(cwd: string): void {
  try {
    const output = git(['rev-parse', '--is-inside-work-tree'], cwd).trim();
    if (output !== 'true') {
      throw new GitError(`${cwd} is not a git work tree`);
    }
  } catch (error) {
    if (error instanceof GitError) {
      throw new GitError(`${cwd} is not a git work tree (git repository required): ${error.message}`);
    }
    throw error;
  }
}
