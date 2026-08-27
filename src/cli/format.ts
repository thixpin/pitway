import type { MilestoneStatus } from '../state/schemas.js';

// B037: taskStatusLabel moved to Core (src/core/tasks/status-label.ts) so
// Core view assembly can embed it; re-exported here so every CLI renderer
// keeps importing it from the same place.
export { taskStatusLabel } from '../core/tasks/status-label.js';

// Presentation only — status values themselves stay plain engineering
// vocabulary everywhere else (schemas, state files, logs).
const MILESTONE_LABELS: Record<MilestoneStatus, string> = {
  draft: '◌ Draft',
  confirmed: '◌ Confirmed',
  in_progress: '● In Progress',
  review: '● Review',
  completed: '✓ Completed',
  cancelled: '✗ Cancelled',
};

export function milestoneStatusLabel(status: MilestoneStatus): string {
  return MILESTONE_LABELS[status];
}
