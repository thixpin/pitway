import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveCommitSha } from '../../src/git/trailers.js';

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
  repo = mkdtempSync(join(tmpdir(), 'pitway-trailers-'));
  git(['init', '-q'], repo);
  git(['config', 'user.email', 'test@example.com'], repo);
  git(['config', 'user.name', 'Test'], repo);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('resolveCommitSha', () => {
  it('resolves the baseline commit by milestone trailer with no task trailer', () => {
    const baseline = commit(repo, 'a.txt', 'workflow: add milestone M002\n\nPitWay-Milestone: M002\n');
    commit(repo, 'b.txt', 'feat: x\n\nPitWay-Milestone: M002\nPitWay-Task: T001\n');
    const sha = resolveCommitSha(repo, { milestone: 'M002' });
    expect(sha).toBe(baseline);
  });

  it('resolves a task commit by milestone + task trailers', () => {
    commit(repo, 'a.txt', 'workflow: add milestone M002\n\nPitWay-Milestone: M002\n');
    const taskSha = commit(repo, 'b.txt', 'feat: x\n\nPitWay-Milestone: M002\nPitWay-Task: T001\n');
    const sha = resolveCommitSha(repo, { milestone: 'M002', task: 'T001' });
    expect(sha).toBe(taskSha);
  });

  it('returns undefined when no commit matches', () => {
    commit(repo, 'a.txt', 'workflow: add milestone M002\n\nPitWay-Milestone: M002\n');
    expect(resolveCommitSha(repo, { milestone: 'M999' })).toBeUndefined();
  });
});
