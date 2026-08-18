import { computeExpectedBaselinePaths, createBaselineCommit } from '../../git/baseline.js';
import { commitOrResume } from '../../git/commit-or-resume.js';
import { git } from '../../git/exec.js';
import { checkWorkingTreeClean } from '../../git/safety.js';
import { composeMessage, resolveCommitSha } from '../../git/trailers.js';
import { parseContractFile, serializeContractFile } from '../../state/contract-file.js';
import { loadContract, loadTasks, saveContract, saveTasks } from '../../state/store.js';
import type { ContractFile } from '../../state/contract-file.js';
import type { Task } from '../../state/schemas.js';
import { computeVerificationHash } from '../contracts/verification-hash.js';
import { resolveReadyTasks } from '../tasks/dependencies.js';
import { transitionMilestone } from './state-machine.js';

export class MilestoneConfirmError extends Error {}

export interface MilestoneConfirmView {
  id: string;
  operation: 'confirm' | 'amend';
  outcome: 'committed' | 'already-committed';
  hash: string;
  confirmedAt: string | null;
  commit: string;
  readyTasks: string[];
}

const contractRepoPath = (milestoneId: string): string =>
  `.pitway/milestones/${milestoneId}/contract.md`;

const nowSeconds = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

// AC012 baseline identity: milestone trailer + "workflow: add milestone"
// subject + no task trailer (resolveCommitSha without a task enforces that).
const findBaselineCommit = (root: string, milestoneId: string): string | undefined =>
  resolveCommitSha(root, {
    milestone: milestoneId,
    messagePrefix: `workflow: add milestone ${milestoneId}`,
  });

// AC012 amendment identity: an amend-subject candidate whose committed
// contract.md records exactly the currently recomputed hash.
function findAmendCommit(root: string, milestoneId: string, hash: string): string | undefined {
  const sha = resolveCommitSha(root, {
    milestone: milestoneId,
    messagePrefix: `workflow: amend milestone ${milestoneId}`,
  });
  if (sha === undefined) return undefined;
  const committed = parseContractFile(git(['show', `${sha}:${contractRepoPath(milestoneId)}`], root));
  return committed.frontmatter.verification_approved_hash === hash ? sha : undefined;
}

// AC009: refuses before anything is written or staged.
function assertNoUnexpectedDirtyPaths(root: string, expectedPaths: string[]): void {
  const expected = new Set(expectedPaths);
  const unexpected = checkWorkingTreeClean(root).dirtyPaths.filter((p) => !expected.has(p));
  if (unexpected.length > 0) {
    throw new MilestoneConfirmError(
      `cannot safely proceed: unrelated dirty changes present: ${unexpected.join(', ')}`,
    );
  }
}

function promoteTasks(root: string, milestoneId: string): string[] {
  const tasksFile = loadTasks(root, milestoneId);
  const resolved = resolveReadyTasks(
    tasksFile.tasks.map((t): Task => (t.status === 'planned' ? { ...t, status: 'waiting' } : t)),
  );
  saveTasks(root, milestoneId, { schema_version: tasksFile.schema_version, tasks: resolved });
  return resolved.filter((t) => t.status === 'ready').map((t) => t.id);
}

