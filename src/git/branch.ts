import { git } from './exec.js';

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
