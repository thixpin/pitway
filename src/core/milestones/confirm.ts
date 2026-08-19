import { randomUUID } from 'node:crypto';
import { computeExpectedBaselinePaths, createBaselineCommit } from '../../git/baseline.js';
import { commitOrResume } from '../../git/commit-or-resume.js';
import { checkWorkingTreeClean } from '../../git/safety.js';
import { composeMessage, resolveCommitSha } from '../../git/trailers.js';
import { parseContractFile, serializeContractFile } from '../../state/contract-file.js';
import { appendJournalEntry, readJournal } from '../../state/journal.js';
import {
  loadContract,
  loadTasks,
  readInputFile,
  resolveMilestoneDirName,
  saveContract,
  saveTasks,
} from '../../state/store.js';
import type { ContractFile } from '../../state/contract-file.js';
import type { Task } from '../../state/schemas.js';
import { derivePending } from '../journal/operations.js';
import { computeVerificationHash } from '../contracts/verification-hash.js';
import { resolveReadyTasks } from '../tasks/dependencies.js';
import { transitionMilestone } from './state-machine.js';

export class MilestoneConfirmError extends Error {}

export interface MilestoneConfirmView {
  id: string;
  operation: 'confirm';
  outcome: 'committed' | 'already-committed';
  hash: string;
  confirmedAt: string | null;
  commit: string;
  readyTasks: string[];
}

export interface MilestoneAmendView {
  id: string;
  operation: 'amend';
  // Materialized immediately to contract.md — no commit of its own; the
  // amendment is folded into whichever checkpoint commit lands next (see
  // task-update's completion path and milestone-complete).
  hash: string;
  confirmedAt: string | null;
}

export type ConfirmMilestoneView = MilestoneConfirmView | MilestoneAmendView;

const nowSeconds = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

// AC012 baseline identity: milestone trailer + "workflow: add milestone"
// subject + no task trailer (resolveCommitSha without a task enforces that).
const findBaselineCommit = (root: string, milestoneId: string): string | undefined =>
  resolveCommitSha(root, {
    milestone: milestoneId,
    messagePrefix: `workflow: add milestone ${milestoneId}`,
  });

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
  // Resolved here (Core layer, already depends on the State layer) and
  // passed into the Git-layer function — baseline.ts itself stays free of
  // any State import.
  const milestoneDir = resolveMilestoneDirName(root, milestoneId);
  const expectedPaths = computeExpectedBaselinePaths(milestoneDir, requirement);

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

function parseAmendmentInput(path: string): ContractFile {
  let text: string;
  try {
    text = readInputFile(path, 'amendment');
  } catch (error) {
    throw new MilestoneConfirmError((error as Error).message);
  }
  try {
    return parseContractFile(text);
  } catch (error) {
    throw new MilestoneConfirmError(`invalid amendment ${path}: ${(error as Error).message}`);
  }
}

// Runs against a validated draft contract file (the desired FULL amended
// contract) rather than a hand-edit of the persisted contract.md — mirrors
// milestone-add's draft-input pattern. No commit of its own: the amendment
// is journaled and materialized immediately; a later checkpoint commit
// (task-update's completion path or milestone-complete) folds it in and
// then reconciles the journal marker.
function runAmend(root: string, milestoneId: string, draft: ContractFile): MilestoneAmendView {
  const { status } = draft.frontmatter;
  if (draft.frontmatter.id !== milestoneId) {
    throw new MilestoneConfirmError(
      `amendment draft id "${draft.frontmatter.id}" does not match target milestone ${milestoneId}`,
    );
  }
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
  assertChangeLogEntry(milestoneId, draft.body);

  const hash = computeVerificationHash(serializeContractFile(draft));
  const confirmedAt = draft.frontmatter.confirmed_at;
  const desired: ContractFile = {
    frontmatter: { ...draft.frontmatter, verification_approved_hash: hash },
    body: draft.body,
  };
  // The verification hash covers only the frontmatter's verification: block
  // (see computeVerificationHash) — it says nothing about acceptance_criteria
  // text or the body (Change Log, prose). Two amendments can share a hash
  // while differing there, so idempotency/ambiguity below compares the full
  // desired serialized content, never the hash alone.
  const desiredText = serializeContractFile(desired);

  // Pre-commit idempotency: at most one pending contract_amendment entry for
  // this milestone should ever exist at a time (a genuinely new amendment
  // is only appended once no earlier one is still pending). If more than
  // one is somehow found, that is the ambiguous case this task's contract
  // calls out — stop with a diagnostic rather than guessing which applies.
  const pending = derivePending(readJournal(root)).filter(
    (entry) => entry.milestone === milestoneId && entry.type === 'contract_amendment',
  );
  if (pending.length > 1) {
    throw new MilestoneConfirmError(
      `ambiguous state: multiple pending contract amendment journal entries exist for ${milestoneId}; inspect manually`,
    );
  }
  const pendingEntry = pending[0];
  if (pendingEntry !== undefined) {
    if (pendingEntry.payload.contractText !== desiredText) {
      throw new MilestoneConfirmError(
        `ambiguous state: a different contract amendment (hash ${String(pendingEntry.payload.hash)}) ` +
          `is already pending for ${milestoneId}; checkpoint or resolve it before amending again`,
      );
    }
    // Duplicate re-invocation of the same amendment: harmless to re-write
    // the same content again, no new journal entry needed.
    saveContract(root, milestoneId, desired);
    return { id: milestoneId, operation: 'amend', hash, confirmedAt };
  }

  // Already fully materialized (and possibly already checkpointed) by a
  // prior invocation of this exact amendment — compared as full content,
  // not just the hash, so a body-only (or AC-text-only) change is never
  // silently skipped just because the verification block didn't move.
  const persisted = loadContract(root, milestoneId);
  if (serializeContractFile(persisted) === desiredText) {
    return { id: milestoneId, operation: 'amend', hash, confirmedAt };
  }

  appendJournalEntry(root, {
    milestone: milestoneId,
    type: 'contract_amendment',
    operationId: randomUUID(),
    payload: { hash, contractText: desiredText },
  });
  saveContract(root, milestoneId, desired);
  return { id: milestoneId, operation: 'amend', hash, confirmedAt };
}

export interface MilestoneConfirmOptions {
  amend?: boolean;
  // Required alongside amend: path to the validated draft contract file
  // holding the desired full amended contract.
  file?: string;
}

export function confirmMilestone(
  root: string,
  milestoneId: string,
  options: MilestoneConfirmOptions = {},
): ConfirmMilestoneView {
  if (options.amend) {
    if (options.file === undefined) {
      throw new MilestoneConfirmError(
        '--amend requires --file <path> pointing at the validated draft amended contract',
      );
    }
    const draft = parseAmendmentInput(options.file);
    return runAmend(root, milestoneId, draft);
  }
  const contract = loadContract(root, milestoneId);
  return runConfirm(root, milestoneId, contract);
}
