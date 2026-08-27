import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadConfig, loadState, loadTasks, resolveMilestoneDirName } from '../../state/store.js';
import { resolveExecutionStrategy } from '../../state/schemas.js';
import {
  appendWorktreeIntegrateRecord,
  readJournal,
  type JournalWorktreeDispatch,
} from '../../state/journal.js';
import {
  applyDiff,
  computeRangeDiff,
  diffApplies,
  diffReverseApplies,
  listChangedPaths,
} from '../../git/apply.js';
import { git } from '../../git/exec.js';
import { classifyDirtyPaths, checkWorkingTreeClean } from '../../git/safety.js';
import { resolvePendingJournalTargets } from '../journal/pending-targets.js';
import { deleteTaskBranch, removeTaskWorktree, WORKTREE_MARKER } from '../../git/worktree.js';
import { checkWriteScope } from './write-scope-check.js';
import { deriveLiveDispatches } from './dispatch.js';

// AC006/T006 (M014): diff-apply integration engine, one task at a time. The
// worker's commit is transport + verification evidence only: the range diff
// lands in the main tree uncommitted, and the EXISTING completion path
// (task-verify while in_progress -> review -> completed) produces the one
// atomic commit. No merge, no persisted task branch, no second commit
// shape. Success order is normative: (1) apply, (2) journal record,
// (3) worktree/branch cleanup -- each crash window between them maps to a
// resume-describable residue class with an idempotent re-run (T007).

export class TaskIntegrateError extends Error {}

export interface TaskIntegrateView {
  id: string;
  milestone: string;
  dispatchId: string;
  workerSha: string;
  changedPaths: string[];
  // 'integrated': the normal full path. 'recovered': the diff was already
  // applied (crash after apply, before the journal record) -- the re-run
  // completed the record + cleanup only. 'cleanup-completed': the record
  // already existed (crash after record, before cleanup) -- the re-run
  // removed the surviving worktree/branch only.
  outcome: 'integrated' | 'recovered' | 'cleanup-completed';
}

function generateIntegrateId(): string {
  return `wti-${randomBytes(6).toString('hex')}`;
}

// AC006/T007: crash after the journal record but before cleanup leaves a
// closed dispatch whose worktree/branch survives -- the 'cleanup pending'
// residue class. Detected here so an integrate re-run completes cleanup
// idempotently instead of refusing.
function findCleanupPending(
  root: string,
  milestoneId: string,
  taskId: string,
): JournalWorktreeDispatch | null {
  const records = readJournal(root);
  const closedIds = new Set(
    records
      .filter((r) => r.kind === 'worktree_integrate' && r.milestone === milestoneId)
      .map((r) => (r as { dispatchId: string }).dispatchId),
  );
  const closed = records.filter(
    (r): r is JournalWorktreeDispatch =>
      r.kind === 'worktree_dispatch' &&
      r.milestone === milestoneId &&
      r.taskId === taskId &&
      closedIds.has(r.id),
  );
  for (const dispatch of closed.reverse()) {
    const branchExists = (() => {
      try {
        git(['rev-parse', '--verify', `refs/heads/${dispatch.branch}`], root);
        return true;
      } catch {
        return false;
      }
    })();
    if (existsSync(dispatch.worktreePath) || branchExists) return dispatch;
  }
  return null;
}

function findLiveDispatch(
  root: string,
  milestoneId: string,
  taskId: string,
): JournalWorktreeDispatch | null {
  const live = deriveLiveDispatches(readJournal(root), milestoneId).filter(
    (d) => d.taskId === taskId,
  );
  // Multiple live dispatches for one task cannot arise through the commands
  // (dispatch refuses on an existing worktree/branch), so latest wins.
  return live.length === 0 ? null : live[live.length - 1]!;
}

