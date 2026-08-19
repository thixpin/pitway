import { createHash } from 'node:crypto';
import { relative, resolve, sep } from 'node:path';
import { checkWorkingTreeClean } from '../../git/safety.js';
import {
  appendQuickChangeRecord,
  readJournal,
  type JournalQuickChange,
  type JournalQuickChangeStatus,
  type JournalRecord,
} from '../../state/journal.js';
import { loadState } from '../../state/store.js';

export class QuickChangeError extends Error {}

// State/schema/lifecycle only (M007/T003): create + approve (+ a minimal,
// append-only cancel). Actually executing the approved verify command,
// producing the commit, and converting a promoted change into a milestone
// draft are explicitly out of scope here -- T004 (verification/commit/
// recovery/trailer) and T005 (CLI/resume/assets/integration) build on top of
// what this file exposes. No CLI surface is registered from this module.

export interface CreateQuickChangeInputs {
  objective: string;
  // The exact file census this change is allowed to touch -- locked once
  // approveQuickChange hashes it.
  scope: string[];
  verifyCommand: string;
}

export interface QuickChangeView {
  id: string;
  status: JournalQuickChangeStatus;
  objective: string;
  scope: string[];
  verifyCommand: string;
  approvedHash: string | null;
  runs: JournalQuickChange['runs'];
}

function toView(record: JournalQuickChange): QuickChangeView {
  return {
    id: record.id,
    status: record.status,
    objective: record.objective,
    scope: record.scope,
    verifyCommand: record.verifyCommand,
    approvedHash: record.approvedHash ?? null,
    runs: record.runs,
  };
}

// Pure derivation over already-read journal records -- mirrors
// isAutoRunAuthorized's style (src/core/journal/auto-run.ts): a
// quick-change's current state is never stored directly, only folded from
// every quick_change-kind record sharing its id, in append order, taking the
// latest. Lives here (rather than alongside auto-run under
// src/core/journal/) because src/core/journal/ is outside this task's write
// scope; nothing else needs this derivation yet.
export function deriveQuickChangeState(
  records: JournalRecord[],
  changeId: string,
): JournalQuickChange | undefined {
  const relevant = records.filter(
    (r): r is JournalQuickChange => r.kind === 'quick_change' && r.id === changeId,
  );
  return relevant.length > 0 ? relevant[relevant.length - 1] : undefined;
}

// Every quick-change record ever appended for any id, oldest first --
// exposed for callers (e.g. `pitway resume`, built in T005) that need to
// discover pending quick-changes without knowing an id up front.
export function readAllQuickChanges(root: string): JournalQuickChange[] {
  return readJournal(root).filter((r): r is JournalQuickChange => r.kind === 'quick_change');
}

// Resolves against the repository root and rejects anything outside it,
// returning a posix-style repo-relative path -- the same normalization
// src/core/verification/repair.ts's assertValidFileList uses for --file, but
// written locally rather than imported, to avoid a cross-task dependency on
// a sibling AC002 module.
function normalizeRepoRelativePath(root: string, inputPath: string): string {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(root, inputPath);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(resolvedRoot + sep)) {
    throw new QuickChangeError(`--scope path resolves outside the repository: ${inputPath}`);
  }
  return relative(resolvedRoot, resolvedPath).split(sep).join('/');
}

// Every path under .pitway/ is a protected path a quick-change's scope may
// never include (AC003) -- workflow state belongs to PitWay's own commands,
// never to a quick-change's declared file census.
function assertValidScope(root: string, rawScope: string[]): string[] {
  if (rawScope.length === 0) {
    throw new QuickChangeError('--scope requires at least one path');
  }
  const normalized = rawScope.map((p) => normalizeRepoRelativePath(root, p));
  const seen = new Set<string>();
  for (const path of normalized) {
    if (seen.has(path)) {
      throw new QuickChangeError(`duplicate --scope path: ${path}`);
    }
    seen.add(path);
  }
  for (const path of normalized) {
    if (path === '.pitway' || path.startsWith('.pitway/')) {
      throw new QuickChangeError(
        `--scope ${path} is not a valid quick-change target: every path under .pitway/ is protected`,
      );
    }
  }
  return normalized;
}

// Mirrors task-update's own clean-start invariant (assertDirtySubset in
// src/core/tasks/update.ts) but simpler: a quick-change has no pending
// journal-materialized state file of its own to allow through, so create
// requires the tree to be fully clean, not merely a known subset.
function assertCleanWorkingTree(root: string): void {
  const { clean, dirtyPaths } = checkWorkingTreeClean(root);
  if (!clean) {
    throw new QuickChangeError(
      `cannot create quick-change: working tree is not clean: ${dirtyPaths.join(', ')}`,
    );
  }
}

