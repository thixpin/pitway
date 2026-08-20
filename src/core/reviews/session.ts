import { randomUUID, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendJournalEntry } from '../../state/journal.js';
import { loadContract, loadReviews, loadTasks, resolveMilestoneDirName, saveReviews } from '../../state/store.js';
import type { ReviewSession } from '../../state/schemas.js';
import { assertKnownReviewRoles, computeReviewContentHash } from './roles.js';

export class ReviewSessionError extends Error {}

export interface StartReviewSessionInputs {
  roles: string[];
}

export interface ReviewSessionView {
  milestone: string;
  id: string;
  status: ReviewSession['status'];
  createdAt: string;
  roles: string[];
  contentHash: string;
}

function toView(milestoneId: string, session: ReviewSession): ReviewSessionView {
  return {
    milestone: milestoneId,
    id: session.id,
    status: session.status,
    createdAt: session.created_at,
    roles: session.roles,
    contentHash: session.content_hash,
  };
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function generateSessionId(): string {
  return `rev-${randomBytes(6).toString('hex')}`;
}

// Raw on-disk bytes, not a re-serialized reconstruction -- AC001's
// content_hash covers contract.md exactly as currently persisted (draft
// milestones have no baseline commit yet, so this must read the working
// tree, matching what brief/record recompute later to detect drift).
export function readContractRawText(root: string, milestoneId: string): string {
  const dir = resolveMilestoneDirName(root, milestoneId);
  return readFileSync(join(root, '.pitway', 'milestones', dir, 'contract.md'), 'utf8');
}

// Exported for T004/T005's staleness gate: recomputes the same content_hash
// a session pinned at start, from the milestone's CURRENT on-disk contract
// + task definitions.
export function computeCurrentReviewContentHash(root: string, milestoneId: string): string {
  const contractText = readContractRawText(root, milestoneId);
  const tasks = loadTasks(root, milestoneId).tasks;
  return computeReviewContentHash(contractText, tasks);
}

// AC002: unknown/duplicate/empty role refusals, each naming the offenders.
// Duplicate detection is local to this validation (not part of T001's
// registry-only assertKnownReviewRoles), then registry-membership is
// delegated to T001's helper.
function validateRoleSelection(roles: string[]): void {
  if (roles.length === 0) {
    throw new ReviewSessionError('at least one role must be selected');
  }
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const role of roles) {
    if (seen.has(role)) duplicates.add(role);
    seen.add(role);
  }
  if (duplicates.size > 0) {
    throw new ReviewSessionError(`duplicate role(s) selected: ${[...duplicates].join(', ')}`);
  }
  try {
    assertKnownReviewRoles(roles);
  } catch (error) {
    throw new ReviewSessionError((error as Error).message);
  }
}

// AC002: PitWay manages review STATE only -- this never runs a review,
// spawns a reviewer, or claims reviewer independence. Terminal-milestone
// refusal, one-open-session refusal, then pins content_hash and appends the
// journal-backed review_recording entry (materialized immediately, pending
// until the next checkpoint commit -- the exact usage/amendment mechanics).
export function startReviewSession(
  root: string,
  milestoneId: string,
  inputs: StartReviewSessionInputs,
): ReviewSessionView {
  validateRoleSelection(inputs.roles);

  const contract = loadContract(root, milestoneId);
  if (contract.frontmatter.status === 'completed' || contract.frontmatter.status === 'cancelled') {
    throw new ReviewSessionError(
      `cannot start a review for ${milestoneId}: milestone status is "${contract.frontmatter.status}" (terminal)`,
    );
  }

  const reviews = loadReviews(root, milestoneId);
  const openSession = reviews.sessions.find((s) => s.status === 'open');
  if (openSession !== undefined) {
    throw new ReviewSessionError(
      `cannot start a review for ${milestoneId}: session ${openSession.id} is still open -- decide it first`,
    );
  }

  const contentHash = computeCurrentReviewContentHash(root, milestoneId);
  const session: ReviewSession = {
    id: generateSessionId(),
    status: 'open',
    created_at: nowIso(),
    roles: inputs.roles,
    content_hash: contentHash,
    findings: [],
    decision: null,
  };

  appendJournalEntry(root, {
    milestone: milestoneId,
    type: 'review_recording',
    operationId: randomUUID(),
    target: session.id,
    payload: { sessionId: session.id, action: 'start' },
  });
  saveReviews(root, milestoneId, { schema_version: 1, sessions: [...reviews.sessions, session] });

  return toView(milestoneId, session);
}
