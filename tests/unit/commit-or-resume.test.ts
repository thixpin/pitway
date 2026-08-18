import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commitOrResume } from '../../src/git/commit-or-resume.js';
import { GitError } from '../../src/git/exec.js';
import { composeMessage } from '../../src/git/trailers.js';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'pitway-cor-'));
  git(['init', '-q'], repo);
  git(['config', 'user.email', 'test@example.com'], repo);
  git(['config', 'user.name', 'Test'], repo);
  writeFileSync(join(repo, 'seed.txt'), 'seed\n');
  git(['add', 'seed.txt'], repo);
  git(['commit', '-q', '-m', 'init'], repo);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

const message = composeMessage('workflow: add milestone M009', { 'PitWay-Milestone': 'M009' });

function options(overrides: Partial<Parameters<typeof commitOrResume>[1]> = {}) {
  return {
    expectedPaths: ['a.txt'],
    findExistingCommit: () => undefined as string | undefined,
    localStateAdvanced: true,
    message,
    ...overrides,
  };
}

describe('commitOrResume', () => {
  it('commits expected dirty paths and returns the new sha', () => {
    writeFileSync(join(repo, 'a.txt'), 'x\n');
    const result = commitOrResume(repo, options());
    expect(result.outcome).toBe('committed');
    expect(result.sha).toBe(git(['rev-parse', 'HEAD'], repo).trim());
  });

  it('reports idempotent success when the matching commit already exists', () => {
    writeFileSync(join(repo, 'a.txt'), 'x\n');
    git(['add', 'a.txt'], repo);
    git(['commit', '-q', '-m', message], repo);
    const sha = git(['rev-parse', 'HEAD'], repo).trim();
    const result = commitOrResume(repo, options({ findExistingCommit: () => sha }));
    expect(result).toEqual({ outcome: 'already-committed', sha });
    // no duplicate commit
    expect(git(['rev-list', '--count', 'HEAD'], repo).trim()).toBe('2');
  });

  it('refuses when local state is not advanced but a matching commit exists (ambiguous)', () => {
    const head = git(['rev-parse', 'HEAD'], repo).trim();
    expect(() =>
      commitOrResume(repo, options({ localStateAdvanced: false, findExistingCommit: () => head })),
    ).toThrowError(GitError);
  });

  it('refuses with the offending paths when unexpected dirty files exist', () => {
    writeFileSync(join(repo, 'a.txt'), 'x\n');
    writeFileSync(join(repo, 'unrelated.txt'), 'wip\n');
    expect(() => commitOrResume(repo, options())).toThrowError(/unrelated\.txt/);
    // nothing staged
    expect(git(['diff', '--cached', '--name-only'], repo).trim()).toBe('');
  });

  it('resumes the pending commit after a git failure is fixed (hook-based failure)', () => {
    const hook = join(repo, '.git', 'hooks', 'pre-commit');
    writeFileSync(hook, '#!/bin/sh\nexit 1\n');
    chmodSync(hook, 0o755);
    writeFileSync(join(repo, 'a.txt'), 'x\n');
    expect(() => commitOrResume(repo, options())).toThrowError(GitError);

    rmSync(hook);
    const result = commitOrResume(repo, options());
    expect(result.outcome).toBe('committed');
  });

  it('refuses to create an empty commit when nothing is dirty and no commit exists', () => {
    expect(() => commitOrResume(repo, options())).toThrowError(/empty|nothing/i);
  });
});
