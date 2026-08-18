import type { MilestoneStatus } from '../../state/schemas.js';

const TRANSITIONS: Record<MilestoneStatus, MilestoneStatus[]> = {
  draft: ['confirmed', 'cancelled'],
  confirmed: ['in_progress', 'cancelled'],
  in_progress: ['review'],
  review: ['completed', 'in_progress'],
  completed: [],
  cancelled: [],
};

export function canTransitionMilestone(from: MilestoneStatus, to: MilestoneStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function transitionMilestone(from: MilestoneStatus, to: MilestoneStatus): MilestoneStatus {
  if (!canTransitionMilestone(from, to)) {
    const allowed = TRANSITIONS[from];
    const allowedText = allowed.length > 0 ? allowed.join(', ') : '(none — terminal state)';
    throw new Error(
      `cannot transition milestone from "${from}" to "${to}"; allowed target states: ${allowedText}`,
    );
  }
  return to;
}
