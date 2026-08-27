import type {
  JournalCheckpoint,
  JournalEntry,
  JournalOperationType,
  JournalRecord,
} from './journal.js';

// M038/T002 (AC004): pure helpers over already-read journal records. They
// lived in src/core/journal/operations.ts until src/state/journal.ts's own
// need for derivePending/resolveTargetPath made State import Core -- an
// upward edge in the declared CLI -> Core -> State + Git layering. They are
// State-layer knowledge (what a journal entry is, which state file it maps
// to), so they live here now. Zero fs/path imports, layering-tested.

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
// resolving it is the caller's job (src/state/journal.ts's reconcilePending
// and src/core/journal/pending-targets.ts), keeping this module free of any
// I/O.
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
    // M018/T001 (AC003): root-level, not milestone-nested -- milestoneDir
    // is unused on this branch, since .pitway/backlog.yaml is a shared
    // authoritative file, not owned by any one milestone's directory.
    case 'backlog_recording':
      return '.pitway/backlog.yaml';
  }
}
