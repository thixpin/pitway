import { loadContract, loadState, loadVerificationResults } from '../../state/store.js';
import type { ContractFile } from '../../state/contract-file.js';

export class VerificationStatusError extends Error {}

// AC008 (M013): the single, shared per-check latest-result derivation --
// extracted from milestone-complete's own former private copy so every
// caller (milestone-complete's own gate, `verify --status`, and the
// workload/footer/report functions that need a `verificationPassed`
// boolean) reads verification-results.yaml the same way, once.
export function computeLatestCheckResults(root: string, milestoneId: string): Map<string, 'pass' | 'fail'> {
  const latest = new Map<string, 'pass' | 'fail'>();
  for (const result of loadVerificationResults(root, milestoneId).results) {
    latest.set(result.check, result.status);
  }
  return latest;
}

// Every declared check has a recorded latest result of pass -- the same
// condition milestone-complete's own gate requires before completion.
export function allChecksPassed(contract: ContractFile, latest: Map<string, 'pass' | 'fail'>): boolean {
  return contract.frontmatter.verification.every((check) => latest.get(check.id) === 'pass');
}

// Mirrors run.ts's own resolveMilestone -- kept as a small, independent
// copy here (rather than importing from run.ts) so this module's write
// scope stays confined to verification/status.ts, per T001's declared
// write_scope.
function resolveMilestone(root: string, milestoneId: string | undefined): string {
  if (milestoneId !== undefined) return milestoneId;
  const state = loadState(root);
  if (!state.active_milestone) {
    throw new VerificationStatusError('no active milestone; pass a milestone id explicitly');
  }
  return state.active_milestone;
}

export interface VerifyStatusEntry {
  check: string;
  status: 'pass' | 'fail' | 'pending';
}

export interface VerifyStatusView {
  id: string;
  mode: 'status';
  checks: VerifyStatusEntry[];
}

// AC008: read-only, never executes a command, never mutates
// verification-results.yaml. Works for any milestone status (draft through
// completed) -- unlike verify's run/record paths, it does not require an
// approved verification hash, since nothing here is executed.
export function getVerificationStatus(root: string, milestoneId?: string): VerifyStatusView {
  const id = resolveMilestone(root, milestoneId);
  const contract = loadContract(root, id);
  const latest = computeLatestCheckResults(root, id);
  const checks = contract.frontmatter.verification.map((check) => ({
    check: check.id,
    status: latest.get(check.id) ?? ('pending' as const),
  }));
  return { id, mode: 'status', checks };
}
