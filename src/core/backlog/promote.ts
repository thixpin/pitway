import { createHash } from 'node:crypto';
import { appendJournalEntry } from '../../state/journal.js';
import { BacklogError, assertTaskExists, resolveActiveMilestoneStrict } from './add.js';
import { transitionBacklogItem } from './state-machine.js';
import { loadBacklog, saveBacklog } from '../../state/store.js';

export { BacklogError };

export interface BacklogPromoteInputs {
  taskId: string;
  milestoneId?: string;
}

export interface BacklogPromoteView {
  id: string;
  status: 'promoted';
  promoted_to: { milestone: string; task: string };
}

// backlog promote (AC002, AC004): --task/--milestone here mean the
// promotion TARGET only, never journal-attachment routing (that is always
// the active milestone, unconditionally -- see resolveActiveMilestoneStrict).
// --milestone defaults to the active milestone when omitted, since task
// ids are milestone-scoped (a bare --task alone is otherwise ambiguous).
// Never creates a task or milestone itself -- a pure terminal-transition
// link, mirroring promoteQuickChange's identical boundary.
export function promoteBacklogItem(root: string, id: string, inputs: BacklogPromoteInputs): BacklogPromoteView {
  const activeMilestone = resolveActiveMilestoneStrict(root);

  const backlog = loadBacklog(root);
  const current = backlog.items.find((item) => item.id === id);
  if (current === undefined) {
    throw new BacklogError(`backlog item ${id} not found`);
  }
  transitionBacklogItem(current.status, 'promoted');

  const targetMilestone = inputs.milestoneId ?? activeMilestone;
  assertTaskExists(root, targetMilestone, inputs.taskId);

  const promotedTo = { milestone: targetMilestone, task: inputs.taskId };
  const updated = {
    ...current,
    status: 'promoted' as const,
    resolved_at: new Date().toISOString(),
    promoted_to: promotedTo,
  };

  const operationId = createHash('sha256')
    .update(JSON.stringify({ milestone: activeMilestone, id, operation: 'promote', promotedTo }))
    .digest('hex');

  appendJournalEntry(root, {
    milestone: activeMilestone,
    type: 'backlog_recording',
    operationId,
    target: id,
    payload: { operation: 'promote', item: updated },
  });
  saveBacklog(root, {
    schema_version: backlog.schema_version,
    items: backlog.items.map((item) => (item.id === id ? updated : item)),
  });

  return { id, status: 'promoted', promoted_to: promotedTo };
}
