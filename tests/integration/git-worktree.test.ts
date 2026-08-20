import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createTaskWorktree,
  detectTaskWorktree,
  listTaskWorktrees,
  removeTaskWorktree,
  WorktreeError,
  WORKTREES_DIR,
  WORKTREE_MARKER,
} from '../../src/git/worktree.js';

// AC003/T003 (M014): worktree lifecycle primitives against real temp repos.

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pitway-wt-'));
  git(['init', '-q'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  writeFileSync(join(root, 'README.md'), 'seed\n');
  git(['add', 'README.md'], root);
  git(['commit', '-q', '-m', 'init'], root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const currentBranch = (cwd: string): string =>
  git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).trim();

const excludeContent = (): string => {
  const gitDir = git(['rev-parse', '--absolute-git-dir'], root).trim();
  const path = join(gitDir, 'info', 'exclude');
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
};

describe('createTaskWorktree (M014/T003)', () => {
  it('creates the worktree, scaffolding branch, and marker; main tree untouched', () => {
    const before = currentBranch(root);
    const headBefore = git(['rev-parse', 'HEAD'], root).trim();

    const created = createTaskWorktree(root, 'M001', 'T001');

    expect(created.path).toBe(join(root, WORKTREES_DIR, 'M001-T001'));
    expect(created.branch).toBe('pitway/task/M001-T001');
    expect(created.createdFrom).toBe(headBefore);
    expect(existsSync(created.path)).toBe(true);
    expect(currentBranch(created.path)).toBe('pitway/task/M001-T001');

    // Main tree: same branch, same HEAD, clean status.
    expect(currentBranch(root)).toBe(before);
    expect(git(['rev-parse', 'HEAD'], root).trim()).toBe(headBefore);
    expect(git(['status', '--porcelain'], root).trim()).toBe('');

    // Marker contents.
    const marker = readFileSync(join(created.path, WORKTREE_MARKER), 'utf8');
    expect(marker).toContain('milestone: M001');
    expect(marker).toContain('task: T001');
    expect(marker).toContain(headBefore);
  });

  it('writes both exclude entries exactly once across repeated creates', () => {
    createTaskWorktree(root, 'M001', 'T001');
    createTaskWorktree(root, 'M001', 'T002');
    const content = excludeContent();
    expect(content.split('\n').filter((l) => l === `${WORKTREES_DIR}/`)).toHaveLength(1);
    expect(content.split('\n').filter((l) => l === `/${WORKTREE_MARKER}`)).toHaveLength(1);
  });

  it('refuses an existing worktree path, never reusing or resetting it', () => {
    createTaskWorktree(root, 'M001', 'T001');
    expect(() => createTaskWorktree(root, 'M001', 'T001')).toThrow(WorktreeError);
  });

  it('refuses an existing scaffolding branch', () => {
    git(['branch', 'pitway/task/M001-T001'], root);
    expect(() => createTaskWorktree(root, 'M001', 'T001')).toThrow(/branch/);
  });
});

describe('listTaskWorktrees (M014/T003)', () => {
  it('lists managed worktrees with markers and ignores foreign worktrees', () => {
    createTaskWorktree(root, 'M001', 'T001');
    const foreign = join(root, '..', `${'foreign-wt-'}${Date.now()}`);
    git(['worktree', 'add', '-q', '-b', 'foreign-branch', foreign, 'HEAD'], root);
    try {
      const listed = listTaskWorktrees(root);
      expect(listed).toHaveLength(1);
      expect(listed[0]!.branch).toBe('pitway/task/M001-T001');
      expect(listed[0]!.marker?.milestone).toBe('M001');
      expect(listed[0]!.marker?.task).toBe('T001');
    } finally {
      git(['worktree', 'remove', '--force', foreign], root);
    }
  });

  it('returns an empty list when no managed worktrees exist', () => {
    expect(listTaskWorktrees(root)).toEqual([]);
  });
});

describe('removeTaskWorktree (M014/T003)', () => {
  it('removes worktree and branch without --force despite the marker being present', () => {
    const created = createTaskWorktree(root, 'M001', 'T001');
    removeTaskWorktree(root, created.path);
    expect(existsSync(created.path)).toBe(false);
    expect(listTaskWorktrees(root)).toEqual([]);
    const branches = git(['branch', '--list', 'pitway/task/M001-T001'], root).trim();
    expect(branches).toBe('');
    // Main tree still clean and on its original branch.
    expect(git(['status', '--porcelain'], root).trim()).toBe('');
  });

  it('refuses a path outside the managed prefix', () => {
    expect(() => removeTaskWorktree(root, join(root, 'src'))).toThrow(WorktreeError);
  });
});

describe('detectTaskWorktree (M014/T003)', () => {
  it('detects from the worktree root and from a subdirectory', () => {
    const created = createTaskWorktree(root, 'M001', 'T001');
    mkdirSync(join(created.path, 'nested', 'deep'), { recursive: true });

    const fromRoot = detectTaskWorktree(created.path);
    expect(fromRoot?.marker.milestone).toBe('M001');
    expect(fromRoot?.marker.task).toBe('T001');

    const fromSub = detectTaskWorktree(join(created.path, 'nested', 'deep'));
    expect(fromSub?.marker.task).toBe('T001');
    expect(fromSub?.topLevel).toBe(fromRoot?.topLevel);
  });

  it('returns null in the main repository root', () => {
    createTaskWorktree(root, 'M001', 'T001');
    expect(detectTaskWorktree(root)).toBeNull();
  });
});
