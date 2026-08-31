import { z } from 'zod';

// Journal-local schemas (M005 T001): append-only, git-invisible log of
// pending state-changing operations (usage recordings, contract/task
// amendments) awaiting a checkpoint commit. task_transition and
// verification_result are deliberately excluded — this schema's type enum
// is the enforcement point. Defined here rather than in state/schemas.ts:
// nothing outside this module depends on these types yet, and keeping them
// local avoids widening this task's write scope onto the shared schemas
// file for schema additions no other module currently needs.
const journalMilestoneId = z.string().regex(/^M\d{3}$/, 'milestone id must match M000');

export const journalOperationTypeSchema = z.enum([
  'usage_recording',
  'contract_amendment',
  'task_amendment',
  // M015/T001 (AC001/AC008): every milestone-review mutation
  // (start/record/decide) is journal-backed exactly like a usage recording
  // or amendment -- materialized immediately, checkpointed on the next
  // qualifying commit via resolveTargetPath's reviews.yaml case below.
  'review_recording',
  // M018/T001 (AC003): every backlog mutation (add/promote/archive) is
  // journal-backed exactly like a task_amendment -- reused across all
  // three mutations the same way task_amendment is reused by both
  // task-add and task-amend. Always attached to state.active_milestone
  // (never an override; see M018's AC004) and checkpointed via
  // resolveTargetPath's root-level '.pitway/backlog.yaml' case below.
  'backlog_recording',
]);

export const journalEntrySchema = z.strictObject({
  kind: z.literal('entry'),
  milestone: journalMilestoneId,
  type: journalOperationTypeSchema,
  operationId: z.string().min(1),
  target: z.string().min(1).optional(),
  payload: z.record(z.string(), z.unknown()),
});

// Marks an entry as checkpointed by a commit; never replaces or removes the
// original entry. More than one marker may reference the same commitSha
// (a single commit can fold in multiple pending operations).
export const journalCheckpointSchema = z.strictObject({
  kind: z.literal('checkpoint'),
  milestone: journalMilestoneId,
  entryOperationId: z.string().min(1),
  commitSha: z.string().min(1),
});

// Sibling third member of the discriminated union (M005 T005): records an
// auto-run authorization decision. Never referenced by a checkpoint marker
// -- there is no target state file for one to check against -- and never
// folded into a commit. `action: 'enable'` is never a 4th value of
// journalOperationTypeSchema's operation-type enum; it's a field on a wholly
// separate top-level `kind`. `hash` records the milestone's
// verification_approved_hash at the moment of an `enable`; a `disable`
// record carries no hash. See src/core/journal/auto-run.ts's
// isAutoRunAuthorized for how authorization is derived, purely, from these
// records' position in the existing log order.
export const journalAutoRunSchema = z.strictObject({
  kind: z.literal('auto_run'),
  milestone: journalMilestoneId,
  action: z.enum(['enable', 'disable']),
  hash: z.string().min(1).optional(),
});

// Fourth sibling member of the discriminated union (M007/T003): records one
// step of a quick-change's draft -> approved -> committed lifecycle (plus
// draft|approved -> cancelled and approved -> promoted). Like auto_run, this
// is never referenced by a checkpoint marker and never folded into a
// milestone commit -- there is no target state file for resolveTargetPath to
// map it to, and derivePending's `kind === 'entry'` filter already excludes
// it structurally, the same way it already excludes auto_run.
//
// Storage decision (documented per T003's brief): appendJournalEntry/
// appendCheckpointMarker/appendAutoRunRecord only ever APPEND; none of them
// mutate an existing record. A quick-change's lifecycle needs to move
// through several states over time, so every transition (create, approve, a
// run attempt, cancel, promote) appends a NEW quick_change record carrying
// the change's id and its full current field set -- never a partial patch.
// "Current state" is derived by folding over every record sharing that id,
// in append order, and taking the latest one (see deriveQuickChangeState in
// src/core/quick-change/create.ts, mirroring isAutoRunAuthorized's
// pure-derivation-over-record-order style). `runs` is itself append-only
// within each snapshot -- a later record's `runs` array is always the prior
// one plus zero or one newly appended attempt, never shorter -- which is how
// "every quick-change run attempt, pass or fail, is preserved" holds even
// though the underlying journal file only ever appends whole records.
export const journalQuickChangeStatusSchema = z.enum([
  'draft',
  'approved',
  'committed',
  'cancelled',
  'promoted',
]);

