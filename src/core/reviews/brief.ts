import { loadContract, loadReviews, loadTasks } from '../../state/store.js';
import type { ContractFrontmatter, Task } from '../../state/schemas.js';
import { computeCurrentReviewContentHash } from './session.js';
import { getReviewRole } from './roles.js';

export class ReviewBriefError extends Error {}

// AC004: the findings-only mandate plus the exact YAML shape AC005's
// `record --file` accepts -- reviewers never mutate or confirm anything; a
// review command is the only way a finding is ever recorded.
export const REVIEW_INSTRUCTIONS = `You are reviewing this milestone from a single role's perspective.
Produce FINDINGS ONLY. You never modify, confirm, or otherwise mutate any
PitWay state -- recording your findings via "pitway milestone-review
record" is the only effect this review has, and only the developer/driver
decides what happens next.

Record your findings as a YAML file with exactly this top-level shape,
then have the driver run:
  pitway milestone-review record <milestone-id> --role <your-role> --file <path>

findings:
  - severity: blocker | major | minor
    finding: <what you found, up to 1000 characters>
    targets: [ACnnn or Tnnn ids this concerns]   # optional
    recommendation: <what to do about it, up to 300 characters>
    conflicts_with: [other role ids you disagree with]   # optional

An empty findings list ("findings: []") is a valid outcome -- a clean
review is a result too.`;

export interface ReviewBriefView {
  milestone: string;
  sessionId: string;
  role: string;
  focus: string;
  instructions: string;
  contract: { frontmatter: ContractFrontmatter; body: string };
  tasks: Task[];
  contentHash: string;
}

// AC004: read-only. Refuses when no session is open, when the role isn't
// part of the open session, when the milestone is terminal (completed/
// cancelled), or when the milestone's content has moved since the session
// was opened (the definition-hash staleness gate -- detects, never
// prevents, an out-of-band contract/task edit).
export function buildReviewBrief(root: string, milestoneId: string, role: string): ReviewBriefView {
  const contract = loadContract(root, milestoneId);
  if (contract.frontmatter.status === 'completed' || contract.frontmatter.status === 'cancelled') {
    throw new ReviewBriefError(
      `cannot brief a review for ${milestoneId}: milestone status is "${contract.frontmatter.status}" (terminal)`,
    );
  }

  const reviews = loadReviews(root, milestoneId);
  const session = reviews.sessions.find((s) => s.status === 'open');
  if (session === undefined) {
    throw new ReviewBriefError(`cannot brief a review for ${milestoneId}: no open review session`);
  }
  if (!session.roles.includes(role)) {
    throw new ReviewBriefError(
      `role "${role}" is not part of the open session ${session.id} (roles: ${session.roles.join(', ')})`,
    );
  }

  const currentHash = computeCurrentReviewContentHash(root, milestoneId);
  if (currentHash !== session.content_hash) {
    throw new ReviewBriefError(
      `cannot brief: ${milestoneId}'s contract/task content was revised since session ${session.id} ` +
        `opened -- start a fresh session (decide --outcome rejected abandons this stale one)`,
    );
  }

  const focus = getReviewRole(role)?.focus ?? '';
  const tasks = loadTasks(root, milestoneId).tasks;

  return {
    milestone: milestoneId,
    sessionId: session.id,
    role,
    focus,
    instructions: REVIEW_INSTRUCTIONS,
    contract: { frontmatter: contract.frontmatter, body: contract.body },
    tasks,
    contentHash: session.content_hash,
  };
}
