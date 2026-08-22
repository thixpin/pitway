import type { BacklogItem, BacklogStatus } from '../../state/schemas.js';
import { loadBacklog } from '../../state/store.js';

export interface BacklogListFilters {
  status?: BacklogStatus;
  milestone?: string;
  task?: string;
}

// backlog list: read-only, never writes to backlog.yaml or the journal.
export function listBacklogItems(
  root: string,
  statusOrFilters?: BacklogStatus | BacklogListFilters,
  milestone?: string,
  task?: string,
): BacklogItem[] {
  let filters: BacklogListFilters = {};
  if (typeof statusOrFilters === 'string') {
    filters.status = statusOrFilters as BacklogStatus;
  } else if (statusOrFilters !== undefined && statusOrFilters !== null) {
    filters = { ...(statusOrFilters as BacklogListFilters) };
  }
  if (milestone !== undefined) filters.milestone = milestone;
  if (task !== undefined) filters.task = task;

  const backlog = loadBacklog(root);
  return backlog.items.filter((item) => {
    if (filters.status !== undefined && item.status !== filters.status) return false;
    if (filters.milestone !== undefined && item.source.milestone !== filters.milestone) return false;
    if (filters.task !== undefined && item.source.task !== filters.task) return false;
    return true;
  });
}
