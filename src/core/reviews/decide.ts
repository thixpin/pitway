import { randomUUID } from 'node:crypto';
import { appendJournalEntry } from '../../state/journal.js';
import { loadContract, loadReviews, saveReviews } from '../../state/store.js';
import type { ReviewDecision } from '../../state/schemas.js';
import { deriveLatestFindingsByRole } from './roles.js';

export class ReviewDecideError extends Error {}

export interface DecideReviewInputs {
  outcome: ReviewDecision['outcome'];
  note?: string;
}

export interface DecideReviewView {
  milestone: string;
  sessionId: string;
  outcome: ReviewDecision['outcome'];
  note: string | null;
  decidedAt: string;
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// AC007: closes the open session. `accepted`/`revision_requested` refuse
// while any selected role has no recorded snapshot, naming the pending
// roles -- deciding over an unfinished review must be explicit.
// `rejected` alone is permitted with pending roles (the abandonment path
// brief/record's stale-hash diagnostic names). Like every review mutation,
// refuses against a terminal milestone. No review command writes
// contract.md/tasks.yaml -- this one only ever touches reviews.yaml via
// the journal-backed mechanism.
export function decideReview(
  root: string,
  milestoneId: string,
  inputs: DecideReviewInputs,
): DecideReviewView {
  const contract = loadContract(root, milestoneId);
  if (contract.frontmatter.status === 'completed' || contract.frontmatter.status === 'cancelled') {
    throw new ReviewDecideError(
      `cannot decide a review for ${milestoneId}: milestone status is "${contract.frontmatter.status}" (terminal)`,
    );
  }

  const reviews = loadReviews(root, milestoneId);
  const session = reviews.sessions.find((s) => s.status === 'open');
  if (session === undefined) {
    throw new ReviewDecideError(`cannot decide a review for ${milestoneId}: no open review session`);
  }

  if (inputs.outcome !== 'rejected') {
    const recorded = deriveLatestFindingsByRole(session.findings);
    const pending = session.roles.filter((r) => !recorded.has(r));
    if (pending.length > 0) {
      throw new ReviewDecideError(
        `cannot decide "${inputs.outcome}" for session ${session.id}: pending role(s) with no recorded ` +
          `findings: ${pending.join(', ')} -- use --outcome rejected to abandon an unfinished review explicitly`,
      );
    }
  }

  const decidedAt = nowIso();
  const decision: ReviewDecision = {
    outcome: inputs.outcome,
    decided_at: decidedAt,
    ...(inputs.note !== undefined ? { note: inputs.note } : {}),
  };

  appendJournalEntry(root, {
    milestone: milestoneId,
    type: 'review_recording',
    operationId: randomUUID(),
    target: session.id,
    payload: { sessionId: session.id, action: 'decide', outcome: inputs.outcome },
  });
  const updatedSessions = reviews.sessions.map((s) =>
    s.id === session.id ? { ...s, status: 'decided' as const, decision } : s,
  );
  saveReviews(root, milestoneId, { schema_version: 1, sessions: updatedSessions });

  return {
    milestone: milestoneId,
    sessionId: session.id,
    outcome: inputs.outcome,
    note: inputs.note ?? null,
    decidedAt,
  };
}
