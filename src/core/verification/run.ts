import { serializeContractFile, type ContractFile } from '../../state/contract-file.js';
import type { VerificationCheck, VerificationResults } from '../../state/schemas.js';
import {
  loadContract,
  loadState,
  loadVerificationResults,
  saveVerificationResults,
} from '../../state/store.js';
import { computeVerificationHash } from '../contracts/verification-hash.js';
import { resolveCanonicalGitDir } from '../../git/paths.js';
import { buildEvidence } from './failure-evidence.js';
import { evaluateRecursionGuard } from './recursion-guard.js';
import { DEFAULT_TIMEOUT_MS, executeCommand, type TerminationReason } from './process-exec.js';

export class VerifyError extends Error {}

export interface VerifyCheckOutcome {
  check: string;
  status: 'pass' | 'fail';
  evidence: string;
}

export interface VerifyRunView {
  id: string;
  mode: 'run';
  passed: boolean;
  results: VerifyCheckOutcome[];
  // Manual/review check ids: never executed, awaiting developer recording.
  pending: string[];
}

export interface VerifyRecordView {
  id: string;
  mode: 'record';
  check: string;
  status: 'pass' | 'fail';
  evidence: string;
}

// T002: isolated single-check rerun -- `pitway verify <id> --check CTnnn`
// with none of --pass/--fail/--evidence re-executes exactly that one
// command check through the same hash-gated, timeout-protected,
// recursion-guarded path as a full run, and appends its own result. Never
// invoked automatically -- no retry policy lives here or anywhere else in
// this task's code.
export interface VerifyCheckRunView {
  id: string;
  mode: 'check-run';
  check: string;
  status: 'pass' | 'fail';
  evidence: string;
}

type ResultEntry = VerificationResults['results'][number];
type CommandCheck = Extract<VerificationCheck, { type: 'command' }>;

const nowSeconds = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

// AC004/AC005/T002: recursion guard. The env var carries a comma-separated
// list of `<canonical-git-dir>#<milestoneId>` tokens for every verification
// currently "in flight" in this process tree -- set once per top-level
// runVerification/runSingleCheck call (never per check, since sibling checks
// in the same run legitimately share the same token) and restored on exit so
// unrelated, sequential (non-nested) invocations in the same process never
// see stale state. Spawned command checks inherit it via normal env
// inheritance (see process-exec.ts), so a check whose command recursively
// re-enters verification for the SAME repo+milestone finds its own token
// already present and refuses immediately -- bounded time, never a hang.
const GUARD_ENV_VAR = 'PITWAY_VERIFY_GUARD';

function withRecursionGuard<T>(root: string, milestoneId: string, fn: () => T): T {
  const token = `${resolveCanonicalGitDir(root)}#${milestoneId}`;
  const previous = process.env[GUARD_ENV_VAR];
  const decision = evaluateRecursionGuard(previous, token);
  if (decision.decision === 'refuse') {
    throw new VerifyError(
      `refusing to verify ${milestoneId}: this repository and milestone are already being ` +
        `verified by an ancestor process (guard token ${decision.token}); recursive ` +
        `verification is refused, not retried or awaited, to avoid an unbounded loop`,
    );
  }
  process.env[GUARD_ENV_VAR] = decision.value;
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env[GUARD_ENV_VAR];
    } else {
      process.env[GUARD_ENV_VAR] = previous;
    }
  }
}

function resolveMilestone(root: string, milestoneId?: string): string {
  if (milestoneId !== undefined) return milestoneId;
  const state = loadState(root);
  if (!state.active_milestone) {
    throw new VerifyError('no active milestone; pass a milestone id explicitly');
  }
  return state.active_milestone;
}

// AC001: the hash gate runs before anything executes or is recorded. The
// recomputed hash covers the current serialized contract text, so any edit to
// the verification block since approval refuses here.
function loadApprovedContract(root: string, milestoneId: string): ContractFile {
  const contract = loadContract(root, milestoneId);
  const approved = contract.frontmatter.verification_approved_hash;
  if (approved === null) {
    throw new VerifyError(
      `cannot verify ${milestoneId}: no approved verification hash recorded; ` +
        `confirm the milestone first`,
    );
  }
  const current = computeVerificationHash(serializeContractFile(contract));
  if (current !== approved) {
    throw new VerifyError(
      `cannot verify ${milestoneId}: current verification block hash ${current} does not match ` +
        `the approved hash ${approved}; re-approve with milestone-confirm ${milestoneId} --amend`,
    );
  }
  return contract;
}

// AC004: results are append-only — prior entries are never rewritten or
// deleted, so the latest entry per check stays authoritative by position.
function appendResults(root: string, milestoneId: string, entries: ResultEntry[]): void {
  const existing = loadVerificationResults(root, milestoneId);
  saveVerificationResults(root, milestoneId, {
    schema_version: existing.schema_version,
    results: [...existing.results, ...entries],
  });
}