export function integrateTask(root: string, taskId: string): TaskIntegrateView {
  const state = loadState(root);
  if (!state.active_milestone) {
    throw new TaskIntegrateError('no active milestone; nothing to integrate');
  }
  const milestoneId = state.active_milestone;

  const strategy = resolveExecutionStrategy(loadConfig(root));
  if (strategy !== 'parallel_worktrees') {
    throw new TaskIntegrateError(
      `task-integrate requires execution.strategy: parallel_worktrees ` +
        `(config.yaml resolves to "${strategy}")`,
    );
  }

  const task = loadTasks(root, milestoneId).tasks.find((t) => t.id === taskId);
  if (!task) {
    throw new TaskIntegrateError(`unknown task ${taskId} in milestone ${milestoneId}`);
  }

  const dispatch = findLiveDispatch(root, milestoneId, taskId);
  if (dispatch === null) {
    // 'cleanup pending' re-run: the integrate record landed but the crash
    // preceded cleanup -- finish cleanup only and report success. The
    // applied work is already in the main tree; task-discard would be wrong.
    const pending = findCleanupPending(root, milestoneId, taskId);
    if (pending !== null) {
      if (existsSync(pending.worktreePath)) {
        removeTaskWorktree(root, pending.worktreePath);
      } else {
        deleteTaskBranch(root, pending.branch);
      }
      return {
        id: taskId,
        milestone: milestoneId,
        dispatchId: pending.id,
        workerSha: 'already-recorded',
        changedPaths: [],
        outcome: 'cleanup-completed',
      };
    }
    throw new TaskIntegrateError(
      `task ${taskId} has no live worktree dispatch record; nothing to integrate ` +
        `(an abandoned worktree is closed with task-discard)`,
    );
  }
  if (!existsSync(dispatch.worktreePath)) {
    throw new TaskIntegrateError(
      `worktree ${dispatch.worktreePath} for task ${taskId} has vanished; ` +
        `close the dispatch with task-discard`,
    );
  }

  let workerSha: string;
  try {
    workerSha = git(['rev-parse', '--verify', `refs/heads/${dispatch.branch}`], root).trim();
  } catch {
    throw new TaskIntegrateError(
      `scaffolding branch ${dispatch.branch} is missing; close the dispatch with task-discard`,
    );
  }
  if (workerSha === dispatch.createdFrom) {
    throw new TaskIntegrateError(
      `worker committed nothing on ${dispatch.branch} (still at the created-from revision); ` +
        `commit the work in the worktree first, or abandon with task-discard`,
    );
  }

  const diff = computeRangeDiff(root, dispatch.createdFrom, workerSha);
  if (diff.trim().length === 0) {
    throw new TaskIntegrateError(
      `nothing to integrate: the range ${dispatch.createdFrom.slice(0, 12)}..${workerSha.slice(0, 12)} ` +
        `has an empty combined diff`,
    );
  }

  const changedPaths = listChangedPaths(root, dispatch.createdFrom, workerSha);
  const protectedPaths = changedPaths.filter(
    (p) => p === WORKTREE_MARKER || p.startsWith('.pitway/'),
  );
  const scope = checkWriteScope(
    changedPaths.filter((p) => !protectedPaths.includes(p)),
    task,
  );
  const offenders = [...protectedPaths, ...scope.outOfScope];
  if (offenders.length > 0) {
    throw new TaskIntegrateError(
      `refusing to integrate ${taskId}: changed path(s) outside its write_scope or in ` +
        `protected state: ${offenders.join(', ')} — the worktree is preserved for inspection`,
    );
  }

  // Expected dirt: tasks.yaml exactly as updateTask's own in_progress check
  // treats it (the dispatch transition dirtied it, uncommitted until the
  // completion commit), plus journal-pending materializations.
  const tasksPath = `.pitway/milestones/${resolveMilestoneDirName(root, milestoneId)}/tasks.yaml`;
  const expected = new Set(
    classifyDirtyPaths(root, {
      journalTargetPaths: resolvePendingJournalTargets(root, milestoneId),
      pendingTransitionPaths: [tasksPath],
    }).expected,
  );
  const status = checkWorkingTreeClean(root);
  const unexpected = status.dirtyPaths.filter((p) => !expected.has(p));

  const recordAndCleanup = (): void => {
    appendWorktreeIntegrateRecord(root, {
      id: generateIntegrateId(),
      dispatchId: dispatch.id,
      milestone: milestoneId,
      taskId,
      workerSha,
      at: new Date().toISOString(),
    });
    removeTaskWorktree(root, dispatch.worktreePath);
  };

  // Applied-but-unrecorded re-run (crash after apply, before the journal
  // record): the tree already contains exactly this diff -- forward check
  // fails, reverse succeeds, and every unexpected dirty path is one of the
  // diff's own. Complete the record + cleanup; never a bare refusal, and
  // task-discard would destroy nothing but announce the wrong thing (the
  // work is already applied in the main tree).
  if (
    !diffApplies(root, diff) &&
    diffReverseApplies(root, diff) &&
    unexpected.every((p) => changedPaths.includes(p))
  ) {
    recordAndCleanup();
    return {
      id: taskId,
      milestone: milestoneId,
      dispatchId: dispatch.id,
      workerSha,
      changedPaths,
      outcome: 'recovered',
    };
  }

  if (unexpected.length > 0) {
    throw new TaskIntegrateError(
      `cannot integrate onto a dirty main tree: ${unexpected.join(', ')} — ` +
        `nothing was written; the worktree is preserved; ask the developer ` +
        `(do NOT task-discard: the dispatched work is intact in its worktree)`,
    );
  }

  if (!diffApplies(root, diff)) {
    throw new TaskIntegrateError(
      `the combined diff for ${taskId} does not apply cleanly to the main tree; ` +
        `nothing was written, the worktree is preserved, and the task stays in_progress — ` +
        `PitWay never invents a merge; inspect and resolve manually`,
    );
  }

  applyDiff(root, diff);
  recordAndCleanup();

  return {
    id: taskId,
    milestone: milestoneId,
    dispatchId: dispatch.id,
    workerSha,
    changedPaths,
    outcome: 'integrated',
  };
}
