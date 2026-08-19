import type { JournalRecord } from '../../state/journal.js';

// Pure over already-read journal records -- zero fs/path imports (this
// module lives under src/core/journal/, layering-tested alongside
// operations.ts to stay free of any I/O). Reads never write a new
// invalidation event: both invalidation checks (hash drift, a later
// amendment) are computed from the log's own append-order every time this
// is called, never persisted as a fact of their own.
export type AutoRunReason =
  | 'never enabled'
  | 'explicitly disabled'
  | 'hash changed since'
  | 'amendment recorded since';

export interface AutoRunAuthorization {
  authorized: boolean;
  // null exactly when authorized -- callers report the specific reason only
  // on refusal.
  reason: AutoRunReason | null;
}

// Authorized only when: the latest auto_run record for `milestone` is an
// `enable`; its recorded hash matches `currentHash` (the milestone's
// verification_approved_hash as of right now, supplied by the caller --
// this function never reads a contract itself); and no contract_amendment or
// task_amendment entry for `milestone` appears later in the log than that
// enable record. Both invalidation checks are structural derivations over
// existing record order, never a fact recorded by writing anything new.
export function isAutoRunAuthorized(
  records: JournalRecord[],
  milestone: string,
  currentHash: string | null,
): AutoRunAuthorization {
  const relevant = records.filter(
    (r) =>
      r.milestone === milestone &&
      (r.kind === 'auto_run' ||
        (r.kind === 'entry' && (r.type === 'contract_amendment' || r.type === 'task_amendment'))),
  );

  let lastEnableIndex = -1;
  let lastActionIsEnable = false;
  relevant.forEach((r, index) => {
    if (r.kind === 'auto_run') {
      lastActionIsEnable = r.action === 'enable';
      lastEnableIndex = lastActionIsEnable ? index : -1;
    }
  });

  const everEnabled = relevant.some((r) => r.kind === 'auto_run');
  if (!lastActionIsEnable) {
    return { authorized: false, reason: everEnabled ? 'explicitly disabled' : 'never enabled' };
  }

  const enableRecord = relevant[lastEnableIndex];
  const recordedHash = enableRecord?.kind === 'auto_run' ? (enableRecord.hash ?? null) : null;
  if (recordedHash !== currentHash) {
    return { authorized: false, reason: 'hash changed since' };
  }

  const amendedSince = relevant
    .slice(lastEnableIndex + 1)
    .some((r) => r.kind === 'entry' && (r.type === 'contract_amendment' || r.type === 'task_amendment'));
  if (amendedSince) {
    return { authorized: false, reason: 'amendment recorded since' };
  }

  return { authorized: true, reason: null };
}
