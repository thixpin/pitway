import { assertOnMilestoneBranch } from '../../git/branch.js';
import { commitOrResume } from '../../git/commit-or-resume.js';
import { git } from '../../git/exec.js';
import { checkWorkingTreeClean, classifyDirtyPaths } from '../../git/safety.js';
import { composeMessage, resolveCommitSha } from '../../git/trailers.js';
import { parseContractFile } from '../../state/contract-file.js';
import { reconcilePending } from '../../state/journal.js';
import { computeLatestCheckResults } from '../verification/status.js';
import { loadBacklog, saveBacklog } from '../../state/store.js';
import { appendBacklogArchiveRecord } from '../../state/journal.js';
import {
  loadContract,
  loadState,
  loadTasks,
  loadVerificationRepairs,
  resolveMilestoneDirName,
  saveContract,
  saveState,
} from '../../state/store.js';
import type { ContractFile } from '../../state/contract-file.js';
import { deterministicBranchName } from './confirm.js';
import { transitionMilestone } from './state-machine.js';

export class MilestoneCompleteError extends Error {}

export interface MilestoneCompleteView {
  id: string;
  outcome: 'committed' | 'already-committed';
  commit: string;
}

// Directory names are assigned once at creation and never renamed (AC007),
// so resolving against the current on-disk listing is correct even when
// looking up content at a past commit via git show.
const contractRepoPath = (root: string, milestoneId: string): string =>
  `.pitway/milestones/${resolveMilestoneDirName(root, milestoneId)}/contract.md`;

// AC006 completion set: the milestone's own files plus state.yaml (subset
// check — clean entries are fine; anything else dirty refuses).
// verification-repairs.yaml is listed unconditionally the same way
// usage.yaml already is: it only actually rides along in the commit when it
// is genuinely dirty (e.g. a cancelled repair's uncommitted status write,
// which has no dedicated commit of its own — see verification-repair
// cancel), never forced.
const completionPaths = (root: string, milestoneId: string): string[] => {
  const dir = resolveMilestoneDirName(root, milestoneId);
  return [
    `.pitway/milestones/${dir}/contract.md`,
    `.pitway/milestones/${dir}/tasks.yaml`,
    `.pitway/milestones/${dir}/verification-results.yaml`,
    `.pitway/milestones/${dir}/verification-repairs.yaml`,
    `.pitway/milestones/${dir}/usage.yaml`,
    // M015/T008 (AC008): a review recorded after the last task completes
    // rides the completion commit like every other per-milestone file
    // above. Subset semantics keep this harmless when absent.
    `.pitway/milestones/${dir}/reviews.yaml`,
    '.pitway/state.yaml',
  ];
};

// AC007 completion identity: a completion-subject candidate whose committed
// contract.md shows status completed. AC005/T005 (M012): since, when passed
// (the milestone's own already-recorded base_revision), bounds the search.
function findCompletionCommit(root: string, milestoneId: string, since?: string): string | undefined {
  const sha = resolveCommitSha(root, {
    milestone: milestoneId,
    messagePrefix: `workflow: complete milestone ${milestoneId}`,
    ...(since !== undefined ? { since } : {}),
  });
  if (sha === undefined) return undefined;
  const committed = parseContractFile(
    git(['show', `${sha}:${contractRepoPath(root, milestoneId)}`], root),
  );
  return committed.frontmatter.status === 'completed' ? sha : undefined;
}

