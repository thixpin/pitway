import type { TaskStatus } from '../../state/schemas.js';

const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  planned: ['waiting', 'cancelled'],
  waiting: ['ready', 'cancelled'],
  ready: ['in_progress', 'cancelled'],
  in_progress: ['review', 'blocked', 'failed'],
  blocked: ['ready'],
  review: ['in_progress', 'completed'],
  completed: [],
  failed: ['ready'],
  cancelled: [],
};

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function transitionTask(from: TaskStatus, to: TaskStatus): TaskStatus {
  if (!canTransitionTask(from, to)) {
    const allowed = TRANSITIONS[from];
    const allowedText = allowed.length > 0 ? allowed.join(', ') : '(none — terminal state)';
    throw new Error(
      `cannot transition task from "${from}" to "${to}"; allowed target states: ${allowedText}`,
    );
  }
  return to;
}