function runConfirm(root: string, milestoneId: string, contract: ContractFile): MilestoneConfirmView {
  const { status, requirement } = contract.frontmatter;
  const baselineSha = findBaselineCommit(root, milestoneId);
  const expectedPaths = computeExpectedBaselinePaths(milestoneId, requirement);

  if (status === 'draft') {
    if (baselineSha !== undefined) {
      throw new MilestoneConfirmError(
        `ambiguous state: baseline commit ${baselineSha} already exists but ${milestoneId} is ` +
          `still draft; inspect manually`,
      );
    }
    if (loadTasks(root, milestoneId).tasks.length === 0) {
      throw new MilestoneConfirmError(`cannot confirm ${milestoneId}: it has no tasks`);
    }
    assertNoUnexpectedDirtyPaths(root, expectedPaths);

    const confirmedAt = nowSeconds();
    const finalStatus = transitionMilestone(transitionMilestone(status, 'confirmed'), 'in_progress');
    const updated: ContractFile = {
      frontmatter: {
        ...contract.frontmatter,
        status: finalStatus,
        confirmed_at: confirmedAt,
        verification_approved_hash: null,
      },
      body: contract.body,
    };
    // The hash covers only the frontmatter's verification block, so computing
    // it from the serialized pre-hash text matches the persisted file.
    const hash = computeVerificationHash(serializeContractFile(updated));
    updated.frontmatter.verification_approved_hash = hash;
    saveContract(root, milestoneId, updated);
    const readyTasks = promoteTasks(root, milestoneId);

    const sha = createBaselineCommit(root, { milestoneId, paths: expectedPaths });
    return {
      id: milestoneId,
      operation: 'confirm',
      outcome: 'committed',
      hash,
      confirmedAt,
      commit: sha,
      readyTasks,
    };
  }

  if (status === 'in_progress') {
    // AC012 resume path: local state already advanced past the confirm write.
    const { verification_approved_hash: hash, confirmed_at: confirmedAt } = contract.frontmatter;
    if (hash === null || confirmedAt === null) {
      throw new MilestoneConfirmError(
        `${milestoneId} is in_progress but is missing its recorded hash or confirmed_at; ` +
          `inspect manually`,
      );
    }
    if (baselineSha !== undefined) {
      const readyTasks = loadTasks(root, milestoneId)
        .tasks.filter((t) => t.status === 'ready')
        .map((t) => t.id);
      return {
        id: milestoneId,
        operation: 'confirm',
        outcome: 'already-committed',
        hash,
        confirmedAt,
        commit: baselineSha,
        readyTasks,
      };
    }
    assertNoUnexpectedDirtyPaths(root, expectedPaths);
    // Re-run the (idempotent) promotion in case the write was interrupted.
    const readyTasks = promoteTasks(root, milestoneId);
    const sha = createBaselineCommit(root, { milestoneId, paths: expectedPaths });
    return {
      id: milestoneId,
      operation: 'confirm',
      outcome: 'committed',
      hash,
      confirmedAt,
      commit: sha,
      readyTasks,
    };
  }

  throw new MilestoneConfirmError(
    `cannot confirm ${milestoneId} in status "${status}"; milestone-confirm requires a draft milestone`,
  );
}

function assertChangeLogEntry(milestoneId: string, body: string): void {
  const lines = body.split('\n');
  const headingAt = lines.findIndex((line) => line.trim() === '## Change Log');
  if (headingAt !== -1) {
    for (let i = headingAt + 1; i < lines.length; i++) {
      if (/^#{1,6}\s/.test(lines[i]!)) break;
      if (lines[i]!.trim().length > 0) return;
    }
  }
  throw new MilestoneConfirmError(
    `cannot amend ${milestoneId}: add a Change Log entry describing the amendment first`,
  );
}

function runAmend(root: string, milestoneId: string, contract: ContractFile): MilestoneConfirmView {
  const { status } = contract.frontmatter;
  if (status === 'draft') {
    throw new MilestoneConfirmError(
      `cannot amend ${milestoneId} while it is draft; confirm the milestone first`,
    );
  }
  if (findBaselineCommit(root, milestoneId) === undefined) {
    throw new MilestoneConfirmError(
      `cannot amend ${milestoneId}: no baseline commit found — a confirm is mid-resume; ` +
        `complete the pending baseline first`,
    );
  }
  assertChangeLogEntry(milestoneId, contract.body);

  const hash = computeVerificationHash(serializeContractFile(contract));
  const localAdvanced = contract.frontmatter.verification_approved_hash === hash;
  const confirmedAt = contract.frontmatter.confirmed_at;

  const existing = findAmendCommit(root, milestoneId, hash);
  if (existing !== undefined) {
    if (!localAdvanced) {
      throw new MilestoneConfirmError(
        `ambiguous state: amend commit ${existing} already records hash ${hash} but the local ` +
          `contract does not; inspect manually`,
      );
    }
    return {
      id: milestoneId,
      operation: 'amend',
      outcome: 'already-committed',
      hash,
      confirmedAt,
      commit: existing,
      readyTasks: [],
    };
  }

  const contractPath = contractRepoPath(milestoneId);
  assertNoUnexpectedDirtyPaths(root, [contractPath]);
  if (!localAdvanced) {
    saveContract(root, milestoneId, {
      frontmatter: { ...contract.frontmatter, verification_approved_hash: hash },
      body: contract.body,
    });
  }

  const result = commitOrResume(root, {
    expectedPaths: [contractPath],
    findExistingCommit: () => findAmendCommit(root, milestoneId, hash),
    localStateAdvanced: true,
    message: composeMessage(`workflow: amend milestone ${milestoneId}`, {
      'PitWay-Milestone': milestoneId,
    }),
  });
  return {
    id: milestoneId,
    operation: 'amend',
    outcome: result.outcome,
    hash,
    confirmedAt,
    commit: result.sha,
    readyTasks: [],
  };
}

export interface MilestoneConfirmOptions {
  amend?: boolean;
}

export function confirmMilestone(
  root: string,
  milestoneId: string,
  options: MilestoneConfirmOptions = {},
): MilestoneConfirmView {
  const contract = loadContract(root, milestoneId);
  return options.amend ? runAmend(root, milestoneId, contract) : runConfirm(root, milestoneId, contract);
}