function emptyOutputFallback(exitCode: number | null, terminationReason: TerminationReason): string {
  switch (terminationReason) {
    case 'timeout':
      return '(no output; timed out)';
    case 'signal':
      return '(no output; killed by signal)';
    case 'spawn_error':
      return '(no output; failed to spawn)';
    case 'exited':
      return `(no output; exit ${exitCode ?? 1})`;
  }
}

interface CommandCheckOutcome extends VerifyCheckOutcome {
  duration_ms: number;
  termination_reason: TerminationReason;
}

// M017/T004 (AC004) introduced the failure-summary-first evidence shape;
// M048/T001 moved it to failure-evidence.ts's shared buildEvidence, whose
// EVIDENCE_BUDGET is the one 200-char cap this call site and tasks/verify.ts
// both use (matching trimTail's own default cap).

// AC001/AC007/T002: runs one command check through T001's timeout-bounded
// executeCommand (per-check timeout_ms, falling back to the shared safe
// default), builds evidence with the shared failure-evidence helper, and
// times the attempt for duration_ms. Never retried automatically -- one
// call, one outcome.
function executeCommandCheck(root: string, check: CommandCheck): CommandCheckOutcome {
  const start = Date.now();
  const result = executeCommand(check.command, {
    cwd: root,
    timeoutMs: check.timeout_ms ?? DEFAULT_TIMEOUT_MS,
  });
  const duration_ms = Date.now() - start;
  const exitCode = result.exitCode;
  const status = result.terminationReason === 'exited' && exitCode === 0 ? 'pass' : 'fail';
  const evidence = buildEvidence(
    `${result.stdout}${result.stderr}`,
    status === 'fail',
    emptyOutputFallback(exitCode, result.terminationReason),
  );
  return { check: check.id, status, evidence, duration_ms, termination_reason: result.terminationReason };
}

function toResultEntry(outcome: CommandCheckOutcome): ResultEntry {
  return {
    check: outcome.check,
    status: outcome.status,
    at: nowSeconds(),
    evidence: outcome.evidence,
    recorded_by: 'command',
    duration_ms: outcome.duration_ms,
    termination_reason: outcome.termination_reason,
  };
}

export function runVerification(root: string, milestoneId?: string): VerifyRunView {
  const id = resolveMilestone(root, milestoneId);
  const contract = loadApprovedContract(root, id);

  const outcomes: VerifyCheckOutcome[] = [];
  const pending: string[] = [];
  withRecursionGuard(root, id, () => {
    // AC002: only approved command-type checks execute, in contract order; every
    // check runs to completion — a failure never stops or hides the rest.
    for (const check of contract.frontmatter.verification) {
      if (check.type !== 'command') {
        pending.push(check.id);
        continue;
      }
      const outcome = executeCommandCheck(root, check);
      outcomes.push(outcome);
      // T002: persisted immediately after this check completes, not only
      // once after the whole loop -- so an earlier check's result survives a
      // later check's crash, guard refusal, or timeout.
      appendResults(root, id, [toResultEntry(outcome)]);
    }
  });

  return {
    id,
    mode: 'run',
    passed: outcomes.every((o) => o.status === 'pass'),
    results: outcomes,
    pending,
  };
}

export function runSingleCheck(
  root: string,
  milestoneId: string | undefined,
  checkId: string,
): VerifyCheckRunView {
  const id = resolveMilestone(root, milestoneId);
  const contract = loadApprovedContract(root, id);

  const check = contract.frontmatter.verification.find((c) => c.id === checkId);
  if (check === undefined) {
    throw new VerifyError(`unknown check ${checkId} in ${id}`);
  }
  if (check.type !== 'command') {
    throw new VerifyError(
      `check ${checkId} is a ${check.type} check; record it with --pass/--fail --evidence <text>`,
    );
  }

  const outcome = withRecursionGuard(root, id, () => executeCommandCheck(root, check));
  appendResults(root, id, [toResultEntry(outcome)]);
  return { id, mode: 'check-run', check: outcome.check, status: outcome.status, evidence: outcome.evidence };
}

export interface RecordCheckInputs {
  check: string;
  status: 'pass' | 'fail';
  evidence: string;
}

export function recordCheckResult(
  root: string,
  milestoneId: string | undefined,
  inputs: RecordCheckInputs,
): VerifyRecordView {
  const id = resolveMilestone(root, milestoneId);
  const contract = loadApprovedContract(root, id);

  // AC003: developer recording covers manual/review checks only.
  const check = contract.frontmatter.verification.find((c) => c.id === inputs.check);
  if (check === undefined) {
    throw new VerifyError(`unknown check ${inputs.check} in ${id}`);
  }
  if (check.type === 'command') {
    throw new VerifyError(
      `check ${inputs.check} is a command check; run bare "pitway verify" to execute it`,
    );
  }
  if (inputs.evidence.trim().length === 0) {
    throw new VerifyError('recording a check requires non-empty --evidence');
  }

  appendResults(root, id, [
    {
      check: check.id,
      status: inputs.status,
      at: nowSeconds(),
      evidence: inputs.evidence,
      recorded_by: 'developer',
    },
  ]);
  return { id, mode: 'record', check: check.id, status: inputs.status, evidence: inputs.evidence };
}
