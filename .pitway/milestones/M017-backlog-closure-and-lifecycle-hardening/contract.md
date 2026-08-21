---
schema_version: 1
id: M017
title: Backlog Closure and Lifecycle Hardening
status: completed
requirement: null
confirmed_at: 2026-08-21T04:12:39Z
verification_approved_hash: sha256:f64177bf31d5904d8855683630843b2fc9ce7b89bf01676934157a52e88da581
base_branch: main
base_revision: 3f774bfc3b5ef4ed85430776da101a95fa6f0cb0
acceptance_criteria:
  - id: AC001
    text: "`milestone-confirm` reconciles pending journal entries after its baseline
      commit: both commit-producing paths in `src/core/milestones/confirm.ts`
      (fresh confirm and resumed confirm) call `reconcilePending(root,
      milestoneId)` after `createBaselineCommit`, mirroring the existing call
      sites in `task-update`'s completion path and `milestone-complete`.
      `milestone-confirm --amend` is deliberately NOT a third site: it
      journal-records and materializes without any commit of its own (verified
      in `confirm.ts`), so there is nothing for it to reconcile against. A
      milestone confirmed with journal-pending entries whose target file the
      baseline commit already committed (e.g. `review_recording` entries from a
      pre-confirmation `milestone-review` session -- exactly what blocked M016's
      first `task-dispatch`) has zero pending entries immediately afterward and
      can dispatch at once. Regression test: open a review session on a draft,
      confirm, assert `derivePending` is empty for that milestone and
      `task-dispatch` succeeds under `parallel_worktrees`; control: an entry
      whose target genuinely differs from HEAD stays pending (the existing
      `reconcilePending` byte-match semantics are reused, never widened)."
  - id: AC002
    text: "A new `task-add <milestone> --file <yaml> --change-log <text>` command
      inserts one task into a CONFIRMED or IN_PROGRESS milestone (surface 22 ->
      23; quick-change/task-amend registration precedent): the file holds one
      task definition validated by the existing `taskSchema` minus execution
      fields (`status`/`result`/`usage`/ `attempts` refused if present; every
      validation failure, zod's included, is wrapped in a `TaskAddError` exactly
      as `task-amend` wraps its own via `formatIssues` -- never a raw zod
      throw); the id must be exactly the next sequential `Tnnn` (refuse gaps and
      collisions); every `depends_on` id must name an existing, non-cancelled
      task (a dependency on a cancelled task would leave the new task
      permanently waiting); `name` is required for new tasks; status is derived
      by the existing `resolveReadyTasks`. Refuses: `draft` (pointing at
      `milestone-add --replace`); `review` (pointing at `verify` /
      `milestone-complete` -- `review -> in_progress` exists only for failed
      verification, and a milestone awaiting verification does not grow);
      `completed`/`cancelled`; and no Change Log entry (the same
      `assertChangeLogEntry` discipline as `task-amend`). The write is
      journal-backed under the existing `task_amendment` operation type with
      `target` = the new task id (its `resolveTargetPath` already maps to
      `tasks.yaml`; no new operation type or schema change), materialized
      immediately, folded into the next checkpoint. Two stated consequences of
      that reuse, both intended and both tested: an open `milestone-review`
      session is staled (a real revision), and an active `auto-run`
      authorization is invalidated (`isAutoRunAuthorized` already treats any
      later `task_amendment` entry as invalidating -- an inserted task must
      re-prompt the developer). THE DISPATCH RULE, stated explicitly because it
      is the command's primary use: the pending entry makes `task-dispatch`
      refuse (its existing journal-pending-amendment gate, unchanged -- a
      worktree would branch from a HEAD that lacks the task) until the next
      checkpoint commit folds it, while inline `task-update <new> in_progress`
      is allowed immediately (its dirty-tree check already expects
      journal-materialized paths). Tested both ways: inline start succeeds right
      after `task-add`; `task-dispatch` refuses, then succeeds after a sibling's
      completion commit. Interaction with a LIVE worktree dispatch, stated and
      tested: `task-add` during a live dispatch is safe because `task-integrate`
      applies only the worker's own diff and refuses any `.pitway/` path
      (`integrate.ts`), so main's `tasks.yaml` -- the one `task-add` wrote --
      stays authoritative and the later integrate neither conflicts with nor
      loses the inserted task. `pitway resume` and `milestone-status` render
      correctly with the entry still pending (the new task appears; nothing
      dereferences the entry's target against an earlier checkpoint). The
      command registers through `registerAllCommands`;
      `tests/integration/cli.test.ts`'s registered-command list and test name
      move to 23 IN THIS TASK; a `commands/task-add.md` asset ships (assets 35
      -> 36) with shipped-and-installed assertions added to
      `tests/unit/claude-assets.test.ts` and `tests/integration/init.test.ts` IN
      THIS TASK."
  - id: AC003
    text: "The real binary never prints a raw stack trace for a PitWay refusal:
      `src/cli/index.ts`'s main-module block wraps `program.parseAsync` in a
      shared handler (`src/cli/errors.ts`, `renderCliError`) that prints
      `pitway: <message>` to stderr and exits 1 for PitWay's own error classes
      (`StateStoreError` and the Core `*Error` classes) -- the first shared CLI
      error-handling entry point (the M013 backlog item found none existed).
      Programming errors (anything else) still print the full stack -- the
      handler narrows, never swallows. Commander's own usage errors already exit
      through its own handler without a stack and are untouched. The
      missing-`.pitway/` case is actionable: `src/state/store.ts`'s `readText`
      preserves the underlying error as `cause` (ES2022 `Error` options; today
      it drops it), and the handler maps a `StateStoreError` whose cause is
      ENOENT on `.pitway/state.yaml` to: no `.pitway/` state here -- run `pitway
      init` in a repository root, or check out the branch that carries it (the
      `branch_strategy: milestone` case M012/T007 disclosed). In-process tests
      (which call `parseAsync` directly) are unaffected: the handler lives only
      in the bin entry block. Tests: `tests/unit/cli-errors.test.ts` covers the
      three branches (PitWay error -> message only; missing-state -> actionable
      message; non-PitWay error -> stack preserved); a real-subprocess test in
      `tests/integration/build-bin.test.ts` proves the friendly missing-state
      message and the no-stack refusal for an ordinary PitWay error."
  - id: AC004
    text: "Failed `command`-type verification evidence carries a structured failure
      summary: a pure `summarizeFailure(output, budget)` in
      `src/core/verification/failure-summary.ts` extracts up to five failure
      lines -- Vitest's `FAIL <file> > <name>` / `×` lines and
      `AssertionError:`/`Error:` first lines, with a runner-agnostic fallback of
      the first lines matching /\\b(FAIL|ERR|Error)\\b/ -- each line capped at
      200 chars and the whole summary capped at 40% of the evidence budget, so a
      single very long line can never consume the tail.
      `src/core/verification/run.ts` (milestone `verify`) and
      `src/core/tasks/verify.ts` (`task-verify`) prepend `failures: ...` to the
      tail-trimmed output ONLY when the run failed, inside the existing cap
      (summary budgeted first, `trimTail` gets the remainder -- one truncation
      scheme). Passing runs' evidence is byte-identical to today.
      `tests/integration/verification-repair.test.ts` -- which asserts
      failed-evidence content and was outside the original draft's scope
      (AC008's own pattern, caught by this milestone's review) -- is in T004's
      write_scope. Unit tests cover Vitest output, a generic runner, no-match
      fallback (evidence unchanged), per-line and total caps; integration tests
      prove a real failing check's recorded evidence names the failing test."
  - id: AC005
    text: "Completion-time usage honesty for worktree dispatches: `task-update <id>
      completed` for a task that has at least one `worktree_dispatch` journal
      record but receives no `--usage` emits a one-line stderr warning naming
      the task and that usage stays `null` -> `N/A` -- detection only, never
      estimation, never a refusal, never a new command (a post-completion
      `usage-correct` write would have no checkpoint to ride once the milestone
      completes). `--json` gains an additive `usageWarning: string | null` key
      (null otherwise). DISCLOSED SCOPE: detection covers `parallel_worktrees`
      dispatches only -- an inline sub-agent dispatch leaves no journal record,
      so PitWay cannot distinguish it from driver-executed work and emits no
      warning there; this is the same honesty boundary as every other
      inline-dispatch claim. Tests drive the REAL path (`task-dispatch` ->
      `task-integrate` -> complete): without `--usage` (warning), with `--usage`
      (none), and a never-dispatched task (none); `worktree_dispatch` records
      are sibling kinds never folded by checkpoints, so an intervening
      completion commit cannot hide one."
  - id: AC006
    text: "`.github/dependabot.yml` exists: weekly `npm` updates on `/`,
      `open-pull-requests-limit: 5`, dev-dependencies grouped into one PR,
      explicitly no auto-merge configuration anywhere. A short `README.md`
      'Maintenance' note states dependency updates arrive as Dependabot PRs and
      that Dependabot security alerts must be enabled in repository settings (a
      setting, not a file -- stated as such, never claimed as done). Verified by
      a review check; no automated test owns it."
  - id: AC007
    text: "Load-sensitive integration tests no longer run on Vitest's default
      budgets: a new `vitest.config.ts` sets `testTimeout: 60000` AND
      `hookTimeout: 60000` (beforeEach/afterEach create real git repos and
      worktrees -- the same load-sensitive work), with a comment carrying
      M016/T001's root-cause evidence; `package.json`'s `vitest run` loads it
      without flags. The per-file 60000ms in
      `completed-task-revision-path.test.ts` is removed so there is one
      authoritative value. Because the flake is load-dependent and
      nondeterministic, a passing run of the affected files proves nothing by
      itself -- so `tests/unit/vitest-config.test.ts` asserts the config exports
      both timeouts at 60000 with the root-cause comment present, and that
      `completed-task-revision-path.test.ts` carries no per-test timeout
      argument; CT007 runs that unit test together with the six
      previously-affected integration files. A timeout is a ceiling, not a wait:
      the full-suite gate (AC009) confirms no test was slowed. The transient
      `npm-pack.test.ts` failure M016/T001 saw once is NOT claimed fixed
      (different failure, observed once, not reproduced). T007 runs INLINE,
      second, before any parallel dispatch (decision 6)."
  - id: AC008
    text: "Two driver-protocol doc additions close the remaining non-code backlog
      items, with no workflow semantics changed: (1) `protocol-driver.md` gains
      a 'Drafting write_scope' rule -- before finalizing any task that changes a
      count or an enumerated list (commands, assets, baseline/completion paths,
      schema enums) OR the shape of a persisted/rendered string, grep `tests/`
      for the assertions that pin it (`cli.test.ts`'s registered-command list,
      `git-baseline.test.ts`, `claude-assets.test.ts`/`init.test.ts`,
      `milestone-complete`'s `completionPaths`, and any test asserting the
      string's content) and include every hit in that task's `write_scope` from
      the start -- the systemic answer to the gap that recurred in M012/T005,
      M013/T008, M014/T011, M015/T008, and again in this milestone's own first
      draft (T004); and (2) the confirmed-milestone boundary is documented as a
      decision, not a gap: `commands/milestone-cancel.md` and
      `protocol-driver.md`'s 'Choosing a correction mechanism' state that
      cancellation is draft-only by design (a confirmed milestone has a baseline
      commit in history; the milestone state machine is deliberately unchanged
      -- no `in_progress -> cancelled`), that post-confirm task insertion is
      `task-add` (AC002, including its dispatch rule), and that a confirmed
      milestone's remaining work is abandoned by cancelling its remaining tasks
      and completing it, or left in history -- never a `git reset`. Verified by
      a review check against actual command behavior."
  - id: AC009
    text: "`IMPLEMENTATION_PLAN.md` is reconciled: the revision header gains a dated
      entry; SS7's command list/count moves to 23 with a `task-add` row; SS9's
      asset count moves to 36 with an M017-additions bullet; the Backlog section
      marks every item this milestone delivers DELIVERED with the disclosed
      direction chosen (usage warning not command, and parallel-dispatch-only;
      `task-add` yes with its dispatch rule, confirmed-cancel no; global
      test+hook timeout; the `npm-pack` transient left open) and keeps any entry
      this milestone did not fully close honest; the Bootstrap table leaves
      M017's own row for the next reconciliation; the Status snapshot is
      updated. T009's own verification is the CT009 review of the document; the
      milestone-level gates (full `npm test`, `npx tsc --noEmit`) run exactly
      once, as CT010/CT011 at `verify` time, never additionally as a task
      check."
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npm test -- tests/integration/milestone-confirm.test.ts
  - id: CT002
    criterion: AC002
    type: command
    command: npm test -- tests/integration/task-add.test.ts
      tests/integration/cli.test.ts tests/unit/claude-assets.test.ts
      tests/integration/init.test.ts
  - id: CT003
    criterion: AC003
    type: command
    command: npm test -- tests/unit/cli-errors.test.ts
      tests/integration/build-bin.test.ts
    timeout_ms: 300000
  - id: CT004
    criterion: AC004
    type: command
    command: npm test -- tests/unit/failure-summary.test.ts
      tests/integration/verify.test.ts tests/integration/task-verify.test.ts
      tests/integration/verification-repair.test.ts
  - id: CT005
    criterion: AC005
    type: command
    command: npm test -- tests/integration/task-update.test.ts
  - id: CT006
    criterion: AC006
    type: review
    instruction: Read .github/dependabot.yml and the README Maintenance note against
      AC006 -- weekly npm schedule, PR limit 5, grouped dev-dependencies, no
      auto-merge anywhere, and the security-alerts sentence phrased as a
      repository setting to enable, never as done.
  - id: CT007
    criterion: AC007
    type: command
    command: npm test -- tests/unit/vitest-config.test.ts
      tests/integration/milestone-complete.test.ts
      tests/integration/verification-repair.test.ts
      tests/integration/execution-strategy.test.ts
      tests/integration/review-state-lifecycle.test.ts
      tests/integration/branch-isolation-lifecycle.test.ts
      tests/integration/completed-task-revision-path.test.ts
    timeout_ms: 600000
  - id: CT008
    criterion: AC008
    type: review
    instruction: Read protocol-driver.md's new 'Drafting write_scope' rule and the
      confirmed-milestone-boundary text in protocol-driver.md and
      commands/milestone-cancel.md against AC008 -- confirm the named assertion
      sites are listed (including string-content assertions), the boundary
      matches milestone-cancel's actual draft-only behavior and the unchanged
      state machine, task-add and its dispatch rule are named as the insertion
      path, and git reset is named as never the path.
  - id: CT009
    criterion: AC009
    type: review
    instruction: Diff IMPLEMENTATION_PLAN.md against AC009's edit list -- header
      entry, SS7 23 + task-add row, SS9 36 + M017 bullet, every delivered
      Backlog entry marked with its chosen direction and the npm-pack transient
      left open, M017's own Bootstrap row absent, Status snapshot updated --
      each edit actually present.
  - id: CT010
    criterion: AC009
    type: command
    command: npm test
    timeout_ms: 900000
  - id: CT011
    criterion: AC009
    type: command
    command: npx tsc --noEmit
    timeout_ms: 300000
---

# M017 — Backlog Closure and Lifecycle Hardening

## Objective

Close every open item in `IMPLEMENTATION_PLAN.md`'s Backlog / Pending
Candidates section as of the post-M016 reconciliation (`3f774bf`): the two
lifecycle gaps M016 found live (`milestone-confirm` never reconciling
pending journal entries; no sanctioned post-confirm task insertion), the
raw-stack-trace CLI failure mode and missing-state diagnostic, structured
failure evidence, completion-time usage honesty, Dependabot, the
load-sensitive test timeouts, and the recurring write_scope drafting gap
— each with the smallest defensible design, every design choice disclosed
below for approval.

## Design decisions (binding for this milestone)

1. **T001 runs inline and first — deliberately.** This milestone's own
   pre-confirmation `milestone-review` leaves `review_recording` journal
   entries pending, which is exactly backlog item #6: under the current
   code they would block every `task-dispatch` after confirm. Inline
   `task-update <id> in_progress` is NOT blocked by them (verified: its
   dirty-tree check only *allows* journal-materialized paths; only
   `task-dispatch` refuses on pending entries), so T001 starts inline,
   fixes the bug, and T001's own completion commit (whose path already
   calls `reconcilePending`) clears the entries — the milestone's first
   task repairs the defect its own review exposes. Disclosed as dogfood,
   not worked around.
2. **Post-confirm insertion yes, post-confirm cancellation no.** `task-add`
   is built (AC002). Cancelling a confirmed/in_progress milestone is NOT
   built: the milestone state machine stays exactly as documented
   (`draft|confirmed -> cancelled` only; nothing from `in_progress`),
   because a confirmed milestone already has a baseline commit in history
   and "undoing" it is a history rewrite PitWay never performs. The
   boundary is documented as a decision (AC008). **CLAUDE.md's
   milestone-state list is unchanged; extending it would be a separate,
   explicitly approved architecture change.**
3. **`task-add` reuses the `task_amendment` journal operation type** — its
   target is `tasks.yaml`, which `resolveTargetPath` already maps, so
   every dirty-tree check and the baseline/completion allowlists expect the
   write with zero call-site changes; its two existing consumers
   (`auto-run` invalidation; `task-amend`'s per-target pending-chain lookup,
   keyed by a task id no existing task shares) behave correctly and
   intentionally for an insertion. The consequence is the dispatch rule
   AC002 states: inline start immediately, worktree dispatch after the next
   checkpoint — pre-existing `task-amend` semantics, now documented because
   `task-add` makes them the primary path.
4. **Usage correction is detection, not a command, and parallel-only.**
   A completion-time warning when a worktree-dispatched task completes
   without `--usage` (AC005). Inline sub-agent dispatches leave no journal
   record and are disclosed as undetectable. A post-completion
   `usage-correct` write was rejected: once the milestone completes there
   is no checkpoint for it to ride — the dangling-state class M015/AC008
   exists to prevent. Usage is never estimated (decision 8 unchanged).
5. **Failure summaries are prepended, budgeted, capped, and fail-only.**
   Passing evidence is byte-identical to today; `trimTail` stays the one
   truncation scheme (AC004). Vitest patterns plus a generic fallback —
   runner-specific parsing beyond Vitest is explicitly not attempted.
6. **T007 runs inline, second, before any parallel dispatch** — the global
   timeout must exist on the integration branch before parallel worktrees
   run their verifications concurrently, or the batch reproduces the very
   load condition the fix targets (both reviewers, independently). One
   global `testTimeout` + `hookTimeout`, M016/T001's per-file value removed
   so there is one source. A timeout is a ceiling: a fast test is not
   slowed by it.
7. **The CLI error handler narrows to PitWay's own error classes** (AC003).
   Programming errors keep their stack traces. It lives only in the bin
   entry block, so every in-process test path is unchanged. `store.ts`
   preserves the underlying `cause` so the missing-state case is detected
   structurally, never by message sniffing.
8. **No backlog item is partially closed silently.** The `npm-pack`
   transient (observed once, not reproduced) stays open by name (AC007,
   AC009).

## Scope boundaries

- No milestone state-machine change (decision 2).
- No new journal operation type or schema change (decision 3).
- No usage estimation or new usage command (decision 4).
- No runner-specific failure parsing beyond Vitest's own line shapes.
- No change to `branch_strategy`/`execution.strategy` config on `main`.
- No per-file timeout edits beyond removing M016/T001's now-redundant one.

## Change Log

- 2026-08-21 — Initial draft from the Backlog / Pending Candidates section
  as reconciled after M016's merge, per the developer's request to close
  every open backlog item in one milestone.
- 2026-08-21 — Revised before confirmation, folding in the first real
  two-role `pitway milestone-review` run (session `rev-0e694bef5884`, QA +
  architect, 16 findings, decided `revision_requested`): AC002 now states
  and tests the post-`task-add` dispatch rule (inline start immediately,
  `task-dispatch` after the next checkpoint), the `review`-state and
  cancelled-dependency refusals, the live-worktree interaction (safe
  because `task-integrate` refuses `.pitway/` paths), the intended
  `auto-run` invalidation, zod-error wrapping, and the corrected asset
  count (35 -> 36); T007 moves to inline-second with `hookTimeout` added
  and a unit test that can actually observe the config (CT007 previously
  passed regardless); T005's write_scope gains `store.ts` (it must
  preserve `cause`) and a unit test for the programming-error branch;
  T004's write_scope gains `verification-repair.test.ts` (asserts
  failed-evidence content — AC008's own gap, caught here) and the summary
  gains per-line/total caps; AC005 discloses parallel-dispatch-only
  detection and tests the real dispatch path; AC001 states why `--amend`
  is not a reconcile site; T009's own verification becomes the CT009
  review so the full-suite gate runs exactly once; decision 1 now states
  explicitly that inline start ignores pending entries.
