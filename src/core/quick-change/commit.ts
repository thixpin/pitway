import { commitOrResume } from '../../git/commit-or-resume.js';
import { checkWorkingTreeClean } from '../../git/safety.js';
import { composeMessage, resolveChangeCommitSha } from '../../git/trailers.js';
import {
  appendQuickChangeRecord,
  readJournal,
  type JournalQuickChange,
} from '../../state/journal.js';
import { listSafeManagedDirtyPaths } from '../../state/managed-init-paths.js';
import { deriveQuickChangeState } from './create.js';
import { QuickChangeError } from './run.js';

// T004: lands an approved quick-change as one commit via commitOrResume,
// exactly its declared scope, carrying a PitWay-Change: <change-id> trailer
// and no PitWay-Milestone/PitWay-Task trailer (a quick-change is explicitly
// milestone-less). No CLI surface is registered from this module.

export { QuickChangeError };

export interface QuickChangeCommitView {
  id: string;
  outcome: 'committed' | 'already-committed';
  commit: string;
}

function requireQuickChange(root: string, changeId: string): JournalQuickChange {
  const current = deriveQuickChangeState(readJournal(root), changeId);
  if (current === undefined) {
    throw new QuickChangeError(`unknown quick-change ${changeId}`);
  }
  return current;
}

function appendCommittedSnapshot(root: string, current: JournalQuickChange): void {
  appendQuickChangeRecord(root, {
    id: current.id,
    status: 'committed',
    objective: current.objective,
    scope: current.scope,
    verifyCommand: current.verifyCommand,
    approvedHash: current.approvedHash,
    runs: current.runs,
  });
}

// Mirrors src/core/verification/repair.ts's assertDirtySubset (a sibling
// AC002 module, not imported from, to avoid a cross-task dependency): every
// dirty path in the working tree must be a declared scope path, or the
// commit is refused before anything is staged.
function assertDirtySubset(root: string, expectedPaths: string[]): void {
  const expected = new Set(expectedPaths);
  const unexpected = checkWorkingTreeClean(root).dirtyPaths.filter((p) => !expected.has(p));
  if (unexpected.length > 0) {
    throw new QuickChangeError(
      `cannot safely proceed: unrelated dirty changes present: ${unexpected.join(', ')}`,
    );
  }
}

// commit: run only after implementation edits are made and a passing `run`
// has been recorded. Validates the dirty tree is a subset of exactly the
// declared scope, composes the commit message with only a PitWay-Change
// trailer, and commits via commitOrResume -- mirroring the exact
// resume/retry pattern src/core/verification/repair.ts's
// commitVerificationRepair and src/core/tasks/update.ts's completeTask
// already use, including checking for an already-existing matching commit
// FIRST (self-healing: if the commit already landed but the local record
// still says 'approved', detect it via the PitWay-Change trailer and just
// append the 'committed' snapshot without re-committing -- the closest real
// precedent in this codebase is repair.ts's findRepairCommit self-healing.
// Unlike findRepairCommit, no structural comparison against committed
// content is performed here: a quick-change record lives only in the
// git-invisible journal, not in any file within the commit's own scope, so
// there is nothing analogous to compare against -- exact trailer match is
// the full identity signal, which is sufficient since no other PitWay
// commit kind ever carries a PitWay-Change trailer (see
// resolveChangeCommitSha's comment in src/git/trailers.ts).
export function commitQuickChange(root: string, changeId: string): QuickChangeCommitView {
  const current = requireQuickChange(root, changeId);

  const existingSha = resolveChangeCommitSha(root, changeId);
  if (existingSha !== undefined) {
    if (current.status !== 'committed') {
      appendCommittedSnapshot(root, current);
    }
    return { id: current.id, outcome: 'already-committed', commit: existingSha };
  }

  if (current.status === 'committed') {
    throw new QuickChangeError(
      `ambiguous state: ${changeId} is recorded as committed but no matching commit was found; ` +
        `inspect manually`,
    );
  }

  if (current.status !== 'approved') {
    throw new QuickChangeError(
      `cannot commit ${changeId}: status is "${current.status}", not approved`,
    );
  }

  // "Lands the approved change as one commit" implies it must first be
  // proven to work. AC003 doesn't spell out the exact gate in these words --
  // this is a reasonable inference, checked against the LATEST run only:
  // refuse unless the most recent recorded attempt passed, requiring a
  // fresh passing `run` rather than trusting a stale earlier pass.
  const latestRun = current.runs[current.runs.length - 1];
  if (latestRun === undefined || latestRun.status !== 'pass') {
    throw new QuickChangeError(
      `cannot commit ${changeId}: no passing run recorded; run the approved verify command first`,
    );
  }

  // AC005/T005: a create that succeeded in the fresh-init window still
  // leaves the same managed dirt present at commit time, and current.scope
  // (the change's own declared file scope) never covers it -- so this
  // first quick-change commit, when it is also the repository's first
  // commit since init, must also be allowed to sweep and stage the managed
  // init output alongside the change's own scope, exactly like a
  // milestone's own baseline commit already does.
  const expectedPaths = [...current.scope, ...listSafeManagedDirtyPaths(root)];
  assertDirtySubset(root, expectedPaths);

  const message = composeMessage(`fix: ${current.objective}`, { 'PitWay-Change': current.id });

  const result = commitOrResume(root, {
    expectedPaths,
    findExistingCommit: () => resolveChangeCommitSha(root, changeId),
    localStateAdvanced: true,
    message,
  });

  appendCommittedSnapshot(root, current);

  return { id: current.id, outcome: result.outcome, commit: result.sha };
}
