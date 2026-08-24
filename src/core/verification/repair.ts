import { relative, resolve, sep } from 'node:path';
import { parse } from 'yaml';
import { commitOrResume } from '../../git/commit-or-resume.js';
import { git } from '../../git/exec.js';
import { checkWorkingTreeClean } from '../../git/safety.js';
import { composeMessage, resolveCommitSha } from '../../git/trailers.js';
import type { ContractFile } from '../../state/contract-file.js';
import type { VerificationRepairRecord, VerificationRepairsFile } from '../../state/schemas.js';
import {
  loadContract,
  loadTasks,
  loadVerificationRepairs,
  resolveMilestoneDirName,
  saveVerificationRepairs,
} from '../../state/store.js';
import { runSingleCheck } from './run.js';

export class VerificationRepairError extends Error {}

export interface VerificationRepairApproveInputs {
  files: string[];
  checks: string[];
  changeLog: string;
}

export interface VerificationRepairApproveView {
  id: string;
  milestone: string;
  operation: 'approve';
  status: 'pending';
  files: string[];
  checks: string[];
}

export interface VerificationRepairCommitView {
  id: string;
  milestone: string;
  operation: 'commit';
  outcome: 'committed' | 'already-committed';
  commit: string;
}

export interface VerificationRepairCancelView {
  id: string;
  milestone: string;
  operation: 'cancel';
  status: 'cancelled';
}

const nowSeconds = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

// Directory names are assigned once at creation and never renamed, so
// resolving against the current on-disk listing is correct even when
// looking up content at a past commit via git show (mirrors the same
// pattern already used in task-update.ts/complete.ts).
const verificationRepairsRepoPath = (root: string, milestoneId: string): string =>
  `.pitway/milestones/${resolveMilestoneDirName(root, milestoneId)}/verification-repairs.yaml`;

const verificationResultsRepoPath = (root: string, milestoneId: string): string =>
  `.pitway/milestones/${resolveMilestoneDirName(root, milestoneId)}/verification-results.yaml`;

// Structurally owned exclusively by milestone-confirm/--amend, task-update,
// and verify/this command's own commit phase — never a valid --file target
// regardless of write_scope membership.
function reservedRepairPaths(root: string, milestoneId: string): Set<string> {
  const dir = resolveMilestoneDirName(root, milestoneId);
  return new Set([
    '.pitway/state.yaml',
    `.pitway/milestones/${dir}/contract.md`,
    `.pitway/milestones/${dir}/tasks.yaml`,
    `.pitway/milestones/${dir}/verification-results.yaml`,
  ]);
}

// Resolves against the repository root and rejects anything outside it,
// returning a posix-style repo-relative path (matching the format git
// status/checkWorkingTreeClean already reports paths in).
function normalizeRepoRelativePath(root: string, inputPath: string): string {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(root, inputPath);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(resolvedRoot + sep)) {
    throw new VerificationRepairError(
      `--file path resolves outside the repository: ${inputPath}`,
    );
  }
  return relative(resolvedRoot, resolvedPath).split(sep).join('/');
}

function assertValidFileList(root: string, milestoneId: string, rawFiles: string[]): string[] {
  if (rawFiles.length === 0) {
    throw new VerificationRepairError('--file requires at least one path');
  }
  const normalized = rawFiles.map((f) => normalizeRepoRelativePath(root, f));
  const seen = new Set<string>();
  for (const file of normalized) {
    if (seen.has(file)) {
      throw new VerificationRepairError(`duplicate --file path: ${file}`);
    }
    seen.add(file);
  }
  const reserved = reservedRepairPaths(root, milestoneId);
  for (const file of normalized) {
    if (reserved.has(file)) {
      throw new VerificationRepairError(
        `--file ${file} is not a valid repair target: exclusively owned by milestone-confirm/` +
          `task-update/verify (write_scope membership is irrelevant to this gate)`,
      );
    }
  }
  return normalized;
}

function assertValidCheckList(contract: ContractFile, rawChecks: string[]): string[] {
  if (rawChecks.length === 0) {
    throw new VerificationRepairError('--check requires at least one id');
  }
  const seen = new Set<string>();
  for (const id of rawChecks) {
    if (seen.has(id)) {
      throw new VerificationRepairError(`duplicate --check id: ${id}`);
    }
    seen.add(id);
  }
  for (const id of rawChecks) {
    const check = contract.frontmatter.verification.find((c) => c.id === id);
    if (check === undefined) {
      throw new VerificationRepairError(`unknown check ${id} in ${contract.frontmatter.id}`);
    }
    if (check.type !== 'command') {
      throw new VerificationRepairError(
        `check ${id} is a ${check.type} check, not command-type; verification-repair only ` +
          `reruns command-type checks`,
      );
    }
  }
  return rawChecks;
}