export const journalQuickChangeRunSchema = z.strictObject({
  at: z.string().min(1),
  status: z.enum(['pass', 'fail']),
  evidence: z.string().min(1),
});

// Defined locally, mirroring journalMilestoneId/journalTaskId's own
// precedent above -- this task's write scope stays limited to journal.ts +
// the quick-change modules rather than widening onto state/schemas.ts for
// an id-pattern already defined there under a different name
// (backlogItemId, private to schemas.ts).
const journalBacklogItemId = z.string().regex(/^B\d{3}$/, 'backlog item id must match B000');

export const journalQuickChangeSchema = z
  .strictObject({
    kind: z.literal('quick_change'),
    id: z.string().min(1),
    status: journalQuickChangeStatusSchema,
    objective: z.string().min(1),
    // The exact file census declared at create time -- locked (never
    // widened/narrowed) once approvedHash is set at approve.
    scope: z.array(z.string().min(1)),
    verifyCommand: z.string().min(1),
    // Set once approved: sha256 over {scope, verifyCommand, tddExempt, tddExemptReason, closesBacklogId} exactly as
    // declared at create. Absent on a still-draft record. Gates `quick-change
    // run` (T004's job) the same way verification_approved_hash gates
    // `pitway verify` today.
    approvedHash: z.string().min(1).optional(),
    runs: z.array(journalQuickChangeRunSchema),
    // B020: TDD exemption for doc-only or genuinely test-free changes.
    // When true, commit does not require RED→GREEN (a failing run before the passing run).
    // Must be declared at create time and is hashed/locked at approve time.
    tddExempt: z.boolean().optional(),
    tddExemptReason: z.string().min(1).optional(),
    // M037/T001: optional backlog item this quick-change closes on commit.
    // Declared at create time (validated pending), locked/hashed at approve
    // time exactly like tddExempt, and never mutated by cancel/promote --
    // only commit.ts's archive step ever advances the linked item's status.
    closesBacklogId: journalBacklogItemId.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.tddExempt === true && (data.tddExemptReason === undefined || data.tddExemptReason.trim().length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'tddExempt requires a non-empty tddExemptReason',
        path: ['tddExemptReason'],
      });
    }
    if (data.tddExempt !== true && data.tddExemptReason !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'tddExemptReason requires tddExempt to be true',
        path: ['tddExemptReason'],
      });
    }
  });

// Fifth sibling member of the discriminated union (task-verify evidence
// engine): captures one task-scoped command/tdd verification run --
// evidence PitWay accumulates while a task is in_progress, distinct from the
// milestone-level, per-AC, checkpoint-gated verification-results.yaml. Like
// auto_run/quick_change, this is never referenced by a checkpoint marker and
// never folded into a milestone commit -- there is no target state file for
// resolveTargetPath to map it to, and derivePending's `kind === 'entry'`
// filter already excludes it structurally. Append-only: every verify
// attempt appends its own full record; src/core/tasks/verify.ts is the sole
// writer and never mutates a prior one.
export const journalTaskVerifyFingerprintEntrySchema = z.strictObject({
  path: z.string().min(1),
  state: z.enum(['present', 'missing']),
  // sha256:<64 hex> for a present file's real content; the fixed
  // MISSING_HASH_MARKER (src/core/tasks/verify.ts) for a declared path that
  // does not exist on disk -- never skipped, never thrown, so a rename's
  // "old half" is representable without any dedicated pairing logic.
  hash: z.string().min(1),
});

export const journalTaskVerifyFingerprintSchema = z.strictObject({
  entries: z.array(journalTaskVerifyFingerprintEntrySchema),
});

const journalTerminationReasonSchema = z.enum(['exited', 'timeout', 'signal', 'spawn_error']);

export const journalTaskVerifyTypecheckSchema = z.strictObject({
  command: z.string().min(1),
  exitCode: z.number().int().nullable(),
  evidence: z.string().min(1),
});

// Defined locally, mirroring journalMilestoneId's own precedent above --
// this task's write scope stays limited to journal.ts + verify.ts rather
// than widening onto state/schemas.ts for an id-pattern already defined
// there under a different name (taskId).
const journalTaskId = z.string().regex(/^T\d{3}$/, 'task id must match T000');

