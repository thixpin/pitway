import { readJournal } from '../../state/journal.js';
import { derivePending, resolveTargetPath } from '../../state/journal-operations.js';
import { resolveMilestoneDirName } from '../../state/store.js';

// M038/T002 (AC005): the repo-relative state files that pending journal
// entries for `milestoneId` have already materialized on disk (usage.yaml,
// contract.md, tasks.yaml, reviews.yaml, or the root-level backlog.yaml).
// Callers hand the result to src/git/safety.ts's classifyDirtyPaths as
// `journalTargetPaths` so those paths count as expected dirt -- keeping
// safety.ts a pure Git module with no journal or milestone-directory
// knowledge of its own. This is the exact branch safety.ts used to run
// inline, moved up into Core where State access belongs.
//
// An unresolvable milestone directory yields [] rather than throwing: no
// journal-pending path can then be classified expected, and everything
// falls through to the caller's other classification rules -- the same
// swallow reconcilePending applies for the same reason.
export function resolvePendingJournalTargets(root: string, milestoneId: string): string[] {
  const pending = derivePending(readJournal(root)).filter((entry) => entry.milestone === milestoneId);
  if (pending.length === 0) return [];
  let milestoneDir: string;
  try {
    milestoneDir = resolveMilestoneDirName(root, milestoneId);
  } catch {
    return [];
  }
  return [...new Set(pending.map((entry) => resolveTargetPath(entry, milestoneDir)))];
}