// A bug inside an active milestone's own scope uses a task or the ripple-fix
// policy, not this mechanism -- so create refuses outright while any
// milestone is in_progress (or in any other non-null active state).
function assertNoActiveMilestone(root: string): void {
  const state = loadState(root);
  if (state.active_milestone !== null) {
    throw new QuickChangeError(
      `cannot create quick-change: ${state.active_milestone} is the active milestone; ` +
        `a bug inside an active milestone's own scope uses a task or the ripple-fix policy instead`,
    );
  }
}

// sha256 over the declared scope + verify command exactly as approved --
// deliberately narrower than computeVerificationHash's contract-frontmatter
// canonicalization (src/core/contracts/verification-hash.ts), since a
// quick-change has no contract frontmatter to hash from. Prefixed
// "sha256:" to match the same format sha256Hash (src/state/schemas.ts) and
// verification_approved_hash already use.
function computeQuickChangeHash(scope: string[], verifyCommand: string): string {
  const canonical = JSON.stringify({ scope, verifyCommand });
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

function generateChangeId(): string {
  const digest = createHash('sha256')
    .update(`${Date.now()}:${Math.random()}`)
    .digest('hex');
  return `qc-${digest.slice(0, 8)}`;
}

// create: draft state. Requires active_milestone: null and a clean working
// tree, and refuses any --scope path under .pitway/. Appends the first
// quick_change record for a freshly generated id; no git operation.
export function createQuickChange(
  root: string,
  inputs: CreateQuickChangeInputs,
): QuickChangeView {
  if (inputs.objective.trim().length === 0) {
    throw new QuickChangeError('quick-change create requires a non-empty --objective');
  }
  if (inputs.verifyCommand.trim().length === 0) {
    throw new QuickChangeError('quick-change create requires a non-empty --verify command');
  }
  assertNoActiveMilestone(root);
  assertCleanWorkingTree(root);
  const scope = assertValidScope(root, inputs.scope);

  const id = generateChangeId();
  const record = appendQuickChangeRecord(root, {
    id,
    status: 'draft',
    objective: inputs.objective,
    scope,
    verifyCommand: inputs.verifyCommand,
    runs: [],
  });
  return toView(record);
}

function requireQuickChange(root: string, changeId: string): JournalQuickChange {
  const current = deriveQuickChangeState(readJournal(root), changeId);
  if (current === undefined) {
    throw new QuickChangeError(`unknown quick-change ${changeId}`);
  }
  return current;
}

// approve: draft -> approved. Hashes and locks exactly the scope/verify
// command declared at create -- approve takes no fields of its own to
// change, matching AC003's "approve hashes and locks them" (gated exactly
// like verification_approved_hash gates `pitway verify`).
export function approveQuickChange(root: string, changeId: string): QuickChangeView {
  const current = requireQuickChange(root, changeId);
  if (current.status !== 'draft') {
    throw new QuickChangeError(
      `cannot approve ${changeId}: status is "${current.status}", not draft`,
    );
  }
  const approvedHash = computeQuickChangeHash(current.scope, current.verifyCommand);
  const record = appendQuickChangeRecord(root, {
    id: current.id,
    status: 'approved',
    objective: current.objective,
    scope: current.scope,
    verifyCommand: current.verifyCommand,
    approvedHash,
    runs: current.runs,
  });
  return toView(record);
}

// cancel: valid only from draft or approved, never from committed (or an
// already-terminal cancelled/promoted state). Append-only status flip, no
// execution and no git operation -- matches AC003's "performs no git
// operation if nothing was ever committed" exactly, since nothing this
// module builds ever commits anything.
export function cancelQuickChange(root: string, changeId: string): QuickChangeView {
  const current = requireQuickChange(root, changeId);
  if (current.status !== 'draft' && current.status !== 'approved') {
    throw new QuickChangeError(
      `cannot cancel ${changeId}: status is "${current.status}", not draft or approved`,
    );
  }
  const record = appendQuickChangeRecord(root, {
    id: current.id,
    status: 'cancelled',
    objective: current.objective,
    scope: current.scope,
    verifyCommand: current.verifyCommand,
    ...(current.approvedHash !== undefined ? { approvedHash: current.approvedHash } : {}),
    runs: current.runs,
  });
  return toView(record);
}
