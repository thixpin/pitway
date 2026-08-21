import { randomBytes } from 'node:crypto';
import { branchExists, checkoutBranch, currentBranch } from '../../git/branch.js';
import { git } from '../../git/exec.js';
import { abortMerge, isAncestor, isMergeInProgress, mergeBranches } from '../../git/merge.js';
import { checkWorkingTreeClean } from '../../git/safety.js';
import { resolveCommitSha } from '../../git/trailers.js';
import { parseContractFile, type ContractFile } from '../../state/contract-file.js';
import { appendMilestoneMergeRecord } from '../../state/journal.js';
import { loadContract, MilestoneResolutionError, resolveMilestoneDirName } from '../../state/store.js';
import { deterministicBranchName } from './confirm.js';

export class MilestoneMergeError extends Error {}

export interface MilestoneMergeView {
  id: string;
  target: string;
  source: string;
  outcome: 'merged' | 'already-merged';
  commit: string;
}

export interface MergeMilestoneOptions {
  target?: string;
}

// Directory names are assigned once at creation and never renamed, so
// resolving against the current on-disk listing is correct even when
// looking up content at a past commit via git show (same reasoning as
// src/core/milestones/complete.ts's own identically-named helper).
const contractRepoPath = (root: string, milestoneId: string): string =>
  `.pitway/milestones/${resolveMilestoneDirName(root, milestoneId)}/contract.md`;

// AC002: mirrors src/core/milestones/complete.ts's own findCompletionCommit
// exactly (a "workflow: complete milestone <id>" commit whose committed
// contract.md shows status completed). Duplicated locally rather than
// imported -- this task's write scope is this file only, complete.ts is
// untouched -- so the two copies must be kept in sync by hand if that
// identity contract ever changes.
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

function generateMergeId(): string {
  return `mm-${randomBytes(6).toString('hex')}`;
}

// AC002 wrong-branch/detached-HEAD refusal message -- shared by both the
// case where this branch has no record of the milestone at all (no
// .pitway/milestones/<id> directory here) and the case where it does but
// the specific completion commit isn't reachable from current HEAD; both
// mean the same thing to the caller: this isn't the milestone's own branch
// or a branch it has already been merged into.
function wrongBranchRefusal(milestoneId: string): MilestoneMergeError {
  return new MilestoneMergeError(
    `completion commit for ${milestoneId} not found in current branch history -- run ` +
      `milestone-merge from ${milestoneId}'s own branch or a branch it has already been merged into`,
  );
}

