import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadConfig, loadState, loadTasks } from '../../state/store.js';
import { resolveExecutionStrategy } from '../../state/schemas.js';
import { appendWorktreeDiscardRecord, readJournal } from '../../state/journal.js';
import { git } from '../../git/exec.js';
import { deleteTaskBranch, removeTaskWorktree } from '../../git/worktree.js';
import { deriveLiveDispatches } from './dispatch.js';
import { updateTask } from './update.js';

// AC008/T008 (M014): the single sanctioned exit for an abandoned dispatch.
// Order: (1) append the worktree_discard record (closes the dispatch --
// which is also what lets the internal failed-transition below pass
// update.ts's live-dispatch guard), (2) cleanup, (3) in_progress -> failed
// through the existing state machine, whence failed -> ready allows
// re-dispatch. Discarded work is unrecoverable through PitWay.

export class TaskDiscardError extends Error {}

export interface TaskDiscardView {
  id: string;
  milestone: string;
  dispatchId: string;
  reason: string;
  discardedSha: string | null;
  worktreeRemoved: boolean;
  status: string;
}

export function discardTask(root: string, taskId: string, reason: string | undefined): TaskDiscardView {
  const state = loadState(root);
  if (!state.active_milestone) {
    throw new TaskDiscardError('no active milestone; nothing to discard');
  }
  const milestoneId = state.active_milestone;

  const strategy = resolveExecutionStrategy(loadConfig(root));
  if (strategy !== 'parallel_worktrees') {
    throw new TaskDiscardError(
      `task-discard requires execution.strategy: parallel_worktrees ` +
        `(config.yaml resolves to "${strategy}")`,
    );
  }
  if (reason === undefined || reason.trim().length === 0) {
    throw new TaskDiscardError('task-discard requires an explicit --reason <text>');
  }

  const task = loadTasks(root, milestoneId).tasks.find((t) => t.id === taskId);
  if (!task) {
    throw new TaskDiscardError(`unknown task ${taskId} in milestone ${milestoneId}`);
  }

  const live = deriveLiveDispatches(readJournal(root), milestoneId).filter(
    (d) => d.taskId === taskId,
  );
  if (live.length === 0) {
    throw new TaskDiscardError(
      `task ${taskId} has no live worktree dispatch record; nothing to discard`,
    );
  }
  const dispatch = live[live.length - 1]!;

  let discardedSha: string | null = null;
  try {
    discardedSha = git(['rev-parse', '--verify', `refs/heads/${dispatch.branch}`], root).trim();
  } catch {
    // Branch already gone -- tolerated, recorded as null.
  }

  appendWorktreeDiscardRecord(root, {
    id: `wtx-${randomBytes(6).toString('hex')}`,
    dispatchId: dispatch.id,
    milestone: milestoneId,
    taskId,
    reason,
    discardedSha,
    at: new Date().toISOString(),
  });

  // Cleanup tolerates an already-vanished worktree (crashed dispatch,
  // external deletion) -- the record above is what closes the dispatch.
  let worktreeRemoved = false;
  if (existsSync(dispatch.worktreePath)) {
    removeTaskWorktree(root, dispatch.worktreePath);
    worktreeRemoved = true;
  } else if (discardedSha !== null) {
    deleteTaskBranch(root, dispatch.branch);
  }

  // in_progress -> failed through the existing state machine; failed ->
  // ready then allows re-dispatch. Passes update.ts's live-dispatch guard
  // because the discard record above already closed the dispatch.
  const updated = updateTask(root, taskId, 'failed');

  return {
    id: taskId,
    milestone: milestoneId,
    dispatchId: dispatch.id,
    reason,
    discardedSha,
    worktreeRemoved,
    status: updated.status,
  };
}
