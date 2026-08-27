import { createHash, randomBytes } from 'node:crypto';
import { appendBacklogAddUnscopedRecord, appendJournalEntry } from '../../state/journal.js';
import type { BacklogItem } from '../../state/schemas.js';
import {
  loadBacklog,
  loadState,
  loadTasks,
  milestoneDirExists,
  nextBacklogId,
  saveBacklog,
} from '../../state/store.js';

export class BacklogError extends Error {}

// M018/T002 (AC004): unconditional -- no override parameter anywhere in
// this module's public functions. .pitway/backlog.yaml is a shared,
// non-exclusive journal target (see AC004's Design Decisions), so unlike
// task-amend's resolveActiveMilestone, a backlog mutation's journal
// attachment is never CLI-controllable.
export function resolveActiveMilestoneStrict(root: string): string {
  const state = loadState(root);
  if (!state.active_milestone) {
    throw new BacklogError('no active milestone; run milestone-add or resume the active one first');
  }
  return state.active_milestone;
}

// Shared by add/promote existence checks (AC001/AC002): a given milestone
// id must be one PitWay actually created; a given task id must exist
// within that milestone's own tasks.yaml. milestoneDirExists (a directory
// scan) rather than state.yaml's `milestones` list: existence of a
// milestone directory is the ground truth every other command already
// resolves against (loadTasks/loadContract), independent of the historical
// milestones array.
export function assertMilestoneExists(root: string, milestoneId: string): void {
  if (!milestoneDirExists(root, milestoneId)) {
    throw new BacklogError(`milestone ${milestoneId} does not exist`);
  }
}

export function assertTaskExists(root: string, milestoneId: string, taskId: string): void {
  assertMilestoneExists(root, milestoneId);
  const tasks = loadTasks(root, milestoneId);
  if (!tasks.tasks.some((t) => t.id === taskId)) {
    throw new BacklogError(`task ${taskId} does not exist in milestone ${milestoneId}`);
  }
}

export interface BacklogAddInputs {
  title: string;
  reason: string;
  sourceMilestone?: string;
  sourceTask?: string;
}

export interface BacklogAddView {
  id: string;
  status: 'pending';
}

function generateBacklogAddUnscopedId(): string {
  return `bau-${randomBytes(6).toString('hex')}`;
}

// backlog add (AC001, AC003, AC004; T002 decoupled from requiring an active
// milestone): --milestone/--task here are source annotation ONLY, never
// journal-attachment routing (when a milestone is active, that is always the
// active milestone, unconditionally). source.milestone defaults to the
// active milestone when omitted, preserving discovery context by default;
// source.task has no equivalent auto-detection (no state.yaml-level
// "current task" concept exists).
//
// T002: unlike resolveActiveMilestoneStrict (still used unchanged by
// promote, which targets a task -- inherently milestone-scoped), add reads
// active_milestone directly and tolerates null. When active, behavior is
// byte-for-byte unchanged: the same journaled kind:'entry'/backlog_recording
// path below. When null, there is no milestone for an entry-kind record to
// attach to (its `milestone` field is non-nullable, shared with
// usage_recording/contract_amendment/etc., which legitimately require a
// real milestone id) -- so this appends the dedicated milestone-less
// backlog_add_unscoped record instead (mirrors archive.ts's own
// backlog_archive precedent exactly), then saves the backlog directly.
export function addBacklogItem(root: string, inputs: BacklogAddInputs): BacklogAddView {
  const title = inputs.title.trim();
  if (title.length === 0) {
    throw new BacklogError('backlog add requires a non-empty --title');
  }
  const reason = inputs.reason.trim();
  if (reason.length === 0) {
    throw new BacklogError('backlog add requires a non-empty --reason');
  }

  const activeMilestone = loadState(root).active_milestone;

  const sourceMilestone = inputs.sourceMilestone ?? activeMilestone;
  const sourceTask = inputs.sourceTask;
  if (sourceTask !== undefined) {
    if (sourceMilestone === null) {
      throw new BacklogError(
        'backlog add --task requires --milestone (or an active milestone) to resolve against',
      );
    }
    assertTaskExists(root, sourceMilestone, sourceTask);
  } else if (sourceMilestone !== null) {
    assertMilestoneExists(root, sourceMilestone);
  }

  const backlog = loadBacklog(root);
  const id = nextBacklogId(backlog.items);

  const item: BacklogItem = {
    id,
    title,
    reason,
    status: 'pending',
    source: { milestone: sourceMilestone, task: sourceTask ?? null },
    created_at: new Date().toISOString(),
    resolved_at: null,
    promoted_to: null,
    archived_reason: null,
  };

  if (activeMilestone !== null) {
    const operationId = createHash('sha256')
      .update(JSON.stringify({ milestone: activeMilestone, id, item }))
      .digest('hex');

    appendJournalEntry(root, {
      milestone: activeMilestone,
      type: 'backlog_recording',
      operationId,
      target: id,
      payload: { operation: 'add', item },
    });
  } else {
    appendBacklogAddUnscopedRecord(root, {
      id: generateBacklogAddUnscopedId(),
      target: id,
      title,
      reason,
      sourceMilestone,
      sourceTask: sourceTask ?? null,
      at: item.created_at,
    });
  }
  saveBacklog(root, { schema_version: backlog.schema_version, items: [...backlog.items, item] });

  return { id, status: 'pending' };
}
