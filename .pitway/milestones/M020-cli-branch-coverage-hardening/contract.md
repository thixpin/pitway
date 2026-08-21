---
schema_version: 1
id: M020
title: CLI Branch Coverage Hardening
status: completed
requirement: null
confirmed_at: 2026-08-21T18:27:08Z
verification_approved_hash: sha256:3aeaad46f4630a10566bf419c1a524ef383b25a22752fa7838cac60d816c604a
base_branch: main
base_revision: 3a297d9c918fe08ee3d40c6b88ba92e9e4d0a36b
acceptance_criteria:
  - id: AC001
    text: "Metric definition (closes the ambiguity that caused B004's original
      local-vs-Codecov discrepancy report): the target metric is **branch
      coverage per file**, computed via `vitest run --coverage` (V8 provider,
      already configured in vitest.config.ts) and read from coverage/lcov.info's
      BRDA records — the same metric Codecov reports, not the text-reporter's
      headline line-coverage number. Baseline recorded 2026-08-22 from a real
      coverage run: milestone-review.ts 17/45 (37.8%), task-verify.ts 10/21
      (47.6%), task-integrate.ts 4/8 (50.0%), verification-repair.ts 6/13
      (46.2%), cli/index.ts 4/10 (40.0%). Verified manually: each file's
      before/after branch numbers (hit/total from a real `vitest run --coverage`
      run) are recorded as completion evidence — not an automated
      coverage-threshold command check, since a full-suite --coverage run is
      slow and has shown transient contention-driven timeouts under load
      (observed in M019/T002)."
  - id: AC002
    text: src/cli/commands/milestone-review.ts reaches >=90% branch coverage
      (>=41/45). New tests target real behavioral gaps only — the bulk of the
      current gap is in renderReportHuman's rendering permutations (pending vs.
      recorded role, superseded-snapshot count, zero-findings "clean review"
      case, a finding's targets/unknownTargets/conflictsWith
      presence-or-absence, non-empty sharedTargetConflicts, non-empty
      declaredConflicts), plus the `start` command's non-TTY-without-roles
      refusal branch and `decide`'s revision_requested vs. other-outcome branch
      in renderDecideHuman. Never superficial line-padding, never a
      coverage-config change to hide an uncovered branch.
  - id: AC003
    text: src/cli/commands/task-verify.ts reaches >=90% branch coverage (>=19/21)
      via real behavioral tests (validation failures, state-transition refusals,
      subprocess/command-execution failure paths).
  - id: AC004
    text: "src/cli/commands/task-integrate.ts reaches 8/8 (100%) branch coverage via
      real behavioral tests. Given only 8 total branches, a generic '>=90%'
      threshold is unsatisfiable (7/8 = 87.5%) alongside any
      disclosed-unreachable exception, so this AC uses a precise fraction
      instead: if a specific branch is provably unreachable in-process (e.g.
      gated on a real filesystem/subprocess condition no unit test can
      construct), that named disclosure in the task's completion evidence -- not
      a percentage -- is the pass condition for AC004, and the remaining 7
      branches must still all be covered. Never a silent gap and never a
      config-exclusion workaround."
  - id: AC005
    text: src/cli/commands/verification-repair.ts reaches >=90% branch coverage
      (>=12/13) via real behavioral tests (recovery/repair-path branches,
      validation and state-transition failures).
  - id: AC006
    text: "cli/index.ts decision (presented for explicit developer approval at
      confirm time, not decided unilaterally): the untested branches sit
      entirely inside the real-binary error boundary already established as
      deliberately subprocess-only tested (M017/T005/AC003 — in-process tests
      never reach it, since it's gated on process.argv[1] matching
      realpathSync(import.meta.url), the M008/T002 symlink-safety invariant).
      Extracting a separately in-process-testable runCli() would relocate, not
      eliminate, that same real-subprocess dependency for the isMainModule gate
      itself, so it is not undertaken here. Instead, the one concrete known gap
      is closed directly: both existing build-bin.test.ts error-boundary tests
      assert NO stack trace prints (the isPitwayError path); renderCliError's
      other branch — an unexpected/builtin-Error bug, where printStack is true
      and the stack DOES print — has no real-subprocess test at all. A new test
      in build-bin.test.ts's \"CLI error boundary (real subprocess)\" describe
      block triggers a genuine non-PitWay error (e.g. malformed
      .pitway/state.yaml causing a YAML parse error) and asserts the stack trace
      is present in stderr. This is the recommended default; the alternative
      (extract-and-refactor for full in-process testability) is named here so
      the developer can choose it instead at confirm time."
  - id: AC007
    text: "IMPLEMENTATION_PLAN.md is reconciled against the real repository state on
      main: M019's own Bootstrap-table catch-up (left open at M019 completion
      for whichever milestone reconciles next), the Revised Roadmap
      header/M019-delivered wording, the two post-M019 quick-changes documented
      per the established post-M016 precedent (qc-7e6fb2a4 ms-merge alias,
      qc-404ee3e9 report table-format alignment), the now-false \"7 ms-*
      aliases\" count/note corrected to 8 everywhere it appears (including any
      note that milestone-merge was deliberately excluded — that was true at
      M019 confirm time, false since qc-7e6fb2a4), and the shipped Claude asset
      count corrected for ms-merge.md (45 -> 46)."
  - id: AC008
    text: "Backlog lifecycle closure, run post-confirm: `backlog promote B004 --task
      <primary implementing task id>` (B004 maps to this milestone's T001-T005;
      promoted against T001, the highest-priority file per B004's own stated
      priority order, with the one-to-many mapping disclosed in the promote's
      evidence/commit) and `backlog archive B005 --reason \"resolved via
      quick-change qc-404ee3e9 (commit 3a297d9), not promoted into a milestone
      task\"` — B005 could not be archived immediately after its quick-change
      landed because every backlog subcommand, including archive,
      unconditionally requires state.active_milestone to be non-null (a real,
      disclosed M018 design limitation with no override flag on any subcommand);
      this milestone's own active state is what makes the deferred archive
      possible."
  - id: AC009
    text: A new backlog item is added recording the archive-requires-active-
      milestone limitation as a genuine, twice-recurred dogfood finding (once
      after M018 completed, once after M019/qc-404ee3e9) — evaluate whether an
      --allow-no-active-milestone-style override (or equivalent) is warranted
      for archive specifically, without weakening the add/list/show/promote
      requirement. Investigation only in this milestone; not implemented here.
  - id: AC010
    text: The full test suite and `tsc --noEmit` stay green throughout -- raising
      branch coverage introduces no regression.
