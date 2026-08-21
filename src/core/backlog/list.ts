import type { BacklogItem, BacklogStatus } from '../../state/schemas.js';
import { loadBacklog } from '../../state/store.js';

// backlog list: read-only, never writes to backlog.yaml or the journal.
export function listBacklogItems(root: string, status?: BacklogStatus): BacklogItem[] {
  const backlog = loadBacklog(root);
  if (status === undefined) return backlog.items;
  return backlog.items.filter((item) => item.status === status);
}
