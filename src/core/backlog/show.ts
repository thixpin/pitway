import type { BacklogItem } from '../../state/schemas.js';
import { loadBacklog } from '../../state/store.js';
import { BacklogError } from './add.js';

export { BacklogError };

// backlog show: read-only, never writes to backlog.yaml or the journal.
export function showBacklogItem(root: string, id: string): BacklogItem {
  const backlog = loadBacklog(root);
  const item = backlog.items.find((i) => i.id === id);
  if (item === undefined) {
    throw new BacklogError(`backlog item ${id} not found`);
  }
  return item;
}
