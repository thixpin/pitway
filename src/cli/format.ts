import type { MilestoneStatus, TaskStatus } from '../state/schemas.js';

// Presentation only — status values themselves stay plain engineering
// vocabulary everywhere else (schemas, state files, logs).
const TASK_LABELS: Record<TaskStatus, string> = {
  planned: '◌ Planned',
  waiting: '◌ Waiting',
  ready: '◌ Ready',
  in_progress: '● In Progress',
  blocked: '⚠ Blocked',
  review: '● Review',
  completed: '✓ Completed',
  failed: '✗ Failed',
  cancelled: '✗ Cancelled',
};

export function taskStatusLabel(status: TaskStatus): string {
  return TASK_LABELS[status];
}

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
