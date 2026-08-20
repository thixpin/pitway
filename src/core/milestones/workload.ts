import type { MilestoneStatus } from '../../state/schemas.js';
import type { MilestoneProgress } from './progress.js';

// AC003 (M013): the five-band cumulative workload formula already in live
// use as an informal driver convention -- drafting 5%, confirmation +5%
// (10% cumulative), weighted task execution up to +75% (85% cumulative),
// final verification +10% (95% cumulative), completion +5% (100%, only
// exactly 100%). `verificationPassed` is a plain boolean input -- this
// function never reads verification-results.yaml itself; callers derive it
// via the shared computeLatestCheckResults/allChecksPassed helper
// (src/core/verification/status.ts).
export function computeWorkloadPercentage(
  status: MilestoneStatus,
  progress: MilestoneProgress,
  verificationPassed: boolean,
): number {
  // `completed` short-circuits unconditionally: milestone-complete's own
  // gate already guarantees verification passed before status can become
  // `completed`, so this never actually diverges from the band sum in
  // practice -- and it defensively keeps an already-completed milestone from
  // ever rendering as anything other than its own real terminal state, even
  // given a stale/inconsistent verificationPassed argument.
  if (status === 'completed') return 100;
  if (status === 'draft') return 5;

  let pct = 10;
  const taskRatio = progress.total === 0 ? 0 : progress.completed / progress.total;
  pct += taskRatio * 75;
  if (verificationPassed) pct += 10;
  return Math.round(pct);
}
