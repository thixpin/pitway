import type {
  JournalCheckpoint,
  JournalEntry,
  JournalOperationType,
  JournalRecord,
} from '../../state/journal.js';

export class JournalValidationError extends Error {}

// Derives pending entries — entry-kind records with no later checkpoint
// marker referencing their operationId — from data already loaded through
// src/state/journal.ts. Computed, not stored: nothing is deleted to make an
// entry stop being pending.
export function derivePending(entries: JournalRecord[]): JournalEntry[] {
  const checkpointed = new Set(
    entries
      .filter((e): e is JournalCheckpoint => e.kind === 'checkpoint')
      .map((e) => e.entryOperationId),
  );
  return entries.filter(
    (e): e is JournalEntry => e.kind === 'entry' && !checkpointed.has(e.operationId),
  );
}

export interface BuildJournalEntryInput {
  milestone: string;
  type: JournalOperationType;
  operationId: string;
  target?: string;
  payload: Record<string, unknown>;
}

// Validation-only construction of a well-formed entry — no I/O. The result
// is passed to src/state/journal.ts's appendJournalEntry, which owns
// persistence and the zod-level schema check.
export function buildJournalEntry(input: BuildJournalEntryInput): Omit<JournalEntry, 'kind'> {
  if (input.operationId.trim().length === 0) {
    throw new JournalValidationError('journal entry operationId must not be empty');
  }
  return {
    milestone: input.milestone,
    type: input.type,
    operationId: input.operationId,
    target: input.target,
    payload: input.payload,
  };
}

// Maps an entry to the repo-relative state file it corresponds to, used by
// self-healing recovery to compare on-disk content against what a commit at
// HEAD actually committed. Pure — zero fs/path imports (layering-tested).
// `milestoneDir` is the already-resolved directory name (bare or slugged);
// resolving it is the caller's job (src/state/journal.ts, src/git/safety.ts
// — both already State-layer-adjacent), keeping this module free of any I/O.
export function resolveTargetPath(
  entry: Pick<JournalEntry, 'type'>,
  milestoneDir: string,
): string {
  switch (entry.type) {
    case 'usage_recording':
      return `.pitway/milestones/${milestoneDir}/usage.yaml`;
    case 'contract_amendment':
      return `.pitway/milestones/${milestoneDir}/contract.md`;
    case 'task_amendment':
      return `.pitway/milestones/${milestoneDir}/tasks.yaml`;
    case 'review_recording':
      return `.pitway/milestones/${milestoneDir}/reviews.yaml`;
  }
}
