import { createHash } from 'node:crypto';
import { appendJournalEntry } from '../../state/journal.js';
import { BacklogError, resolveActiveMilestoneStrict } from './add.js';
import { transitionBacklogItem } from './state-machine.js';
import { loadBacklog, saveBacklog } from '../../state/store.js';

export { BacklogError };

export interface BacklogArchiveView {
  id: string;
  status: 'archived';
}

// backlog archive (AC002, AC004): deliberately no --milestone/--task
// parameter -- archiving names no other milestone/task, and journal
// attachment is never flag-controlled (always the active milestone).
export function archiveBacklogItem(root: string, id: string, reason: string): BacklogArchiveView {
  const trimmedReason = reason.trim();
  if (trimmedReason.length === 0) {
    throw new BacklogError('backlog archive requires a non-empty --reason');
  }

  const activeMilestone = resolveActiveMilestoneStrict(root);

  const backlog = loadBacklog(root);
  const current = backlog.items.find((item) => item.id === id);
  if (current === undefined) {
    throw new BacklogError(`backlog item ${id} not found`);
  }
  transitionBacklogItem(current.status, 'archived');

  const updated = {
    ...current,
    status: 'archived' as const,
    resolved_at: new Date().toISOString(),
    archived_reason: trimmedReason,
  };

  const operationId = createHash('sha256')
    .update(JSON.stringify({ milestone: activeMilestone, id, operation: 'archive', trimmedReason }))
    .digest('hex');

  appendJournalEntry(root, {
    milestone: activeMilestone,
    type: 'backlog_recording',
    operationId,
    target: id,
    payload: { operation: 'archive', item: updated },
  });
  saveBacklog(root, {
    schema_version: backlog.schema_version,
    items: backlog.items.map((item) => (item.id === id ? updated : item)),
  });

  return { id, status: 'archived' };
}
