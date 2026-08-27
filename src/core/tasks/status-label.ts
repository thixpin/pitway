import type { TaskStatus } from '../../state/schemas.js';

// B037: the task-status presentation label. Lives in Core (not cli/format.ts)
// because buildMilestoneStatusView embeds it in the view's `statusLabel`
// field, which is part of the --json contract -- so Core must produce it
// without importing the CLI layer. Status values themselves stay plain
// engineering vocabulary everywhere else (schemas, state files, logs).
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