// AC005: every non-cancelled task completed and the latest result for every
// check pass — diagnostics name exactly what is missing.
function assertGatesSatisfied(root: string, milestoneId: string, contract: ContractFile): void {
  const incompleteTasks = loadTasks(root, milestoneId)
    .tasks.filter((t) => t.status !== 'cancelled' && t.status !== 'completed')
    .map((t) => `${t.id} (${t.status})`);

  const latest = computeLatestCheckResults(root, milestoneId);
  const missingChecks: string[] = [];
  const failingChecks: string[] = [];
  for (const check of contract.frontmatter.verification) {
    const status = latest.get(check.id);
    if (status === undefined) missingChecks.push(check.id);
    else if (status !== 'pass') failingChecks.push(check.id);
  }

  const problems: string[] = [];
  if (incompleteTasks.length > 0) problems.push(`tasks not completed: ${incompleteTasks.join(', ')}`);
  if (missingChecks.length > 0) {
    problems.push(`checks with no recorded result: ${missingChecks.join(', ')}`);
  }
  if (failingChecks.length > 0) {
    problems.push(`checks whose latest result is fail: ${failingChecks.join(', ')}`);
  }
  if (problems.length > 0) {
    throw new MilestoneCompleteError(`cannot complete ${milestoneId}: ${problems.join('; ')}`);
  }
}

// AC002: a milestone with a still-pending verification repair is not yet
// eligible for completion — approve/commit/cancel own that lifecycle
// exclusively; milestone-complete only ever reads verification-repairs.yaml
// here, never writes it.
function assertNoPendingVerificationRepair(root: string, milestoneId: string): void {
  const pending = loadVerificationRepairs(root, milestoneId).records.filter(
    (r) => r.status === 'pending',
  );
  if (pending.length > 0) {
    throw new MilestoneCompleteError(
      `cannot complete ${milestoneId}: verification repair(s) still pending: ` +
        `${pending.map((r) => r.id).join(', ')}; commit or cancel them first`,
    );
  }
}

// Refuses before anything is written or staged.
function assertNoUnexpectedDirtyPaths(root: string, expectedPaths: string[]): void {
  const expected = new Set(expectedPaths);
  const unexpected = checkWorkingTreeClean(root).dirtyPaths.filter((p) => !expected.has(p));
  if (unexpected.length > 0) {
    throw new MilestoneCompleteError(
      `cannot safely proceed: unrelated dirty changes present: ${unexpected.join(', ')}`,
    );
  }
}

// AC006: clears active_milestone only if it currently points at this
// milestone; idempotent on re-entry.
function clearActiveMilestone(root: string, milestoneId: string): void {
  const state = loadState(root);
  if (state.active_milestone === milestoneId) {
    saveState(root, { ...state, active_milestone: null });
  }
}

// AC003/T003 (M012): resolves the branch this milestone's completion commit
// must land on, or null when no branch is tracked -- reuses the same
// deterministic naming confirm.ts itself derives from, never a separately
// duplicated computation.
function expectedMilestoneBranch(contract: ContractFile): string | null {
  const { base_branch: baseBranch, id, title } = contract.frontmatter;
  return baseBranch != null ? deterministicBranchName(id, title) : null;
}

function createCompletionCommit(
  root: string,
  milestoneId: string,
  expectedPaths: string[],
  since?: string,
): MilestoneCompleteView {
  const result = commitOrResume(root, {
    expectedPaths,
    findExistingCommit: () => findCompletionCommit(root, milestoneId, since),
    localStateAdvanced: true,
    message: composeMessage(`workflow: complete milestone ${milestoneId}`, {
      'PitWay-Milestone': milestoneId,
    }),
  });
  return { id: milestoneId, outcome: result.outcome, commit: result.sha };
}

