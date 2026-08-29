import { commitOrResume } from '../../git/commit-or-resume.js';
import { checkWorkingTreeClean } from '../../git/safety.js';
import { composeMessage, resolveChangeCommitSha } from '../../git/trailers.js';
import { archiveBacklogItem } from '../backlog/archive.js';
import { listBacklogItems } from '../backlog/list.js';
import { appendQuickChangeRecord, type JournalQuickChange } from '../../state/journal.js';
import { listSafeManagedDirtyPaths } from '../../state/managed-init-paths.js';
import { QuickChangeError, requireQuickChange } from './create.js';

// The one deterministic path a --closes commit ever adds to expectedPaths,
// beyond the change's own declared scope -- mirrors the literal string
// src/core/milestones/complete.ts already uses for the identical purpose
// (backlog.yaml is a shared, root-level file with no per-caller path
// helper exported from state/store.ts to reuse).
const BACKLOG_PATH = '.pitway/backlog.yaml';

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

function appendCommittedSnapshot(root: string, current: JournalQuickChange): void {
  appendQuickChangeRecord(root, {
    id: current.id,
    status: 'committed',
    objective: current.objective,
    scope: current.scope,
    verifyCommand: current.verifyCommand,
    approvedHash: current.approvedHash,
    runs: current.runs,
    ...(current.tddExempt !== undefined ? { tddExempt: current.tddExempt } : {}),
    ...(current.tddExemptReason !== undefined ? { tddExemptReason: current.tddExemptReason } : {}),
    ...(current.closesBacklogId !== undefined ? { closesBacklogId: current.closesBacklogId } : {}),
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
// B041: a bounded commit subject derived from the objective. The subject is
// the objective's first sentence (up to the first ". " / "! " / "? " or a
// newline), cut at a word boundary so the whole line -- including the
// "fix: " prefix -- stays within SUBJECT_MAX, with an ellipsis when cut.
// Whenever the subject does not carry the objective verbatim, the full
// objective follows as the body, so nothing the developer approved at
// `create` is lost from the commit. A short single-sentence objective
// commits exactly as before: `fix: <objective>` and no body.
const SUBJECT_PREFIX = 'fix: ';
const SUBJECT_MAX = 72;

export function buildCommitText(objective: string): string {
  const flat = objective.replace(/\s+/g, ' ').trim();
  const sentenceEnd = flat.search(/[.!?](\s|$)/);
  const firstSentence = sentenceEnd === -1 ? flat : flat.slice(0, sentenceEnd + 1);
  const budget = SUBJECT_MAX - SUBJECT_PREFIX.length;
  let subjectText = firstSentence;
  if (subjectText.length > budget) {
    const cut = subjectText.slice(0, budget - 1);
    const lastSpace = cut.lastIndexOf(' ');
    subjectText = `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
  }
  const subject = `${SUBJECT_PREFIX}${subjectText}`;
  return subjectText === flat ? subject : `${subject}\n\n${objective}`;
}

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

  // B020: TDD discipline — for behavior-changing changes, require RED→GREEN
  // evidence (at least one failing run before the final passing run), unless
  // the change was explicitly declared tdd-exempt at create time (doc-only /
  // genuinely test-free, with a reason).
  if (current.tddExempt !== true) {
    const hasPriorFail = current.runs.slice(0, -1).some((r) => r.status === 'fail');
    if (!hasPriorFail) {
      throw new QuickChangeError(
        `cannot commit ${changeId}: TDD discipline requires at least one failing run before the passing run (RED→GREEN); ` +
          `run the verify command before the fix to confirm RED, then again after to confirm GREEN, ` +
          `or create with --tdd-exempt "<reason>" for doc-only / test-free changes`,
      );
    }
  }

  // AC005/T005: a create that succeeded in the fresh-init window still
  // leaves the same managed dirt present at commit time, and current.scope
  // (the change's own declared file scope) never covers it -- so this
  // first quick-change commit, when it is also the repository's first
  // commit since init, must also be allowed to sweep and stage the managed
  // init output alongside the change's own scope, exactly like a
  // milestone's own baseline commit already does. M037/T001: the
  // deterministic backlog.yaml path is added only when closesBacklogId is
  // set, so a no-closes commit's expectedPaths -- and therefore its
  // observable behavior -- stays byte-for-byte unchanged.
  const expectedPaths = [
    ...current.scope,
    ...listSafeManagedDirtyPaths(root),
    ...(current.closesBacklogId !== undefined ? [BACKLOG_PATH] : []),
  ];
  // Checked BEFORE the archive call below: refuses on unrelated dirt first,
  // so a commit that's going to be refused anyway never mutates the backlog
  // -- shrinks the mutate-before-refuse window to nothing on that path.
  assertDirtySubset(root, expectedPaths);

  // M037/T001: fold the linked backlog item's archive into this same
  // commit, BEFORE staging anything -- called only when the item isn't
  // already archived. Resume-safety: resolveChangeCommitSha's self-heal
  // above only covers the git-commit half of this operation; it does not
  // guard this archive call. If a prior attempt already archived the item
  // but the git commit itself never landed (crash/interrupt in between), a
  // retried commit lands here again with the local record still 'approved'
  // and existingSha still undefined -- re-checking the item's current
  // status first (mirroring completeTask's status-check-before-mutate
  // pattern, src/core/tasks/update.ts) makes that retry a safe no-op on the
  // archive half: archive.ts's transitionBacklogItem rejects an
  // archived -> archived transition by throwing, so calling
  // archiveBacklogItem unconditionally here would turn a safe retry into a
  // hard failure.
  if (current.closesBacklogId !== undefined) {
    const linkedItem = listBacklogItems(root).find((item) => item.id === current.closesBacklogId);
    if (linkedItem === undefined || linkedItem.status !== 'archived') {
      archiveBacklogItem(root, current.closesBacklogId, `closed by quick-change ${current.id}`);
    }
  }

  const message = composeMessage(buildCommitText(current.objective), { 'PitWay-Change': current.id });

  const result = commitOrResume(root, {
    expectedPaths,
    findExistingCommit: () => resolveChangeCommitSha(root, changeId),
    localStateAdvanced: true,
    message,
  });

  appendCommittedSnapshot(root, current);

  return { id: current.id, outcome: result.outcome, commit: result.sha };
}
