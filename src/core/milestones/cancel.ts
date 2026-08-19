import { loadContract, loadState, saveContract, saveState } from '../../state/store.js';
import { transitionMilestone } from './state-machine.js';

export class MilestoneCancelError extends Error {}

export interface MilestoneCancelView {
  id: string;
  status: 'cancelled';
}

// AC001: the preserve-and-retire path -- draft-only, no git operation, the
// directory and contract.md are never deleted (preserved with
// status: cancelled as a permanent record), and the id is never reused
// (state.milestones is left untouched, so nextMilestoneId's max(existing)+1
// logic skips it forever).
export function cancelMilestone(root: string, id: string): MilestoneCancelView {
  const contract = loadContract(root, id);
  const { status } = contract.frontmatter;
  if (status !== 'draft') {
    throw new MilestoneCancelError(
      `cannot cancel ${id} in status "${status}"; milestone-cancel requires a draft milestone`,
    );
  }

  const nextStatus = transitionMilestone(status, 'cancelled');
  saveContract(root, id, {
    frontmatter: { ...contract.frontmatter, status: nextStatus },
    body: contract.body,
  });

  const state = loadState(root);
  if (state.active_milestone === id) {
    saveState(root, { ...state, active_milestone: null });
  }

  return { id, status: nextStatus as 'cancelled' };
}
