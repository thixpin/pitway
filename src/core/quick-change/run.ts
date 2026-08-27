import { createHash } from 'node:crypto';
import { appendQuickChangeRecord } from '../../state/journal.js';
import { DEFAULT_TIMEOUT_MS, executeCommand } from '../verification/process-exec.js';
import { trimTail } from '../verification/text-trim.js';
import { QuickChangeError, requireQuickChange } from './create.js';

export { QuickChangeError };

// T004: executes exactly the approved-and-hashed verification command from
// an approved quick-change, refusing anything that doesn't match the
// approved hash, and records every run attempt (pass or fail) append-only in
// the change's journal entry -- mirroring M007/AC002's flaky-pass-is-a-
// decision-gate discipline. No CLI surface is registered from this module.

export interface QuickChangeRunView {
  id: string;
  status: 'pass' | 'fail';
  evidence: string;
}

// Recomputes the identical sha256({scope, verifyCommand, tddExempt, tddExemptReason, closesBacklogId})
// hash create.ts's computeQuickChangeHash produces at approve time. That
// function is private to create.ts (not exported), so this is a small, pure,
// local duplicate -- a deliberate bounded duplication rather than widening
// this task's write scope onto create.ts to export it. closesBacklogId is
// included ONLY when defined, exactly mirroring create.ts's own comment: a
// change with no --closes must hash identically to before this field
// existed.
function computeQuickChangeHash(
  scope: string[],
  verifyCommand: string,
  tddExempt?: boolean,
  tddExemptReason?: string,
  closesBacklogId?: string,
): string {
  const canonical = JSON.stringify({
    scope,
    verifyCommand,
    tddExempt: tddExempt ?? false,
    tddExemptReason: tddExemptReason ?? null,
    ...(closesBacklogId !== undefined ? { closesBacklogId } : {}),
  });
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

// run: approved-only. Recomputes the hash as a defensive integrity check --
// nothing in create.ts currently allows scope/verifyCommand to diverge from
// approvedHash, but AC003 explicitly calls for refusing anything that
// doesn't match, so this is checked for real rather than assumed. Executes
// the verify command through the same timeout-bounded executeCommand
// primitive src/core/verification/run.ts already uses (never reimplemented
// here), and appends a full new journal snapshot with the run attempt added
// to `runs` -- status stays 'approved' (a run does not itself change
// lifecycle status; only commit does), and prior run attempts are always
// carried forward untouched, so a failing run is never overwritten by a
// later one.
export function runQuickChange(root: string, changeId: string): QuickChangeRunView {
  const current = requireQuickChange(root, changeId);
  if (current.status !== 'approved') {
    throw new QuickChangeError(
      `cannot run ${changeId}: status is "${current.status}", not approved`,
    );
  }

  const recomputedHash = computeQuickChangeHash(
    current.scope,
    current.verifyCommand,
    current.tddExempt,
    current.tddExemptReason,
    current.closesBacklogId,
  );
  if (recomputedHash !== current.approvedHash) {
    throw new QuickChangeError(
      `cannot run ${changeId}: recomputed hash does not match the approved hash; the change's ` +
        `scope or verify command has diverged since approval`,
    );
  }

  const result = executeCommand(current.verifyCommand, { cwd: root, timeoutMs: DEFAULT_TIMEOUT_MS });
  const status = result.terminationReason === 'exited' && result.exitCode === 0 ? 'pass' : 'fail';
  const evidence = trimTail(`${result.stdout}${result.stderr}`);

  const record = appendQuickChangeRecord(root, {
    id: current.id,
    status: current.status,
    objective: current.objective,
    scope: current.scope,
    verifyCommand: current.verifyCommand,
    approvedHash: current.approvedHash,
    runs: [...current.runs, { at: new Date().toISOString(), status, evidence }],
    ...(current.tddExempt !== undefined ? { tddExempt: current.tddExempt } : {}),
    ...(current.tddExemptReason !== undefined ? { tddExemptReason: current.tddExemptReason } : {}),
    ...(current.closesBacklogId !== undefined ? { closesBacklogId: current.closesBacklogId } : {}),
  });

  return { id: record.id, status, evidence };
}