// Merges a completed milestone's own branch into a target branch (default
// the milestone's recorded base_branch). Every state read this needs --
// contract frontmatter, base_branch, the completion commit SHA -- is
// resolved from the CURRENT branch before any checkout runs (AC002): under
// branch_strategy: milestone, the target branch carries none of the
// milestone's own .pitway/ state until this merge lands, so reading it
// after checking out the target would silently see stale or missing data.
export function mergeMilestone(
  root: string,
  milestoneId: string,
  options: MergeMilestoneOptions = {},
): MilestoneMergeView {
  // AC002: on a branch with no record of this milestone at all (no
  // .pitway/milestones/<id> directory here -- the common case for an
  // unrelated third branch or a pre-milestone detached HEAD under
  // branch_strategy: milestone, where the directory only ever exists on
  // the milestone's own branch until it merges), this is the same
  // wrong-branch situation the completion-commit walk below detects --
  // refused with the identical message rather than a raw resolution error.
  let contract: ContractFile;
  try {
    contract = loadContract(root, milestoneId);
  } catch (error) {
    if (error instanceof MilestoneResolutionError) {
      throw wrongBranchRefusal(milestoneId);
    }
    throw error;
  }
  const { status, base_branch: baseBranch, base_revision: baseRevision, title } = contract.frontmatter;

  // AC001: fires before any git command at all -- loadContract is a plain
  // file read.
  if (status !== 'completed') {
    throw new MilestoneMergeError(
      `cannot merge ${milestoneId}: status is "${status}"; milestone-merge requires a completed milestone`,
    );
  }

  // AC003: a main-strategy milestone (or one confirmed before branch
  // isolation existed) has no separate branch to merge, regardless of
  // whether an explicit --target was given.
  if (baseBranch == null) {
    throw new MilestoneMergeError(
      `cannot merge ${milestoneId}: base_branch is null -- a main-strategy milestone commits ` +
        `directly to its base branch and has no separate branch to merge`,
    );
  }

  const targetBranch = options.target ?? baseBranch;
  const sourceBranch = deterministicBranchName(milestoneId, title);
  const since = baseRevision ?? undefined;

  // AC002 wrong-branch / detached-HEAD refusal: if the since..HEAD walk
  // (bounded to the milestone's own base_revision, same as
  // complete.ts/confirm.ts) can't find the completion commit in current
  // HEAD's history, this is not the milestone's own branch and not a
  // branch it has already been merged into -- refuse by name rather than a
  // blanket branch-name assertion, which would incorrectly reject the
  // legitimate idempotent re-run from the target branch post-merge.
  const completionSha = findCompletionCommit(root, milestoneId, since);
  if (completionSha === undefined) {
    throw wrongBranchRefusal(milestoneId);
  }

  // AC004(5): checked before the generic dirty-tree check -- an interrupted
  // prior merge also leaves the working tree dirty (staged or unmerged
  // paths), but deserves its own actionable message naming manual recovery
  // rather than a generic "working tree is dirty" one.
  if (isMergeInProgress(root)) {
    throw new MilestoneMergeError(
      `cannot merge ${milestoneId}: a merge is already in progress (MERGE_HEAD present) -- run ` +
        `"git merge --abort" manually to recover before retrying`,
    );
  }

  if (!checkWorkingTreeClean(root).clean) {
    throw new MilestoneMergeError(`cannot merge ${milestoneId}: working tree is dirty`);
  }

  if (!branchExists(root, targetBranch)) {
    throw new MilestoneMergeError(
      `cannot merge ${milestoneId}: target branch ${targetBranch} does not exist`,
    );
  }

  const at = new Date().toISOString();

  // AC005: idempotent short-circuit, checked against the completion commit
  // SHA rather than the source branch tip -- the source branch may already
  // be deleted by the time a second invocation runs (a real possibility
  // this milestone's own scope disclosed), and that alone must never block
  // recognizing an already-completed merge. Deliberately checked before the
  // source-branch-exists refusal below, which only matters for an actual
  // merge attempt.
  if (isAncestor(root, completionSha, targetBranch)) {
    appendMilestoneMergeRecord(root, {
      id: generateMergeId(),
      milestone: milestoneId,
      targetBranch,
      mergeCommitSha: completionSha,
      alreadyMerged: true,
      at,
    });
    return {
      id: milestoneId,
      target: targetBranch,
      source: sourceBranch,
      outcome: 'already-merged',
      commit: completionSha,
    };
  }

  // AC004(3): a deleted milestone branch, reached only on the non-idempotent
  // path, produces a named PitWay refusal rather than a raw git error from
  // the checkout/merge attempt below.
  if (!branchExists(root, sourceBranch)) {
    throw new MilestoneMergeError(
      `cannot merge ${milestoneId}: source branch ${sourceBranch} does not exist`,
    );
  }

  const originalBranch = currentBranch(root);
  const mergeMessage = `merge: ${milestoneId} ${title}`;
  checkoutBranch(root, targetBranch);

  let mergeSha: string;
  try {
    mergeSha = mergeBranches(root, sourceBranch, mergeMessage);
  } catch (error) {
    // AC004(4)/(5): restores on ANY thrown error during the merge attempt,
    // not only a content conflict -- a pre-merge-commit hook rejection
    // leaves the same MERGE_HEAD-present, staged-but-uncommitted state a
    // real content conflict does (confirmed by inspection), so the same
    // recovery covers both: abort only when a merge is actually in
    // progress, then always restore the original branch, then refuse.
    if (isMergeInProgress(root)) {
      abortMerge(root);
    }
    checkoutBranch(root, originalBranch);
    throw new MilestoneMergeError(
      `cannot merge ${milestoneId}: merge into ${targetBranch} failed and was rolled back ` +
        `(${(error as Error).message})`,
    );
  }

  appendMilestoneMergeRecord(root, {
    id: generateMergeId(),
    milestone: milestoneId,
    targetBranch,
    mergeCommitSha: mergeSha,
    alreadyMerged: false,
    at,
  });

  return {
    id: milestoneId,
    target: targetBranch,
    source: sourceBranch,
    outcome: 'merged',
    commit: mergeSha,
  };
}
