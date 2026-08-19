import { resolve } from 'node:path';
import { git } from './exec.js';

// Resolves the absolute path to PitWay's runtime journal file, delegating
// entirely to git to locate the private git directory — this is what makes
// it correct for a linked worktree (`.git` is a file pointing elsewhere):
// `git rev-parse --git-path` already resolves that indirection for us.
// `--git-path` output is relative to `cwd`, so it's resolved to absolute
// here rather than being treated as repo-root-relative.
export function resolvePitwayJournalPath(cwd: string): string {
  const output = git(['rev-parse', '--git-path', 'pitway/journal.yaml'], cwd).trim();
  return resolve(cwd, output);
}

// Resolves the canonical absolute path to git's own private directory for
// cwd -- the repo-identity anchor for the verification recursion guard (see
// src/core/verification/recursion-guard.ts). `--absolute-git-dir` already
// returns an absolute, canonicalized path, so unlike resolvePitwayJournalPath
// above there is no cwd-relative output to resolve. Using git's own
// resolution (rather than cwd itself) keeps identity correct across linked
// worktrees, where multiple worktrees share one git-dir and therefore must
// share one recursion-guard identity.
export function resolveCanonicalGitDir(cwd: string): string {
  return git(['rev-parse', '--absolute-git-dir'], cwd).trim();
}
