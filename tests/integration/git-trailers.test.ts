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

// T002/AC002: PitWay-Verification-Repair composes independently of the
// existing milestone/task matching -- a plain milestone-level or task-level
// query must never accidentally match a verification-repair commit, and a
// verificationRepair query must never match a plain milestone or task
// commit. Proves the new field doesn't perturb any existing lookup.
describe('resolveCommitSha with PitWay-Verification-Repair', () => {
  it('resolves a verification-repair commit by milestone + verificationRepair trailers', () => {
    commit(repo, 'a.txt', 'workflow: add milestone M002\n\nPitWay-Milestone: M002\n');
    commit(repo, 'b.txt', 'feat: x\n\nPitWay-Milestone: M002\nPitWay-Task: T001\n');
    const vrSha = commit(
      repo,
      'c.txt',
      'fix: repair\n\nPitWay-Milestone: M002\nPitWay-Verification-Repair: VR001\n',
    );
    const sha = resolveCommitSha(repo, { milestone: 'M002', verificationRepair: 'VR001' });
    expect(sha).toBe(vrSha);
  });

  it('a plain milestone-level query (no task, no verificationRepair) never matches a verification-repair commit', () => {
    commit(
      repo,
      'c.txt',
      'fix: repair\n\nPitWay-Milestone: M002\nPitWay-Verification-Repair: VR001\n',
    );
    expect(resolveCommitSha(repo, { milestone: 'M002' })).toBeUndefined();
  });

  it('a task-level query never matches a verification-repair commit', () => {
    commit(
      repo,
      'c.txt',
      'fix: repair\n\nPitWay-Milestone: M002\nPitWay-Verification-Repair: VR001\n',
    );
    expect(resolveCommitSha(repo, { milestone: 'M002', task: 'T001' })).toBeUndefined();
  });

  it('a verificationRepair query never matches a plain milestone commit or a task commit', () => {
    const baseline = commit(repo, 'a.txt', 'workflow: add milestone M002\n\nPitWay-Milestone: M002\n');
    const taskSha = commit(repo, 'b.txt', 'feat: x\n\nPitWay-Milestone: M002\nPitWay-Task: T001\n');
    expect(resolveCommitSha(repo, { milestone: 'M002', verificationRepair: 'VR001' })).toBeUndefined();
    // Sanity: those same commits are still resolvable by their own queries —
    // this file's earlier describe block already covers that directly, but
    // asserted again here to prove the new field caused no regression.
    expect(resolveCommitSha(repo, { milestone: 'M002' })).toBe(baseline);
    expect(resolveCommitSha(repo, { milestone: 'M002', task: 'T001' })).toBe(taskSha);
  });

  it('a different verificationRepair id does not match', () => {
    commit(
      repo,
      'c.txt',
      'fix: repair\n\nPitWay-Milestone: M002\nPitWay-Verification-Repair: VR001\n',
    );
    expect(resolveCommitSha(repo, { milestone: 'M002', verificationRepair: 'VR002' })).toBeUndefined();
  });
});
