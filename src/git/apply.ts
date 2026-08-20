import { execFileSync } from 'node:child_process';
import { GitError } from './exec.js';

// AC006/T006 (M014): pinned diff/apply mechanics for worktree integration.
// The diff is always the range diff `--binary --no-renames <base>..<head>`:
// --binary so binary files integrate correctly instead of emitting an
// unappliable stub, --no-renames so deletions/additions are listed plainly
// for exact-path scope checking; a multi-commit worker branch integrates as
// one combined diff by construction of the range.

const DIFF_FLAGS = ['--binary', '--no-renames'];

function gitWithInput(args: string[], cwd: string, input?: string): string {
  try {
    return execFileSync('git', args, { cwd, stdio: 'pipe', input }).toString();
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim();
    throw new GitError(stderr || (error as Error).message);
  }
}

export function computeRangeDiff(cwd: string, base: string, head: string): string {
  return gitWithInput(['diff', ...DIFF_FLAGS, `${base}..${head}`], cwd);
}

// Changed paths for the same range, deletions included -- exact repo-relative
// paths, matching the exact-string semantics of write-scope checking.
export function listChangedPaths(cwd: string, base: string, head: string): string[] {
  return gitWithInput(['diff', '--name-only', '--no-renames', `${base}..${head}`], cwd)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

// Pre-checks without writing anything: a failed check leaves the tree
// byte-identical, which is what makes integrate's refusal atomic.
export function diffApplies(cwd: string, diff: string): boolean {
  try {
    gitWithInput(['apply', '--check', '-'], cwd, diff);
    return true;
  } catch {
    return false;
  }
}

// True when the tree already contains exactly this diff's result (forward
// check fails, reverse succeeds) -- the applied-but-unrecorded crash-window
// detector for integrate's idempotent re-run.
export function diffReverseApplies(cwd: string, diff: string): boolean {
  try {
    gitWithInput(['apply', '--check', '--reverse', '-'], cwd, diff);
    return true;
  } catch {
    return false;
  }
}

export function applyDiff(cwd: string, diff: string): void {
  gitWithInput(['apply', '-'], cwd, diff);
}