// AC002: usable only when the target milestone is in_progress and every
// non-cancelled task's status is completed.
function assertMilestoneReadyForRepair(root: string, milestoneId: string): ContractFile {
  const contract = loadContract(root, milestoneId);
  if (contract.frontmatter.status !== 'in_progress') {
    throw new VerificationRepairError(
      `cannot repair ${milestoneId}: status is "${contract.frontmatter.status}", not in_progress`,
    );
  }
  const incomplete = loadTasks(root, milestoneId)
    .tasks.filter((t) => t.status !== 'cancelled' && t.status !== 'completed')
    .map((t) => `${t.id} (${t.status})`);
  if (incomplete.length > 0) {
    throw new VerificationRepairError(
      `cannot repair ${milestoneId}: tasks not completed: ${incomplete.join(', ')}`,
    );
  }
  return contract;
}

function nextVrId(records: VerificationRepairRecord[]): string {
  const max = records.reduce((acc, r) => Math.max(acc, Number(r.id.slice(2))), 0);
  return `VR${String(max + 1).padStart(3, '0')}`;
}

// Phase one: approve. An uncommitted, immediate write -- the same shape as
// task-update flipping a task to in_progress -- persisting the exact
// approved file/check scope as status: pending. No implementation edit is
// permitted before this call; running approve against the exact list IS the
// approval (the same convention milestone-confirm/task-amend already use).
export function approveVerificationRepair(
  root: string,
  milestoneId: string,
  inputs: VerificationRepairApproveInputs,
): VerificationRepairApproveView {
  const contract = assertMilestoneReadyForRepair(root, milestoneId);
  if (inputs.changeLog.trim().length === 0) {
    throw new VerificationRepairError('--change-log requires non-empty text');
  }
  const files = assertValidFileList(root, milestoneId, inputs.files);
  const checks = assertValidCheckList(contract, inputs.checks);

  const repairs = loadVerificationRepairs(root, milestoneId);
  const pending = repairs.records.find((r) => r.status === 'pending');
  if (pending !== undefined) {
    throw new VerificationRepairError(
      `cannot approve: ${pending.id} is already pending for ${milestoneId}; commit or cancel it first`,
    );
  }

  const id = nextVrId(repairs.records);
  const record: VerificationRepairRecord = {
    id,
    files,
    checks,
    change_log: inputs.changeLog,
    approved_at: nowSeconds(),
    status: 'pending',
  };
  saveVerificationRepairs(root, milestoneId, {
    schema_version: repairs.schema_version,
    records: [...repairs.records, record],
  });
  return { id, milestone: milestoneId, operation: 'approve', status: 'pending', files, checks };
}

// Phase two identity: a candidate commit matched by both trailers is only
// genuinely this repair's commit if its committed verification-repairs.yaml
// record, parsed, matches the persisted record exactly -- otherwise this is
// the disclosed ambiguous case (diverged content under matching trailers),
// refused rather than guessed at.
interface CommittedRepairRecord {
  id?: unknown;
  status?: unknown;
  files?: unknown;
  checks?: unknown;
  change_log?: unknown;
}

// AC005/T005 (M012): bounds the search to since..HEAD when this milestone
// tracks a branch (base_revision non-null); unbounded (today's behavior)
// otherwise.
function findRepairCommit(
  root: string,
  milestoneId: string,
  vrId: string,
  persisted: VerificationRepairRecord,
): string | undefined {
  const since = loadContract(root, milestoneId).frontmatter.base_revision ?? undefined;
  const sha = resolveCommitSha(root, {
    milestone: milestoneId,
    verificationRepair: vrId,
    ...(since !== undefined ? { since } : {}),
  });
  if (sha === undefined) return undefined;
  let record: CommittedRepairRecord | undefined;
  try {
    const data = parse(
      git(['show', `${sha}:${verificationRepairsRepoPath(root, milestoneId)}`], root),
    ) as { records?: CommittedRepairRecord[] };
    record = data.records?.find((r) => r.id === vrId);
  } catch {
    record = undefined;
  }
  const matches =
    record !== undefined &&
    record.status === persisted.status &&
    JSON.stringify(record.files) === JSON.stringify(persisted.files) &&
    JSON.stringify(record.checks) === JSON.stringify(persisted.checks) &&
    record.change_log === persisted.change_log;
  if (!matches) {
    throw new VerificationRepairError(
      `ambiguous state: commit ${sha} carries the ${vrId} verification-repair trailers but its ` +
        `committed record does not match the persisted verification repair; inspect manually`,
    );
  }
  return sha;
}

function persistRepairRecord(
  root: string,
  milestoneId: string,
  file: VerificationRepairsFile,
  updated: VerificationRepairRecord,
): void {
  saveVerificationRepairs(root, milestoneId, {
    schema_version: file.schema_version,
    records: file.records.map((r) => (r.id === updated.id ? updated : r)),
  });
}

