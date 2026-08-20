import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveCommitSha } from '../../src/git/trailers.js';
import { GitError } from '../../src/git/exec.js';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

function commit(repo: string, file: string, message: string): string {
  writeFileSync(join(repo, file), `${Date.now()}-${Math.random()}\n`);
  git(['add', file], repo);
  git(['commit', '-q', '-m', message], repo);
  return git(['rev-parse', 'HEAD'], repo).trim();
}

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'pitway-trailers-since-'));
  git(['init', '-q'], repo);
  git(['config', 'user.email', 'test@example.com'], repo);
  git(['config', 'user.name', 'Test'], repo);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

// AC005/T005 (M012): resolveCommitSha's optional range-scoping parameter.
describe('resolveCommitSha with since (M012/T005)', () => {
  it('finds the right commit when the range genuinely contains it', () => {
    const base = commit(repo, 'seed.txt', 'seed');
    const target = commit(repo, 'a.txt', 'workflow: add milestone M002\n\nPitWay-Milestone: M002\n');
    expect(resolveCommitSha(repo, { milestone: 'M002', since: base })).toBe(target);
  });

  it('returns undefined when the target commit exists but falls outside the given range (the bound is real, not a no-op)', () => {
    commit(repo, 'a.txt', 'workflow: add milestone M002\n\nPitWay-Milestone: M002\n');
    // A range starting at HEAD excludes everything before and including it.
    const afterEverything = git(['rev-parse', 'HEAD'], repo).trim();
    commit(repo, 'b.txt', 'chore: unrelated');
    expect(resolveCommitSha(repo, { milestone: 'M002', since: afterEverything })).toBeUndefined();
  });

  it('throws GitError naming the unreachable revision when since does not exist in the object database (never silently widens to an unbounded scan)', () => {
    commit(repo, 'a.txt', 'workflow: add milestone M002\n\nPitWay-Milestone: M002\n');
    // A syntactically valid but never-created SHA -- git itself reports this
    // as a bad revision, distinct from "a valid range with no match".
    const neverExisted = '0123456789abcdef0123456789abcdef01234567';
    expect(() => resolveCommitSha(repo, { milestone: 'M002', since: neverExisted })).toThrow(GitError);
    try {
      resolveCommitSha(repo, { milestone: 'M002', since: neverExisted });
      throw new Error('expected a throw');
    } catch (error) {
      expect((error as Error).message).toContain(neverExisted);
    }
  });

  it('still returns the correct match, unbounded, when since is entirely omitted (regression -- every existing call site with no base_revision keeps today\'s scan exactly)', () => {
    const target = commit(repo, 'a.txt', 'workflow: add milestone M002\n\nPitWay-Milestone: M002\n');
    expect(resolveCommitSha(repo, { milestone: 'M002' })).toBe(target);
  });
});
