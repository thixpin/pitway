import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitError, checkWorkingTreeClean } from '../../src/git/safety.js';

let repo: string;

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'pitway-git-'));
  git(['init', '-q'], repo);
  git(['config', 'user.email', 'test@example.com'], repo);
  git(['config', 'user.name', 'Test'], repo);
  writeFileSync(join(repo, 'README.md'), 'hello\n');
  git(['add', 'README.md'], repo);
  git(['commit', '-q', '-m', 'init'], repo);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('checkWorkingTreeClean', () => {
  it('reports clean on a clean tree', () => {
    const result = checkWorkingTreeClean(repo);
    expect(result.clean).toBe(true);
    expect(result.dirtyPaths).toEqual([]);
  });

  it('reports dirty paths without modifying anything', () => {
    writeFileSync(join(repo, 'scratch.txt'), 'wip\n');
    const result = checkWorkingTreeClean(repo);
    expect(result.clean).toBe(false);
    expect(result.dirtyPaths).toContain('scratch.txt');
    // untouched: still untracked, not staged, not committed
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: repo }).toString();
    expect(status).toContain('?? scratch.txt');
  });

  it('reports modified tracked files as dirty', () => {
    writeFileSync(join(repo, 'README.md'), 'changed\n');
    const result = checkWorkingTreeClean(repo);
    expect(result.clean).toBe(false);
    expect(result.dirtyPaths).toContain('README.md');
  });

  it('throws a clear, distinguishable error outside a git work tree', () => {
    const nonRepo = mkdtempSync(join(tmpdir(), 'pitway-nongit-'));
    try {
      expect(() => checkWorkingTreeClean(nonRepo)).toThrowError(GitError);
      expect(() => checkWorkingTreeClean(nonRepo)).toThrowError(/not a git (work tree|repository)/i);
    } finally {
      rmSync(nonRepo, { recursive: true, force: true });
    }
  });
});