export const journalTaskVerifyEvidenceSchema = z.strictObject({
  kind: z.literal('task_verify_evidence'),
  id: z.string().min(1),
  milestone: journalMilestoneId,
  taskId: journalTaskId,
  attempts: z.number().int().nonnegative(),
  command: z.string().min(1),
  exitCode: z.number().int().nullable(),
  passCount: z.number().int().nonnegative().optional(),
  failCount: z.number().int().nonnegative().optional(),
  // M048/T003 (AC003): failed attempts only; the structured failing names /
  // error lines beside the capped evidence string. Absent when nothing matched.
  failures: z.array(z.string().min(1)).min(1).optional(),
  evidence: z.string().min(1),
  durationMs: z.number().int().nonnegative(),
  terminationReason: journalTerminationReasonSchema,
  typecheck: journalTaskVerifyTypecheckSchema.optional(),
  fingerprint: journalTaskVerifyFingerprintSchema,
  at: z.string().min(1),
});

// AC004/T004 (M014): one record per task-dispatch into a temporary worktree.
// Like auto_run/quick_change/task_verify_evidence, a sibling record kind --
// never checkpoint-eligible, no target state file, structurally excluded
// from derivePending. A dispatch is "live" until a later worktree_integrate
// or worktree_discard record references its id (derivation lives in
// src/core/tasks/dispatch.ts, pure over already-read records).
export const journalWorktreeDispatchSchema = z.strictObject({
  kind: z.literal('worktree_dispatch'),
  id: z.string().min(1),
  milestone: journalMilestoneId,
  taskId: journalTaskId,
  branch: z.string().min(1),
  worktreePath: z.string().min(1),
  createdFrom: z.string().min(1),
  at: z.string().min(1),
});

// AC006/T006 (M014): closes a worktree_dispatch (referenced by dispatchId)
// after its diff landed in the main tree. workerSha is the scaffolding
// branch's HEAD -- evidence-only transport metadata, never persisted into
// tasks.yaml (decision 4 unchanged; it becomes dangling after cleanup by
// design).
export const journalWorktreeIntegrateSchema = z.strictObject({
  kind: z.literal('worktree_integrate'),
  id: z.string().min(1),
  dispatchId: z.string().min(1),
  milestone: journalMilestoneId,
  taskId: journalTaskId,
  workerSha: z.string().min(1),
  at: z.string().min(1),
});

// AC008/T008 (M014): closes a worktree_dispatch (by dispatchId) after its
// worktree was abandoned without integrating. discardedSha is the
// scaffolding branch's HEAD when still resolvable -- evidence-only, like
// worktree_integrate's workerSha.
export const journalWorktreeDiscardSchema = z.strictObject({
  kind: z.literal('worktree_discard'),
  id: z.string().min(1),
  dispatchId: z.string().min(1),
  milestone: journalMilestoneId,
  taskId: journalTaskId,
  reason: z.string().min(1),
  discardedSha: z.string().min(1).nullable(),
  at: z.string().min(1),
});

// Ninth sibling member of the discriminated union (M019/T001): records one
// `pitway milestone-merge` outcome -- a successful merge or an idempotent
// already-merged short-circuit. Like auto_run/quick_change/worktree_*, this
// is never referenced by a checkpoint marker and never folded into a
// milestone commit -- there is no target state file for resolveTargetPath
// to map it to, and derivePending's `kind === 'entry'` filter already
// excludes it structurally. Append-only: every completed invocation (either
// outcome) appends its own full record via appendMilestoneMergeRecord;
// src/core/milestones/merge.ts is the sole writer. mergeCommitSha is the
// created merge commit's SHA on the success path, or the already-satisfying
// ancestor SHA (the milestone's completion commit) on the already-merged
// path -- never null either way, since a completion commit always exists by
// the time a merge is attempted.
export const journalMilestoneMergeSchema = z.strictObject({
  kind: z.literal('milestone_merge'),
  id: z.string().min(1),
  milestone: journalMilestoneId,
  targetBranch: z.string().min(1),
  mergeCommitSha: z.string().min(1),
  alreadyMerged: z.boolean(),
  at: z.string().min(1),
});

