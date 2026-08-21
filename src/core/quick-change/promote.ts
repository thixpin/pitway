import { appendQuickChangeRecord } from '../../state/journal.js';
import { QuickChangeError, requireQuickChange } from './create.js';

// T005: converts a still-open quick-change into a milestone draft
// candidate. No CLI surface is registered from this module (see
// src/cli/commands/quick-change.ts for the `promote` subcommand).

export { QuickChangeError };

export interface QuickChangePromoteView {
  id: string;
  status: 'promoted';
  objective: string;
  scope: string[];
}

// promote: valid only from draft or approved (before commit) -- never from
// committed, cancelled, or an already-promoted change. A terminal
// transition: once promoted, a change can never later be run or committed
// as a quick-change (requireQuickChange's callers in run.ts/commit.ts only
// ever accept 'approved', which a promoted record can never be again).
//
// Scope boundary (binding -- read this before changing anything here):
// promoteQuickChange NEVER calls createMilestone and NEVER writes anything
// under .pitway/. This project's core architecture (CLAUDE.md's
// Architecture Constraints, and src/core/milestones/create.ts's own design)
// requires a milestone's contract to be drafted by a human/driver and
// explicitly approved before milestone-add/milestone-confirm ever runs --
// Core code must never silently synthesize contract content (acceptance
// criteria, tasks, verification checks) on someone's behalf. So this
// function only ever does three things: (a) validates the lifecycle
// transition, (b) appends a terminal 'promoted' journal snapshot mirroring
// cancelQuickChange's exact append-only pattern in create.ts, and (c)
// returns a plain view naming the change's own objective/scope -- exactly
// what the driver needs to go draft a real milestone contract afterward
// through the normal, human-approved milestone-add flow. Fabricating
// contract content here would be a real violation of that boundary, not a
// convenience shortcut.
export function promoteQuickChange(root: string, changeId: string): QuickChangePromoteView {
  const current = requireQuickChange(root, changeId);
  if (current.status !== 'draft' && current.status !== 'approved') {
    throw new QuickChangeError(
      `cannot promote ${changeId}: status is "${current.status}", not draft or approved`,
    );
  }
  const record = appendQuickChangeRecord(root, {
    id: current.id,
    status: 'promoted',
    objective: current.objective,
    scope: current.scope,
    verifyCommand: current.verifyCommand,
    ...(current.approvedHash !== undefined ? { approvedHash: current.approvedHash } : {}),
    runs: current.runs,
  });
  return { id: record.id, status: 'promoted', objective: record.objective, scope: record.scope };
}
