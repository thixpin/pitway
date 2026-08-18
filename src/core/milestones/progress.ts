import type { Task } from '../../state/schemas.js';

export interface MilestoneProgress {
  completed: number;
  total: number;
}

// Deterministic: completed required tasks / total required tasks. A
// cancelled task is no longer required, so it counts toward neither side.
// No estimation and no per-task percentages — see IMPLEMENTATION_PLAN.md §12.
export function computeMilestoneProgress(tasks: Task[]): MilestoneProgress {
  const required = tasks.filter((t) => t.status !== 'cancelled');
  const completed = required.filter((t) => t.status === 'completed');
  return { completed: completed.length, total: required.length };
}
