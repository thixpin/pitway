import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createTaskWorktree,
  deleteTaskBranch,
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

  it('creates info/exclude from scratch when it does not exist yet', () => {
    const gitDir = git(['rev-parse', '--absolute-git-dir'], root).trim();
    rmSync(join(gitDir, 'info', 'exclude'), { force: true });

    createTaskWorktree(root, 'M001', 'T001');

    const content = excludeContent();
    expect(content.split('\n')).toContain(`${WORKTREES_DIR}/`);
    expect(content.split('\n')).toContain(`/${WORKTREE_MARKER}`);
  });

  it('appends on a fresh line when existing exclude content lacks a trailing newline', () => {
    const gitDir = git(['rev-parse', '--absolute-git-dir'], root).trim();
    mkdirSync(join(gitDir, 'info'), { recursive: true });
    writeFileSync(join(gitDir, 'info', 'exclude'), 'node_modules/');

    createTaskWorktree(root, 'M001', 'T001');

    const lines = excludeContent().split('\n');
    // The user's own entry stays intact on its own line -- never glued to
    // PitWay's first appended entry.
    expect(lines).toContain('node_modules/');
    expect(lines).toContain(`${WORKTREES_DIR}/`);
    expect(lines).toContain(`/${WORKTREE_MARKER}`);
  });

  it('appends only the missing entry when one of the two is already present', () => {
    const gitDir = git(['rev-parse', '--absolute-git-dir'], root).trim();
    mkdirSync(join(gitDir, 'info'), { recursive: true });
    writeFileSync(join(gitDir, 'info', 'exclude'), `${WORKTREES_DIR}/\n`);

    createTaskWorktree(root, 'M001', 'T001');

    const lines = excludeContent().split('\n');
    expect(lines.filter((l) => l === `${WORKTREES_DIR}/`)).toHaveLength(1);
    expect(lines.filter((l) => l === `/${WORKTREE_MARKER}`)).toHaveLength(1);
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

  it('reports marker: null for a managed worktree whose marker file is gone', () => {
    const created = createTaskWorktree(root, 'M001', 'T001');
    rmSync(join(created.path, WORKTREE_MARKER));
    const listed = listTaskWorktrees(root);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.marker).toBeNull();
  });

  it('reports marker: null for a corrupt marker rather than failing the whole listing', () => {
    const created = createTaskWorktree(root, 'M001', 'T001');
    writeFileSync(join(created.path, WORKTREE_MARKER), 'schema_version: 99\nnonsense: true\n');
    const listed = listTaskWorktrees(root);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.marker).toBeNull();
  });

  it('reports branch: null for a managed worktree left on a detached HEAD', () => {
    const created = createTaskWorktree(root, 'M001', 'T001');
    git(['checkout', '-q', '--detach'], created.path);
    const listed = listTaskWorktrees(root);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.branch).toBeNull();
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

  it('removes a detached-HEAD worktree without attempting any branch deletion', () => {
    const created = createTaskWorktree(root, 'M001', 'T001');
    git(['checkout', '-q', '--detach'], created.path);

    removeTaskWorktree(root, created.path);

    expect(existsSync(created.path)).toBe(false);
    // The scaffolding branch was NOT deleted -- there was no branch recorded
    // for the worktree, so the deletion step is skipped, never guessed at.
    const branches = git(['branch', '--list', 'pitway/task/M001-T001'], root).trim();
    expect(branches).toContain('pitway/task/M001-T001');
  });
});

describe('deleteTaskBranch (M014/T003)', () => {
  it('deletes an unmerged scaffolding branch (forced by design)', () => {
    const created = createTaskWorktree(root, 'M001', 'T001');
    writeFileSync(join(created.path, 'work.txt'), 'unmerged\n');
    git(['add', 'work.txt'], created.path);
    git(['commit', '-q', '-m', 'unmerged work'], created.path);
    git(['checkout', '-q', '--detach'], created.path);
    removeTaskWorktree(root, created.path);

    deleteTaskBranch(root, 'pitway/task/M001-T001');
    expect(git(['branch', '--list', 'pitway/task/M001-T001'], root).trim()).toBe('');
  });

  it('refuses to delete any branch outside the pitway/task/ namespace', () => {
    git(['branch', 'feature/precious'], root);
    expect(() => deleteTaskBranch(root, 'feature/precious')).toThrow(WorktreeError);
    expect(() => deleteTaskBranch(root, 'feature/precious')).toThrow(
      /refusing to delete non-scaffolding branch/,
    );
    expect(git(['branch', '--list', 'feature/precious'], root).trim()).toContain('feature/precious');
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

  it('returns null outside any git repository instead of throwing', () => {
    const nonRepo = mkdtempSync(join(tmpdir(), 'pitway-wt-nongit-'));
    try {
      expect(detectTaskWorktree(nonRepo)).toBeNull();
    } finally {
      rmSync(nonRepo, { recursive: true, force: true });
    }
  });

  it('returns null for a corrupt marker rather than trusting it', () => {
    const created = createTaskWorktree(root, 'M001', 'T001');
    writeFileSync(join(created.path, WORKTREE_MARKER), 'schema_version: 99\n');
    expect(detectTaskWorktree(created.path)).toBeNull();
  });
});
