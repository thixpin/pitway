import type { BacklogStatus } from '../../state/schemas.js';

// M018/T002 (AC002): pending -> promoted|archived are the only two
// transitions, both terminal -- mirrors src/core/tasks/state-machine.ts's
// exact shape and error format.
const TRANSITIONS: Record<BacklogStatus, BacklogStatus[]> = {
  pending: ['promoted', 'archived'],
  promoted: [],
  archived: [],
};

export function canTransitionBacklogItem(from: BacklogStatus, to: BacklogStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function transitionBacklogItem(from: BacklogStatus, to: BacklogStatus): BacklogStatus {
  if (!canTransitionBacklogItem(from, to)) {
    const allowed = TRANSITIONS[from];
    const allowedText = allowed.length > 0 ? allowed.join(', ') : '(none — terminal state)';
    throw new Error(
      `cannot transition backlog item from "${from}" to "${to}"; allowed target states: ${allowedText}`,
    );
  }
  return to;
}