function findRecord(file: VerificationRepairsFile, vrId: string): VerificationRepairRecord {
  const record = file.records.find((r) => r.id === vrId);
  if (record === undefined) {
    throw new VerificationRepairError(`unknown verification repair ${vrId}`);
  }
  return record;
}

// AC009-style refusal before anything is staged, committed, or written.
function assertDirtySubset(root: string, expectedPaths: string[]): void {
  const expected = new Set(expectedPaths);
  const unexpected = checkWorkingTreeClean(root).dirtyPaths.filter((p) => !expected.has(p));
  if (unexpected.length > 0) {
    throw new VerificationRepairError(
      `cannot safely proceed: unrelated dirty changes present: ${unexpected.join(', ')}`,
    );
  }
}

// Phase two: commit. Run only after implementation edits are made. Validates
// the dirty tree is a subset of the approved files plus this command's own
// state files, reruns every approved check by reusing run.ts's own
// command-check execution and verification-results.yaml recording (refusing
// the whole commit if any fails, VR staying pending), and only then
// atomically commits the VR record, the corrected files, and the fresh
// verification-results.yaml entries.
export function commitVerificationRepair(
  root: string,
  milestoneId: string,
  vrId: string,
): VerificationRepairCommitView {
  const repairs = loadVerificationRepairs(root, milestoneId);
  const record = findRecord(repairs, vrId);
  if (record.status === 'cancelled') {
    throw new VerificationRepairError(`cannot commit ${vrId}: status is "cancelled"`);
  }

  // Self-healing re-entry: a commit carrying the exact trailers may already
  // exist even though the local record has not (yet) been marked committed
  // -- e.g. the process crashed between the commit landing and the local
  // status flip. Detected first, before any assumption about local status,
  // mirroring state/journal.ts's reconcilePending self-healing pattern.
  const asCommitted: VerificationRepairRecord = { ...record, status: 'committed' };
  const existing = findRepairCommit(root, milestoneId, vrId, asCommitted);
  if (existing !== undefined) {
    if (record.status !== 'committed') {
      persistRepairRecord(root, milestoneId, repairs, asCommitted);
    }
    return { id: vrId, milestone: milestoneId, operation: 'commit', outcome: 'already-committed', commit: existing };
  }

  if (record.status === 'committed') {
    throw new VerificationRepairError(
      `ambiguous state: ${vrId} is recorded as committed but no matching commit was found; inspect manually`,
    );
  }

  // record.status === 'pending' from here.
  const ownStatePaths = [
    verificationRepairsRepoPath(root, milestoneId),
    verificationResultsRepoPath(root, milestoneId),
  ];
  const expectedPaths = [...new Set([...record.files, ...ownStatePaths])];
  assertDirtySubset(root, expectedPaths);

  // Every approved check runs to completion — a failure never stops or
  // hides the rest, mirroring runVerification's own convention.
  const outcomes = record.checks.map((checkId) => runSingleCheck(root, milestoneId, checkId));
  const failed = outcomes.filter((o) => o.status === 'fail').map((o) => o.check);
  if (failed.length > 0) {
    throw new VerificationRepairError(
      `cannot commit ${vrId}: check(s) failed on rerun: ${failed.join(', ')}; ${vrId} stays pending`,
    );
  }

  const updated: VerificationRepairRecord = { ...record, status: 'committed' };
  persistRepairRecord(root, milestoneId, repairs, updated);

  const message = composeMessage(
    `fix: repair verification for ${milestoneId} (${vrId})\n\n${record.change_log}`,
    { 'PitWay-Milestone': milestoneId, 'PitWay-Verification-Repair': vrId },
  );
  const result = commitOrResume(root, {
    expectedPaths,
    findExistingCommit: () => findRepairCommit(root, milestoneId, vrId, updated),
    localStateAdvanced: true,
    message,
  });
  return { id: vrId, milestone: milestoneId, operation: 'commit', outcome: result.outcome, commit: result.sha };
}

// Cancel: valid only while pending. An uncommitted write with no commit of
// its own -- milestone-complete's completionPaths treats
// verification-repairs.yaml as an always-candidate path (the same way
// usage.yaml already is), so a cancelled repair's status flip rides along
// in whatever commit closes the milestone out, never left permanently dirty.
export function cancelVerificationRepair(
  root: string,
  milestoneId: string,
  vrId: string,
): VerificationRepairCancelView {
  const repairs = loadVerificationRepairs(root, milestoneId);
  const record = findRecord(repairs, vrId);
  if (record.status !== 'pending') {
    throw new VerificationRepairError(
      `cannot cancel ${vrId}: status is "${record.status}", not pending`,
    );
  }
  const updated: VerificationRepairRecord = { ...record, status: 'cancelled' };
  persistRepairRecord(root, milestoneId, repairs, updated);
  return { id: vrId, milestone: milestoneId, operation: 'cancel', status: 'cancelled' };
}
