import { randomBytes } from 'node:crypto';
import { appendBacklogArchiveRecord } from '../../state/journal.js';
import { BacklogError } from './add.js';
import { transitionBacklogItem } from './state-machine.js';
import { loadBacklog, saveBacklog } from '../../state/store.js';

export { BacklogError };

export interface BacklogArchiveView {
  id: string;
  status: 'archived';
}

function generateArchiveId(): string {
  return `ba-${randomBytes(6).toString('hex')}`;
}

// backlog archive (AC002, AC004, M021/T002 B007): deliberately no
// --milestone/--task parameter -- archiving names no other milestone/task.
// Unlike add/promote, archive never requires an active milestone: it
// finalizes an already fully identified existing item rather than creating
// new pending state, so M018's shared-non-exclusive-journal-target safety
// reasoning never applied to it. Journal-backed via the dedicated
// backlog_archive sibling record kind (no milestone field), never
// appendJournalEntry/backlog_recording.
export function archiveBacklogItem(root: string, id: string, reason: string): BacklogArchiveView {
  const trimmedReason = reason.trim();
  if (trimmedReason.length === 0) {
    throw new BacklogError('backlog archive requires a non-empty --reason');
  }

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

  appendBacklogArchiveRecord(root, {
    id: generateArchiveId(),
    target: id,
    reason: trimmedReason,
    at: updated.resolved_at,
  });
  saveBacklog(root, {
    schema_version: backlog.schema_version,
    items: backlog.items.map((item) => (item.id === id ? updated : item)),
  });

  return { id, status: 'archived' };
}
