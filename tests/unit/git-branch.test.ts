import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  branchExists,
  createAndCheckoutBranch,
  currentBranch,
  currentRevision,
} from '../../src/git/branch.js';
import { GitError } from '../../src/git/exec.js';
import { deterministicBranchName } from '../../src/core/milestones/confirm.js';

let repo: string;

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'pitway-git-branch-'));
  git(['init', '-q', '-b', 'main'], repo);
  git(['config', 'user.email', 'test@example.com'], repo);
  git(['config', 'user.name', 'Test'], repo);
  writeFileSync(join(repo, 'README.md'), 'hello\n');
  git(['add', 'README.md'], repo);
  git(['commit', '-q', '-m', 'init'], repo);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('currentBranch / currentRevision (T002)', () => {
  it('reports the checked-out branch name', () => {
    expect(currentBranch(repo)).toBe('main');
  });

  it('reports HEAD SHA matching git rev-parse HEAD', () => {
    const expected = git(['rev-parse', 'HEAD'], repo).trim();
    expect(currentRevision(repo)).toBe(expected);
  });
});

describe('branchExists (T002)', () => {
  it('returns false for a branch that does not exist', () => {
    expect(branchExists(repo, 'pitway/M999-nonexistent')).toBe(false);
  });

  it('returns true for a branch that exists', () => {
    git(['branch', 'pitway/M999-exists'], repo);
    expect(branchExists(repo, 'pitway/M999-exists')).toBe(true);
  });
});

describe('createAndCheckoutBranch (T002)', () => {
  it('creates and checks out a new branch from the current HEAD', () => {
    const beforeSha = currentRevision(repo);
    createAndCheckoutBranch(repo, 'pitway/M999-new');
    expect(currentBranch(repo)).toBe('pitway/M999-new');
    expect(currentRevision(repo)).toBe(beforeSha);
    expect(branchExists(repo, 'pitway/M999-new')).toBe(true);
  });

  it('throws GitError when the branch already exists', () => {
    git(['branch', 'pitway/M999-dup'], repo);
    expect(() => createAndCheckoutBranch(repo, 'pitway/M999-dup')).toThrow(GitError);
  });
});

describe('deterministicBranchName (T002)', () => {
  it('slugifies the title and prefixes with pitway/<id>-', () => {
    expect(deterministicBranchName('M012', 'Milestone Git branch isolation')).toBe(
      'pitway/M012-milestone-git-branch-isolation',
    );
  });

  it('falls back to the bare id when the title slugifies to nothing', () => {
    expect(deterministicBranchName('M012', '!!!')).toBe('pitway/M012');
  });
});
