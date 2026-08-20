import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import { git, GitError } from './exec.js';

// AC003/T003 (M014): temporary task-worktree lifecycle primitives, used only
// by Core. One worktree + one scaffolding branch per dispatched task, both
// transport-only: the branch never enters mainline history (diff-apply,
// never merge) and both are always deleted at integrate/discard.

export class WorktreeError extends Error {}

export const WORKTREES_DIR = '.pitway-worktrees';
export const WORKTREE_MARKER = '.pitway-worktree.yaml';

// Runtime-disposable marker inside each task worktree -- never committed
// (excluded via info/exclude), read by detectTaskWorktree (state guard) and
// the residue classifiers.
const markerSchema = z.strictObject({
  schema_version: z.literal(1),
  milestone: z.string().regex(/^M\d{3}$/),
  task: z.string().regex(/^T\d{3}$/),
  created_from: z.string().min(1),
});

export type TaskWorktreeMarker = z.infer<typeof markerSchema>;

export interface CreatedTaskWorktree {
  path: string;
  branch: string;
  createdFrom: string;
}

export interface TaskWorktreeInfo {
  path: string;
  branch: string | null;
  marker: TaskWorktreeMarker | null;
}

export function taskBranchName(milestoneId: string, taskId: string): string {
  return `pitway/task/${milestoneId}-${taskId}`;
}

export function taskWorktreePath(root: string, milestoneId: string, taskId: string): string {
  return join(root, WORKTREES_DIR, `${milestoneId}-${taskId}`);
}

function branchExists(root: string, branch: string): boolean {
  try {
    git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], root);
    return true;
  } catch {
    return false;
  }
}

// Both entries go to the COMMON git dir's info/exclude (local-only, never the
// committed .gitignore -- PitWay does not edit user files): the directory
// prefix keeps worktrees out of main-tree status, and the anchored marker
// entry is what lets `git worktree remove` succeed without --force (an
// untracked marker otherwise blocks removal) and keeps the marker out of a
// worker's `git add -A`.
function ensureExcludeEntries(root: string): void {
  const commonDir = resolve(root, git(['rev-parse', '--git-common-dir'], root).trim());
  const infoDir = join(commonDir, 'info');
  mkdirSync(infoDir, { recursive: true });
  const excludePath = join(infoDir, 'exclude');
  const existing = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : '';
  const lines = existing.split('\n');
  const wanted = [`${WORKTREES_DIR}/`, `/${WORKTREE_MARKER}`];
  const missing = wanted.filter((entry) => !lines.includes(entry));
  if (missing.length === 0) return;
  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  appendFileSync(excludePath, `${prefix}${missing.join('\n')}\n`);
}

export function createTaskWorktree(
  root: string,
  milestoneId: string,
  taskId: string,
): CreatedTaskWorktree {
  const path = taskWorktreePath(root, milestoneId, taskId);
  const branch = taskBranchName(milestoneId, taskId);

  // A foreign collision and PitWay's own crashed-attempt orphan are
  // deliberately not distinguished -- both refuse identically, requiring
  // manual developer inspection (matches M012's confirm-branch policy).
  if (existsSync(path)) {
    throw new WorktreeError(
      `worktree path ${path} already exists; inspect and remove it manually before dispatching`,
    );
  }
  if (branchExists(root, branch)) {
    throw new WorktreeError(
      `scaffolding branch ${branch} already exists; inspect and delete it manually before dispatching`,
    );
  }

  ensureExcludeEntries(root);
  mkdirSync(join(root, WORKTREES_DIR), { recursive: true });
  const createdFrom = git(['rev-parse', 'HEAD'], root).trim();
  git(['worktree', 'add', '-q', '-b', branch, path, 'HEAD'], root);

  const marker: TaskWorktreeMarker = {
    schema_version: 1,
    milestone: milestoneId,
    task: taskId,
    created_from: createdFrom,
  };
  writeFileSync(join(path, WORKTREE_MARKER), stringify(markerSchema.parse(marker)));

  return { path, branch, createdFrom };
}

// Canonicalizes for comparison: git's porcelain output reports canonical
// paths (e.g. /private/var on macOS) while callers may hold the symlinked
// form (/var) -- realpath both sides so prefix checks are reliable.
function canonical(path: string): string {
  return existsSync(path) ? realpathSync(path) : resolve(path);
}

export function listTaskWorktrees(root: string): TaskWorktreeInfo[] {
  const managedPrefix = join(canonical(root), WORKTREES_DIR) + sep;
  const output = git(['worktree', 'list', '--porcelain'], root);
  const entries: TaskWorktreeInfo[] = [];
  let current: { path?: string; branch?: string | null } = {};
  const flush = (): void => {
    if (current.path !== undefined && canonical(current.path).startsWith(managedPrefix)) {
      const markerPath = join(current.path, WORKTREE_MARKER);
      let marker: TaskWorktreeMarker | null = null;
      if (existsSync(markerPath)) {
        const parsed = markerSchema.safeParse(parse(readFileSync(markerPath, 'utf8')));
        marker = parsed.success ? parsed.data : null;
      }
      entries.push({ path: current.path, branch: current.branch ?? null, marker });
    }
    current = {};
  };
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      flush();
      current.path = line.slice('worktree '.length);
    } else if (line.startsWith('branch refs/heads/')) {
      current.branch = line.slice('branch refs/heads/'.length);
    }
  }
  flush();
  return entries;
}

export function deleteTaskBranch(root: string, branch: string): void {
  if (!branch.startsWith('pitway/task/')) {
    throw new WorktreeError(`refusing to delete non-scaffolding branch ${branch}`);
  }
  // Scaffolding branches are never merged (diff-apply integration), so
  // deletion is always the forced form by design -- disclosed, not hidden.
  git(['branch', '-D', branch], root);
}

export function removeTaskWorktree(root: string, worktreePath: string): void {
  const managedPrefix = join(canonical(root), WORKTREES_DIR) + sep;
  if (!canonical(worktreePath).startsWith(managedPrefix)) {
    throw new WorktreeError(
      `refusing to remove ${worktreePath}: outside the managed ${WORKTREES_DIR}/ prefix`,
    );
  }
  const listed = listTaskWorktrees(root).find(
    (w) => canonical(w.path) === canonical(worktreePath),
  );
  // No --force: the marker is excluded (ensureExcludeEntries), so a worktree
  // whose only unexpected content is the marker removes cleanly; anything
  // else genuinely dirty surfaces as a loud git error, never silently
  // destroyed.
  git(['worktree', 'remove', worktreePath], root);
  if (listed?.branch) {
    deleteTaskBranch(root, listed.branch);
  }
}

export interface DetectedTaskWorktree {
  topLevel: string;
  marker: TaskWorktreeMarker;
}

// Resolves the invocation's worktree top-level via git itself (never
// trusting cwd directly), so invocation from a subdirectory is still
// detected. Returns null outside any PitWay task worktree.
export function detectTaskWorktree(cwd: string): DetectedTaskWorktree | null {
  let topLevel: string;
  try {
    topLevel = git(['rev-parse', '--show-toplevel'], cwd).trim();
  } catch (error) {
    if (error instanceof GitError) return null;
    throw error;
  }
  const markerPath = join(topLevel, WORKTREE_MARKER);
  if (!existsSync(markerPath)) return null;
  const parsed = markerSchema.safeParse(parse(readFileSync(markerPath, 'utf8')));
  if (!parsed.success) return null;
  return { topLevel, marker: parsed.data };
}
