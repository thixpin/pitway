---
schema_version: 1
id: M021
title: Review Usage Tracking and Unattached Backlog Archive
status: in_progress
requirement: null
confirmed_at: 2026-08-21T19:05:01Z
verification_approved_hash: sha256:f359558cc19e957e92d14dc59bf711f41970c4dd97ed78858422d38465dc0a39
base_branch: main
base_revision: 07337967495d0a62d7e7cc30c0cb46da21f04314
acceptance_criteria:
  - id: AC001
    text: "B006: `reviewFindingsSnapshotSchema` (src/state/schemas.ts) gains a
      nullable `usage: taskUsageSchema` field, reusing the existing
      taskUsageSchema type verbatim -- no new schema type. Additive-optional
      like every prior field added to this file; every reviews.yaml written
      before this milestone parses unchanged (absent field, treated as null)."
  - id: AC002
    text: "`milestone-review record <id> --role <role> --file <path> [--usage
      <json>]` accepts an optional --usage flag, parsed/validated the same way
      `task-update`'s --usage is (reusing that parsing logic's shape, never a
      new ad hoc parser) -- a measured figure only, never estimated or derived,
      attached to the snapshot at record time. Omitting --usage leaves usage
      null, exactly like an inline (non-dispatched) task today."
  - id: AC003
    text: "`milestone-review report <id>` renders each recorded role's usage (when
      present) and a session-level total (summed across every recorded role's
      latest snapshot), mirroring the existing `Tokens: X (N tasks N/A)`
      convention used elsewhere in the codebase. A role with null usage is
      disclosed as missing, never silently omitted or treated as zero."
  - id: AC004
    text: "Cost is explicitly out of scope for this milestone: tokens only. No
      dollar-cost field, estimate, or hardcoded price table anywhere -- the
      Claude Code Agent tool reports token counts, never a dollar figure, and
      decision 8 (never estimate) forbids deriving one from a price table PitWay
      has no authoritative source for. This narrows B006's original 'estimated
      cost where available' wording; the narrowing and its reasoning are
      recorded in this contract's Design Decisions and in the completion
      evidence, not silently dropped."
  - id: AC005
    text: "`dispatch.md`/`protocol-driver.md` gain a small addition instructing the
      driver to pass `--usage` when recording a dispatched reviewer's findings,
      mirroring the existing task-dispatch usage MUST rule (M019/T007) -- the
      review-side equivalent of the same driver obligation, so a future driver
      inherits it too."
  - id: AC006
    text: "B007: `src/state/journal.ts` gains a new sibling journal record kind,
      `backlog_archive` -- mirroring `journalQuickChangeSchema`'s own
      no-milestone-field precedent (quick-change already proves a milestone-less
      journal-backed record is safe and structurally excluded from
      checkpoint-folding). Fields: id, target (the archived backlog item's id),
      reason, at. Never checkpoint-eligible; naturally excluded from
      `derivePending` (which filters `kind === 'entry'` only, unaffected by this
      addition) -- no `resolveTargetPath` case needed, matching
      `milestone_merge`/`worktree_integrate`/`worktree_discard`."
  - id: AC007
    text: "`archiveBacklogItem` (src/core/backlog/archive.ts) drops its
      `resolveActiveMilestoneStrict` call entirely and instead appends the new
      sibling record via a new `appendBacklogArchiveRecord` function
      (src/state/journal.ts) -- `backlog archive <id> --reason <text>` now
      succeeds with `state.active_milestone: null`. `add`/`list`/`show`/
      `promote` are completely unchanged: still unconditionally require an
      active milestone, per M018's own disclosed safety reasoning (a shared,
      non-exclusive journal target where an override could misattribute a
      pending entry) -- that reasoning never applied to archive itself, which
      finalizes an already-fully-identified existing item rather than creating
      new pending state."
  - id: AC008
    text: "A real regression test reproduces B007's own finding: `backlog archive
      <id> --reason <text>` succeeds with `state.active_milestone: null` (the
      exact scenario that failed twice for real, post-M018 and post-M019), and a
      second test proves `add`/`promote` still refuse identically to before --
      never weakened."
  - id: AC009
    text: "IMPLEMENTATION_PLAN.md reconciled: §4 State Schema documents the new
      `usage` field on a review findings snapshot and the new `backlog_archive`
      journal kind; §7 documents `milestone-review record`'s new `--usage` flag.
      `pitway backlog promote B006 --task T001` and `pitway backlog promote B007
      --task T002` both run post-confirm, closing out both backlog items
      formally."
  - id: AC010
    text: The full test suite and `tsc --noEmit` stay green throughout.
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npx vitest run tests/unit/schemas.test.ts
  - id: CT002
    criterion: AC002
    type: command
    command: npx vitest run tests/integration/milestone-review-record.test.ts
  - id: CT003
    criterion: AC003
    type: command
    command: npx vitest run tests/integration/milestone-review-report.test.ts
  - id: CT004
    criterion: AC004
    type: manual
    instruction: Confirm no dollar-cost field/estimate/price table exists anywhere
      in the diff -- a code review, not a runnable check.
  - id: CT005
    criterion: AC005
    type: manual
    instruction: Confirm dispatch.md/protocol-driver.md carry the new review-usage
      MUST instruction, by direct file read.
  - id: CT006
    criterion: AC006
    type: command
    command: npx vitest run tests/unit/journal.test.ts
  - id: CT007
    criterion: AC007
    type: command
    command: npx vitest run tests/integration/backlog.test.ts
  - id: CT008
    criterion: AC008
    type: command
    command: npx vitest run tests/integration/backlog.test.ts
  - id: CT009
    criterion: AC009
    type: manual
    instruction: Review the IMPLEMENTATION_PLAN.md diff; confirm backlog promote
      B006/B007 both succeed via pitway backlog list.
  - id: CT010
    criterion: AC010
    type: command
    command: npm run build && npm test && npx tsc --noEmit
---

# M021: Review Usage Tracking and Unattached Backlog Archive

## Background

Two real, disclosed backlog items, both real gaps found through this
project's own dogfooding, neither a bounded single-file fix once
investigated:

- **B006** (filed mid-M020, direct developer request): `pitway
  milestone-review` has no usage-tracking mechanism at all -- a dispatched
  reviewer subagent's token usage is never recorded, unlike `task-dispatch`'s
  own `--usage` MUST rule (M019/T007).
- **B007** (filed end-of-M020, a twice-recurred dogfood finding): `backlog
  archive` unconditionally requires an active milestone, the same M018 rule
  that correctly protects `add`/`promote` from misattributing new pending
  state -- but archive finalizes an already-identified existing item, so
  that risk never applied to it.

Pre-contract investigation found both are real, well-precedented, additive
changes -- not invasive shared-schema surgery -- once traced to their actual
attach points (`reviewFindingsSnapshotSchema`'s existing `taskUsageSchema`
reuse for B006; `journalQuickChangeSchema`'s existing milestone-less sibling
pattern for B007). Neither fits `quick-change` scope (each touches
schema + CLI + at least one more file), so both land here as one milestone
per explicit developer decision.

## Design Decisions

- **Tokens only, no cost.** B006's original wording mentioned "estimated
  cost where available." Investigation found no dollar-cost source
  anywhere in the runtime or codebase, and decision 8 (never estimate)
  forbids deriving one from a hardcoded price table. AC004 formally
  narrows scope to tokens only, disclosed rather than silently dropped.
- **B007 mirrors quick-change's own precedent, not a shared-schema change.**
  `journalEntrySchema.milestone` stays non-nullable and untouched -- every
  other journal-backed mechanism is unaffected. `backlog_archive` is a new,
  independent sibling kind, exactly like `quick_change`/`milestone_merge`/
  `worktree_integrate`/`worktree_discard` before it.
- **`add`/`list`/`show`/`promote` are untouched.** Only `archive` changes;
  M018's original safety reasoning for requiring an active milestone stays
  fully intact for every other subcommand.

## Change Log

- 2026-08-22: Initial draft.
