import { spawnSync } from 'node:child_process';
import { serializeContractFile, type ContractFile } from '../../state/contract-file.js';
import type { VerificationResults } from '../../state/schemas.js';
import {
  loadContract,
  loadState,
  loadVerificationResults,
  saveVerificationResults,
} from '../../state/store.js';
import { computeVerificationHash } from '../contracts/verification-hash.js';

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

type ResultEntry = VerificationResults['results'][number];

const nowSeconds = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

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

const EVIDENCE_CAP = 200;

// Evidence is the trimmed tail of the combined output: the final non-empty
// lines, capped at 200 characters.
function trimEvidence(output: string, exitCode: number): string {
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const tail = lines.slice(-3).join(' | ');
  const text = tail.length > 0 ? tail : `(no output; exit ${exitCode})`;
  return text.length > EVIDENCE_CAP ? text.slice(-EVIDENCE_CAP) : text;
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

export function runVerification(root: string, milestoneId?: string): VerifyRunView {
  const id = resolveMilestone(root, milestoneId);
  const contract = loadApprovedContract(root, id);

  const outcomes: VerifyCheckOutcome[] = [];
  const pending: string[] = [];
  // AC002: only approved command-type checks execute, in contract order; every
  // check runs to completion — a failure never stops or hides the rest.
  for (const check of contract.frontmatter.verification) {
    if (check.type !== 'command') {
      pending.push(check.id);
      continue;
    }
    const run = spawnSync(check.command, { cwd: root, shell: true, encoding: 'utf8' });
    // A signal kill or spawn failure has no exit code; both count as fail.
    const exitCode = run.status ?? 1;
    outcomes.push({
      check: check.id,
      status: exitCode === 0 ? 'pass' : 'fail',
      evidence: trimEvidence(`${run.stdout ?? ''}${run.stderr ?? ''}`, exitCode),
    });
  }

  appendResults(
    root,
    id,
    outcomes.map((o): ResultEntry => ({ ...o, at: nowSeconds(), recorded_by: 'command' })),
  );
  return {
    id,
    mode: 'run',
    passed: outcomes.every((o) => o.status === 'pass'),
    results: outcomes,
    pending,
  };
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