export function completeMilestone(root: string, milestoneId: string): MilestoneCompleteView {
  const contract = loadContract(root, milestoneId);
  const { status } = contract.frontmatter;

  // Any usage.yaml/contract.md already materialized by a pending journal
  // entry (usage-add / milestone-confirm --amend, both immediate-write, no
  // commit of their own) is expected to ride along in this completion
  // commit rather than being refused as unrelated dirt.
  const journalExpected = classifyDirtyPaths(root, { journalMilestone: milestoneId }).expected;
  const expectedPaths = [
    ...new Set([...completionPaths(root, milestoneId), '.pitway/backlog.yaml', ...journalExpected]),
  ];
  const expectedBranch = expectedMilestoneBranch(contract);
  // AC005/T005 (M012): bounds every lookup below to since..HEAD when tracked.
  const since = contract.frontmatter.base_revision ?? undefined;

  if (status === 'in_progress') {
    const existing = findCompletionCommit(root, milestoneId, since);
    if (existing !== undefined) {
      throw new MilestoneCompleteError(
        `ambiguous state: completion commit ${existing} already exists but ${milestoneId} is ` +
          `still in_progress; inspect manually`,
      );
    }
    assertGatesSatisfied(root, milestoneId, contract);
    assertNoPendingVerificationRepair(root, milestoneId);
    assertNoUnexpectedDirtyPaths(root, expectedPaths);
    // AC003/T003 (M012): checked before any state write below -- a
    // wrong-branch attempt leaves nothing dirty, not even the status write.
    assertOnMilestoneBranch(root, expectedBranch);

    // B024: Core-enforced backlog closure -- a promoted item whose target task
    // completed inside THIS milestone is auto-archived here (journal-recorded,
    // riding the completion commit), so closure never depends on driver memory.
    // Items promoted to tasks that did not complete, and everything else, are
    // left untouched for the driver/developer to reconcile.
    const backlog = loadBacklog(root);
    let backlogDirty = false;
    for (const item of backlog.items) {
      if (item.status !== 'promoted' || item.promoted_to?.milestone !== milestoneId) continue;
      const targetTask = loadTasks(root, milestoneId).tasks.find(
        (t) => t.id === item.promoted_to!.task,
      );
      if (targetTask?.status !== 'completed') continue;
      const reason = `auto-closed: promoted work completed via ${milestoneId} completion`;
      const updatedItem = {
        ...item,
        status: 'archived' as const,
        resolved_at: new Date().toISOString(),
        archived_reason: reason,
      };
      appendBacklogArchiveRecord(root, {
        id: `ba-${Date.now().toString(16)}${Math.floor(Math.random() * 1e6).toString(16)}`,
        target: item.id,
        reason,
        at: updatedItem.resolved_at,
      });
      backlog.items = backlog.items.map((i) => (i.id === item.id ? updatedItem : i));
      backlogDirty = true;
    }
    if (backlogDirty) saveBacklog(root, backlog);

    // One persisted status write: in_progress -> review -> completed collapsed.
    const finalStatus = transitionMilestone(transitionMilestone(status, 'review'), 'completed');
    saveContract(root, milestoneId, {
      frontmatter: { ...contract.frontmatter, status: finalStatus },
      body: contract.body,
    });
    clearActiveMilestone(root, milestoneId);
    const result = createCompletionCommit(root, milestoneId, expectedPaths, since);
    // Safe/idempotent regardless of whether this commit was the one that
    // actually captured a pending journal entry — reconcilePending derives
    // that from HEAD's content itself.
    reconcilePending(root, milestoneId);
    return result;
  }

  if (status === 'completed') {
    // AC007 resume path: local state already advanced past the completion write.
    const existing = findCompletionCommit(root, milestoneId, since);
    if (existing !== undefined) {
      reconcilePending(root, milestoneId);
      return { id: milestoneId, outcome: 'already-committed', commit: existing };
    }
    assertNoUnexpectedDirtyPaths(root, expectedPaths);
    assertOnMilestoneBranch(root, expectedBranch);
    // Re-apply the (idempotent) state clear in case the write was interrupted.
    clearActiveMilestone(root, milestoneId);
    const result = createCompletionCommit(root, milestoneId, expectedPaths, since);
    reconcilePending(root, milestoneId);
    return result;
  }

  throw new MilestoneCompleteError(
    `cannot complete ${milestoneId} in status "${status}"; milestone-complete requires an ` +
      `in_progress milestone`,
  );
}