verification:
  - id: CT001
    criterion: AC001
    type: manual
    instruction: Record before/after branch coverage numbers for all 5 target files,
      from a real `vitest run --coverage` run, as completion evidence.
  - id: CT002
    criterion: AC002
    type: command
    command: npx vitest run tests/integration/milestone-review-brief.test.ts
      tests/integration/milestone-review-decide.test.ts
      tests/integration/milestone-review-interactive.test.ts
      tests/integration/milestone-review-lifecycle.test.ts
      tests/integration/milestone-review-record.test.ts
      tests/integration/milestone-review-report.test.ts
      tests/integration/milestone-review-start.test.ts
  - id: CT003
    criterion: AC003
    type: command
    command: npx vitest run tests/integration/task-verify.test.ts
  - id: CT004
    criterion: AC004
    type: command
    command: npx vitest run tests/integration/task-integrate.test.ts
      tests/integration/task-integrate-recovery.test.ts
  - id: CT005
    criterion: AC005
    type: command
    command: npx vitest run tests/integration/verification-repair.test.ts
  - id: CT006
    criterion: AC006
    type: command
    command: npx vitest run tests/integration/build-bin.test.ts
  - id: CT007
    criterion: AC007
    type: manual
    instruction: Review the IMPLEMENTATION_PLAN.md diff against real repository
      state (git log, .pitway/state.yaml, backlog.yaml) for accuracy.
  - id: CT008
    criterion: AC008
    type: manual
    instruction: Run backlog promote B004 --task T001 and backlog archive B005;
      confirm final state via `pitway backlog list`.
  - id: CT009
    criterion: AC009
    type: manual
    instruction: Confirm the new backlog item is present via `pitway backlog list`.
  - id: CT010
    criterion: AC010
    type: command
    command: npm run build && npm test && npx tsc --noEmit
---

# M020: CLI Branch Coverage Hardening

## Background

B004 (backlog item, filed post-M018) reported a discrepancy between Codecov's
reported coverage for several CLI command files and local Vitest V8 numbers.
Investigation (pre-contract, this session) found the discrepancy is a metric
artifact, not a config bug: Vitest's default text-reporter headline is line
coverage; Codecov reports branch coverage, which is meaningfully lower for
these conditional-heavy CLI render/dispatch functions. `coverage/lcov.info`
already carries real per-branch BRDA data (V8 provider, `vitest.config.ts`);
this milestone targets that number directly, file by file, in the priority
order B004 itself specified: milestone-review > task-verify > task-integrate
> verification-repair > cli/index.

B005 has already been resolved via a prior quick-change (qc-404ee3e9) — the
surviving backlog-side work here is the formal `promote`/`archive`
bookkeeping, which requires an active milestone and could not run standalone.

## Design Decisions

- **Metric, not just a number.** AC001 pins branch coverage (not line) as the
  target metric and records real baseline numbers up front — the same
  discipline that would have prevented B004's original ambiguity.
- **Verification is manual for the coverage threshold itself.** A `command`
  check that asserts an exact coverage percentage over the whole file would
  be brittle and slow (a full `--coverage` run has shown transient
  timeout-under-load behavior — M019/T002). Each file's targeted test suite
  is a `command` check (fast, deterministic); the coverage number itself is
  `manual`, evidenced by a real coverage run's output.
- **cli/index.ts: disclosed decision, not a silent refactor.** AC006 lays out
  both options — closing the one concrete gap with a subprocess test
  (recommended), or extracting a separately-testable `runCli()` — for
  explicit confirm-time approval, per the standing rule that scope-shaping
  decisions are the developer's, not assumed.
- **B004 promotes against one task, not five.** `backlog promote` accepts a
  single task id; the one-to-many mapping (B004 -> T001-T005) is disclosed
  rather than forced into an artificial 1:1 shape.

## Change Log

- 2026-08-22: Initial draft.
- 2026-08-22: Revision per milestone-review (session rev-15904c51c1d4,
  developer+architect, revision_requested): AC004 reworded to a precise
  8/8-unless-disclosed fraction instead of an unsatisfiable ">=90% of 8"
  threshold; T005's write_scope gained src/cli/index.ts to cover AC006's
  extract-and-refactor alternative; T006's write_scope gained
  .pitway/backlog.yaml to cover its own backlog promote/archive/add calls.
