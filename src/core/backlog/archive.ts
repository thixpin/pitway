import { randomBytes } from 'node:crypto';
import { appendBacklogArchiveRecord, readJournal } from '../../state/journal.js';
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

  // B035: the journal write and the state write below are not atomic -- a
  // crash between them, followed by a retry (e.g. a quick-change commit's
  // status-check-then-archive guard, M037/T001, which re-reads backlog.yaml
  // and still sees the pre-crash status), would otherwise append a second
  // backlog_archive record for the same one-time logical archive event.
  // transitionBacklogItem above already refuses archived -> archived, so a
  // backlog item can only ever pass through this function once while
  // non-archived; a backlog_archive record already targeting this id at
  // that point can only mean exactly this retry scenario -- skip
  // re-journaling it, but still (re-)write state, since that's the half
  // that didn't land.
  const alreadyJournaled = readJournal(root).some(
    (entry) => entry.kind === 'backlog_archive' && entry.target === id,
  );
  if (!alreadyJournaled) {
    appendBacklogArchiveRecord(root, {
      id: generateArchiveId(),
      target: id,
      reason: trimmedReason,
      at: updated.resolved_at,
    });
  }
  saveBacklog(root, {
    schema_version: backlog.schema_version,
    items: backlog.items.map((item) => (item.id === id ? updated : item)),
  });

  return { id, status: 'archived' };
}