// Tenth sibling member of the discriminated union (M021/T002, B007):
// records one `backlog archive` outcome. Mirrors journalQuickChangeSchema's
// own no-milestone-field precedent -- archiving finalizes an already fully
// identified backlog item, never a milestone-attributed pending mutation, so
// there is nothing here for an active milestone to misattribute. Like every
// other sibling above, this is never referenced by a checkpoint marker and
// never folded into a milestone commit -- there is no target state file for
// resolveTargetPath to map it to, and derivePending's `kind === 'entry'`
// filter already excludes it structurally. Append-only:
// appendBacklogArchiveRecord is the sole writer (src/core/backlog/archive.ts)
// and never mutates a prior record.
export const journalBacklogArchiveSchema = z.strictObject({
  kind: z.literal('backlog_archive'),
  id: z.string().min(1),
  target: z.string().min(1),
  reason: z.string().min(1),
  at: z.string().min(1),
});

// Eleventh sibling member of the discriminated union (T002): records one
// `backlog add` outcome when no milestone is active at add time. Mirrors
// journalBacklogArchiveSchema's own no-milestone-field precedent -- unlike
// journalEntrySchema's kind:'entry' path (whose `milestone` field is
// non-nullable, shared with usage_recording/contract_amendment/etc., which
// legitimately require a real milestone id), a milestone-less add has
// nothing to attach an entry-kind record to. sourceMilestone/sourceTask
// carry the item's resolved source.* values as recorded on the backlog item
// itself (usually both null, but an explicit --milestone/--task override
// can still populate them even with no *active* milestone). Like every
// other sibling above, this is never referenced by a checkpoint marker and
// never folded into a milestone commit -- there is no target state file for
// resolveTargetPath to map it to, and derivePending's `kind === 'entry'`
// filter already excludes it structurally. Append-only:
// appendBacklogAddUnscopedRecord is the sole writer (src/core/backlog/add.ts)
// and never mutates a prior record.
export const journalBacklogAddUnscopedSchema = z.strictObject({
  kind: z.literal('backlog_add_unscoped'),
  id: z.string().min(1),
  target: journalBacklogItemId,
  title: z.string().min(1),
  reason: z.string().min(1),
  sourceMilestone: journalMilestoneId.nullable(),
  sourceTask: journalTaskId.nullable(),
  at: z.string().min(1),
});

export const journalRecordSchema = z.discriminatedUnion('kind', [
  journalEntrySchema,
  journalCheckpointSchema,
  journalAutoRunSchema,
  journalQuickChangeSchema,
  journalTaskVerifyEvidenceSchema,
  journalWorktreeDispatchSchema,
  journalWorktreeIntegrateSchema,
  journalWorktreeDiscardSchema,
  journalMilestoneMergeSchema,
  journalBacklogArchiveSchema,
  journalBacklogAddUnscopedSchema,
]);

export const journalFileSchema = z.strictObject({
  schema_version: z.literal(1),
  entries: z.array(journalRecordSchema),
});

export type JournalOperationType = z.infer<typeof journalOperationTypeSchema>;
export type JournalEntry = z.infer<typeof journalEntrySchema>;
export type JournalCheckpoint = z.infer<typeof journalCheckpointSchema>;
export type JournalAutoRun = z.infer<typeof journalAutoRunSchema>;
export type JournalQuickChangeStatus = z.infer<typeof journalQuickChangeStatusSchema>;
export type JournalQuickChangeRun = z.infer<typeof journalQuickChangeRunSchema>;
export type JournalQuickChange = z.infer<typeof journalQuickChangeSchema>;
export type JournalTaskVerifyFingerprintEntry = z.infer<typeof journalTaskVerifyFingerprintEntrySchema>;
export type JournalTaskVerifyFingerprint = z.infer<typeof journalTaskVerifyFingerprintSchema>;
export type JournalTaskVerifyTypecheck = z.infer<typeof journalTaskVerifyTypecheckSchema>;
export type JournalTaskVerifyEvidence = z.infer<typeof journalTaskVerifyEvidenceSchema>;
export type JournalWorktreeDispatch = z.infer<typeof journalWorktreeDispatchSchema>;
export type JournalWorktreeIntegrate = z.infer<typeof journalWorktreeIntegrateSchema>;
export type JournalWorktreeDiscard = z.infer<typeof journalWorktreeDiscardSchema>;
export type JournalMilestoneMerge = z.infer<typeof journalMilestoneMergeSchema>;
export type JournalBacklogArchive = z.infer<typeof journalBacklogArchiveSchema>;
export type JournalBacklogAddUnscoped = z.infer<typeof journalBacklogAddUnscopedSchema>;
export type JournalRecord = z.infer<typeof journalRecordSchema>;
export type JournalFile = z.infer<typeof journalFileSchema>;
