import { randomBytes } from 'node:crypto';
import { loadConfig, loadState, loadTasks } from '../../state/store.js';
import { resolveExecutionStrategy } from '../../state/schemas.js';
import {
  appendWorktreeDispatchRecord,
  readJournal,
  type JournalRecord,
  type JournalWorktreeDispatch,
} from '../../state/journal.js';
import { derivePending } from '../journal/operations.js';
import { createTaskWorktree, taskBranchName, taskWorktreePath } from '../../git/worktree.js';
import { git } from '../../git/exec.js';
import { checkParallelEligibility } from './parallel-eligibility.js';
import { updateTask } from './update.js';

// AC004/T004 (M014): prepares one task for parallel execution. PitWay gates
// (strategy, eligibility, pending amendments, clean tree via the existing
// in_progress transition); the DRIVER parallelizes -- nothing here spawns,
// schedules, or monitors a worker. The --json envelope is a handoff only:
// the driver obtains the context bundle at the authoritative main root
// (task-status <id> --context) and passes it to the worker; in-worktree
// reads see a stale committed .pitway/ copy and an empty per-worktree
// journal, and are never authoritative.

export class TaskDispatchError extends Error {}

export interface TaskDispatchView {
  id: string;
  milestone: string;
  worktreePath: string;
  branch: string;
  createdFrom: string;
  dispatchId: string;
}

// Kinds that close a dispatch. worktree_integrate/worktree_discard are added
// to the journal union by later tasks of this milestone; deriving through a
// plain string comparison keeps this helper correct from the moment each
// kind starts existing without re-releasing this module.
const CLOSING_KINDS = new Set(['worktree_integrate', 'worktree_discard']);

// A dispatch is live until a later closing record references its id (or,
// defensively, its task while no dispatch id is carried). Pure over
// already-read records.
export function deriveLiveDispatches(
  records: JournalRecord[],
  milestone: string,
): JournalWorktreeDispatch[] {
  const closedDispatchIds = new Set<string>();
  for (const record of records) {
    const raw = record as { kind: string; dispatchId?: unknown };
    if (CLOSING_KINDS.has(raw.kind) && typeof raw.dispatchId === 'string') {
      closedDispatchIds.add(raw.dispatchId);
    }
  }
  return records.filter(
    (r): r is JournalWorktreeDispatch =>
      r.kind === 'worktree_dispatch' &&
      r.milestone === milestone &&
      !closedDispatchIds.has(r.id),
  );
}

function generateDispatchId(): string {
  return `wtd-${randomBytes(6).toString('hex')}`;
}

export function dispatchTask(root: string, taskId: string): TaskDispatchView {
  const state = loadState(root);
  if (!state.active_milestone) {
    throw new TaskDispatchError('no active milestone; nothing to dispatch');
  }
  const milestoneId = state.active_milestone;

  const strategy = resolveExecutionStrategy(loadConfig(root));
  if (strategy !== 'parallel_worktrees') {
    throw new TaskDispatchError(
      `task-dispatch requires execution.strategy: parallel_worktrees ` +
        `(config.yaml resolves to "${strategy}"); sequential repositories use task-update directly`,
    );
  }

  const tasksFile = loadTasks(root, milestoneId);
  const task = tasksFile.tasks.find((t) => t.id === taskId);
  if (!task) {
    throw new TaskDispatchError(`unknown task ${taskId} in milestone ${milestoneId}`);
  }

  const concurrent = tasksFile.tasks.filter((t) => t.status === 'in_progress');
  const eligibility = checkParallelEligibility(task, concurrent, tasksFile.tasks);
  if (!eligibility.eligible) {
    throw new TaskDispatchError(`task ${taskId} is not parallel-eligible: ${eligibility.detail}`);
  }

  // A materialized-but-uncommitted amendment is invisible to the worktree's
  // committed .pitway/ copy -- dispatching now would hand the worker the
  // stale pre-amendment contract. Require the next checkpoint commit first.
  const pending = derivePending(readJournal(root)).filter((e) => e.milestone === milestoneId);
  if (pending.length > 0) {
    throw new TaskDispatchError(
      `milestone ${milestoneId} has ${pending.length} journal-pending amendment(s) ` +
        `(${pending.map((e) => e.operationId).join(', ')}); complete a checkpoint commit ` +
        `before dispatching so the worktree branches from post-amendment state`,
    );
  }

  // Normative order: (1) state transition (existing path: clean-tree check,
  // attempts increment, journal-expected classification), (2) dispatch
  // record, (3) worktree creation. A crash between (1) and (2) leaves an
  // in_progress task with no record -- resume labels it 'inline or
  // interrupted dispatch'; between (2) and (3), a vanished-worktree orphan.
  updateTask(root, taskId, 'in_progress');

  // Branch/path are deterministic and HEAD cannot move between the record
  // and the creation below (same process, no commit in between), so the
  // record carries the real values even though it precedes the worktree.
  const dispatchId = generateDispatchId();
  appendWorktreeDispatchRecord(root, {
    id: dispatchId,
    milestone: milestoneId,
    taskId,
    branch: taskBranchName(milestoneId, taskId),
    worktreePath: taskWorktreePath(root, milestoneId, taskId),
    createdFrom: git(['rev-parse', 'HEAD'], root).trim(),
    at: new Date().toISOString(),
  });

  const created = createTaskWorktree(root, milestoneId, taskId);

  return {
    id: taskId,
    milestone: milestoneId,
    worktreePath: created.path,
    branch: created.branch,
    createdFrom: created.createdFrom,
    dispatchId,
  };
}
