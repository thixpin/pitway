---
schema_version: 1
id: M013
title: PitWay Driver UX
status: in_progress
requirement: null
confirmed_at: 2026-08-20T09:57:27Z
verification_approved_hash: sha256:730af41bb249e728b30a8fe96bc7340ac07d085e18a8183238a951385866307c
base_branch: null
base_revision: null
acceptance_criteria:
  - id: AC001
    text: "`taskSchema` (`src/state/schemas.ts`) gains an additive-optional `name:
      z.string().min(1).max(80)` field, mirroring the shape
      `contractFrontmatterSchema.title` already uses for milestones but capped
      to stay a short label rather than a second `objective`. Absent on every
      task written before this milestone (M001-M012's own `tasks.yaml` files
      included) and remains fully optional going forward -- no historical
      `tasks.yaml` requires migration or re-validation. A focused unit test
      loads a pre-existing `tasks.yaml` fixture with no `name` field on any task
      and confirms it still parses unchanged; a second test round-trips a task
      with `name` set through save/load."
  - id: AC002
    text: "`pitway resume`'s task list (`buildResumeView`/`renderResumeHuman`,
      `src/cli/commands/resume.ts`) and `pitway task-status <id>`
      (`src/cli/commands/task-status.ts`) render a task's `name` when present,
      falling back to the bare id when absent. Human rendering:
      `  <id>  <name>  <status-label>` when `name` is set; unchanged
      `  <id>  <status-label>` when absent -- byte-identical to today's output
      for every task without a `name`, including every task from every
      already-completed milestone. `--json` output adds `name: string | null`
      (the key is always present, never omitted) to both `resume`'s per-task
      list entries and `task-status`'s view."
  - id: AC003
    text: "A new, pure, exported Core function (`src/core/milestones/ workload.ts`,
      e.g. `computeWorkloadPercentage(status: MilestoneStatus, progress:
      MilestoneProgress, verificationPassed: boolean): number`) implements, as
      real tested code, the five-band cumulative formula already in live use as
      an informal driver convention (see `IMPLEMENTATION_PLAN.md`'s own decision
      5 and this project's add-style-progress-reporting driver habit): drafting
      contributes 5% once a draft exists (`status !== 'draft'` or the function
      is only ever called once a draft is materialized -- pre-draft is out of
      scope, there is no milestone to report on); confirmation contributes a
      further 5% (10% cumulative) once `status` is `confirmed` or later;
      weighted task execution contributes up to a further 75% (85% cumulative),
      scaled by `progress.completed / progress.total` (0 when `total` is 0);
      final verification contributes a further 10% (95% cumulative) once
      `verificationPassed` is `true`; completion contributes a final 5% (100%,
      and *only* exactly 100%) once `status` is `completed`. The result is
      rounded to the nearest integer for display. `status: completed`
      short-circuits to exactly 100 unconditionally, regardless of
      `verificationPassed` -- `milestone-complete`'s own existing gate already
      guarantees verification passed before `status` can ever become
      `completed`, so the two never actually diverge in practice, and this
      short-circuit defensively ensures a stale or inconsistent
      `verificationPassed` argument can never render an already-`completed`
      milestone as anything other than its own real terminal state. Tests prove:
      a freshly drafted milestone (`status: draft`, 0/N progress) returns
      exactly 5; a confirmed milestone with 0/N progress returns exactly 10; a
      confirmed milestone with all required tasks completed but
      `verificationPassed: false` returns exactly 85; the same milestone with
      `verificationPassed: true` returns exactly 95; a milestone whose `status`
      is actually `completed` returns exactly 100 even when `verificationPassed:
      false` is passed in, and no non-`completed` status/input combination
      yields 100. This function takes `verificationPassed` as a plain boolean
      input -- it does not itself read `verification-results.yaml` or any other
      state; callers derive that boolean via AC008's shared verification-status
      helper."
  - id: AC004
    text: "A new Core function (`src/core/milestones/footer.ts`, e.g.
      `computeRacingFooter(...)`) renders the exact one-line racing footer
      already in live use as an informal driver-session convention: `🏎️
      ~<workload>% · ✅ <completed>/<total> · Next: <task/gate>`, where
      `<workload>%` is AC003's rounded value, `<completed>/<total>` is the
      existing exact required-task count (`computeMilestoneProgress`, unchanged,
      never re-derived), and `<task/gate>` is the next dependency-ready task id,
      or the next gate (verification, developer approval) when no task is ready
      -- reusing one shared next-task/gate resolution helper, extracted from
      `resume.ts`'s existing private logic into an exported function so `resume`
      and `milestone-status` never duplicate this derivation. Returns `null`
      (not a placeholder string) when `status` is `draft` -- silence is the
      signal; no footer text is shown before `milestone-confirm` has run,
      matching the already-corrected driver convention. Icon precedence,
      evaluated in this order: `🏁` when `status` is `completed`, with the
      trailing segment reading literally `Complete` instead of `Next: ...` (`🏁
      100% · ✅ <total>/<total> · Complete`); otherwise `🔧` when at least one
      task's `status` is `blocked`; otherwise `🏁` when every required task is
      `completed` but the milestone itself is not yet `completed` (only final
      verification/completion remains) -- the same leading icon as the
      `completed` case above, the two are distinguished only by the trailing
      `Complete` vs. `Next: <task/gate>` text, never by the icon; otherwise
      `🏎️` as the default running case. Wired into `pitway resume` and `pitway
      milestone-status <id>` (both human and `--json` output) as a `footer:
      string | null` field on each view, rendered as the literal final line of
      human output when non-null and simply absent from the text (not blank, not
      a placeholder comment) when null."
  - id: AC005
    text: "`pitway milestone-status <id>` gains a `--report` flag rendering an
      on-demand, fully structured Progress Report -- extending the existing
      command rather than adding a new one, reusing data this milestone's other
      tasks already compute (no new authoritative data source). In order: (1)
      the milestone title; (2) AC003's workload percentage plus the
      authoritative `completed/total` required-task count; (3) the recorded
      token total and the missing-usage count (how many tasks/categories carry
      `usage: null`, counted honestly, never estimated -- reusing the existing
      `aggregateUsage`/`UsageAggregate` shape unchanged); (4) a task table: id;
      a label -- `name` when present (AC001/AC002), else the task's own
      `objective` truncated to 60 characters with a trailing ellipsis when cut
      (never the bare id alone, which the original candidate's own
      concise-objective column already ruled out as insufficient; every task
      from every milestone before this one, and every one of this milestone's
      own tasks per the disclosed AC001 bootstrap gap, falls back to the
      truncated-objective form, not a blank label); execution mode when recorded
      (inline vs. dispatched, per the existing M007 dispatch-mode convention --
      blank when not recorded, no new schema); truthful state/evidence status
      per AC007's evidence-honesty rule; runtime-reported task tokens, or `N/A`
      when not reported; (5) AC006's critical path; (6) the active in-progress
      task (if any) and the next dependency-ready task; (7) a token breakdown
      limited to the categories this project's own Token Telemetry Spike design
      record (`docs/evidence/M009/token-accounting-feasibility.md`) confirms are
      directly measured today -- task-work total (sum of per-task `usage`),
      `planning`, `qa`, grand total, and the missing-usage count -- with no
      `driver_overhead`/orchestration-overhead line, since that feasibility
      document explicitly flags orchestration overhead as not directly reported
      by the runtime, only derivable, and requires the (not-yet-run) Token
      Telemetry Spike's own E2/E3 experiments before any such figure can be
      shown without misrepresenting it as measured; (8) AC004's racing footer as
      the final line. `--report` composes with `--json` the same way the
      command's existing default view does (a structured object when `--json` is
      passed, the rendered text otherwise)."
  - id: AC006
    text: "A new, pure, exported Core function (e.g.
      `src/core/tasks/critical-path.ts`, `computeCriticalPath(tasks: Task[]):
      string[]`) computes the critical path -- the longest chain of
      not-yet-completed, not-cancelled tasks connected by `depends_on` --
      deterministically: ties broken by ascending task id. Returns an empty
      array when every required task is already completed. Reuses the existing
      cycle/unknown-reference validation already performed elsewhere
      (`src/core/tasks/dependencies.ts`) rather than re-validating the graph a
      second time -- this function assumes a graph already proven acyclic by the
      time it runs (the same guarantee `resolveReadyTasks` already relies on). A
      focused unit test builds a small fixture DAG with a known longest chain
      and asserts the exact returned id sequence; a second test confirms a
      milestone with zero remaining tasks returns `[]`."
  - id: AC007
    text: The Progress Report's task table (AC005) labels a task `completed ·
      verified` only when a real `task_verify_evidence` journal record (M010's
      own mechanism, `appendTaskVerifyEvidenceRecord`/ `readJournal`,
      `src/state/journal.ts`) exists for that exact milestone+task and its
      captured `evidence` text matches the task's currently persisted
      `result.evidence` -- there is no field on the task record itself
      distinguishing a verify-backed completion from a plain one; provenance
      lives only in the append-only journal, so this AC reads it the same way
      `resolveTaskVerifyEvidence` (`src/core/tasks/ update.ts`) already does,
      via a new small exported helper rather than a second, divergent
      journal-scanning implementation. A historical completed task with no
      matching journal record -- everything completed before M010 shipped, or
      any task that used the plain `--result`/ `--message` path -- is labeled
      plainly `completed`, never upgraded to `verified` on the strength of an
      unverified claim. Every non-completed status renders via the existing
      `taskStatusLabel` helper (`src/cli/format.ts`), unchanged, with no new
      label vocabulary invented for this report.
  - id: AC008
    text: "`pitway verify <id>` gains a `--status` flag rendering the latest
      recorded result per declared check, purely by reading
      `verification-results.yaml` -- it never executes a command, and never
      re-derives from scratch what a prior `pitway verify --check ... --pass|
      --fail` recording already established. The per-check latest-result
      derivation currently private inside `src/core/milestones/complete.ts`'s
      `assertGatesSatisfied` is extracted into one small, shared, exported Core
      function (e.g. `src/core/verification/status.ts`,
      `computeLatestCheckResults(root, milestoneId, contract): Map<checkId,
      'pass' | 'fail'>`) that `complete.ts` is refactored to call instead of its
      own private copy -- zero behavior change to `milestone-complete`'s own
      gating, proven by the existing `milestone-complete` test suite passing
      unchanged. `--status` output lists every declared check with its latest
      recorded status (`✅ pass` / `❌ fail`) or `⏳ pending` when no result has
      been recorded yet for it; it is available regardless of the milestone's
      current `status` (draft through completed) and never mutates
      `verification-results.yaml`. This same shared helper is what AC003's
      callers and AC004/AC005's footer/report use to derive `verificationPassed`
      -- one authoritative implementation, not reimplemented per call site."
  - id: AC009
    text: "`protocol-driver.md` gains a new section documenting: the ADD-style
      concise routine-update convention already in informal, live use this
      session (resumed/current task, current action, exact milestone progress,
      next dependency-ready task, a completion/blocker statement, capped to 2
      short paragraphs or 3 bullets, expanding only for a blocker/gate/failed
      verification/scope conflict/final report) as PitWay's documented
      driver-session convention, not merely a chat habit; that every routine
      update ends with AC004's racing footer once (and only once) the milestone
      has been confirmed, with no footer and no footer-explanation text before
      that point; and the two new read-only surfaces this milestone adds,
      `pitway verify <id> --status` and `pitway milestone-status <id> --report`,
      each with a one-line description of what it renders. This section
      explicitly discloses, the same way `required_skills`' own documentation
      discloses installed- but-unverified presence, that PitWay itself has no
      mechanism to prove a driver session actually appends the footer or keeps
      updates terse -- only that the underlying data/rendering exists and is
      correct when invoked; the habit itself is a driver-session convention, not
      something this milestone's own tests can verify. Confirm no file outside
      this task's own declared `write_scope` is touched to satisfy this AC."
  - id: AC010
    text: "`IMPLEMENTATION_PLAN.md` is reconciled to this milestone's actual
      delivered scope: the revision header gains a new dated entry; §7's
      command-surface sentence and table are updated (still eighteen commands --
      `verify` and `milestone-status` each gain a flag, no new command); §9's
      Claude-asset count is updated if `protocol-driver.md`'s insertion changes
      the count basis (it does not add a new file, only content to an existing
      one -- confirm and state this explicitly rather than silently reusing the
      prior count); the Bootstrap delivery table gains M012's row (left open by
      M012/T009's own self-referential discipline); the Revised Roadmap's M013
      entry is rewritten from its current not-yet-drafted placeholder to
      describe actual delivery, including the explicit, disclosed deviation from
      the original driver-UX candidate's four-dimension token-breakdown wording
      (AC005's reasoning restated briefly, pointing at the fuller reasoning in
      AC005 itself); the Status paragraph is updated. The `Backlog / Pending
      Candidates` section's `Task human-readable name field` entry is updated to
      record it as delivered by this milestone (AC001/AC002) rather than left as
      an open, unscheduled candidate -- the first real exercise of that
      section's own \"stays here until scheduled or retired\" rule. This is also
      the milestone's own full-suite/typecheck regression gate -- `npm test` and
      `tsc --noEmit` both run exactly once, as this AC's own command-type check,
      never ad hoc per task (per the already-installed `protocol-driver.md`
      \"Verification discipline\" section from M012)."
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npm test -- tests/unit/schemas.test.ts
  - id: CT002
    criterion: AC002
    type: command
    command: npm test -- tests/integration/resume.test.ts
      tests/integration/task-status.test.ts
  - id: CT003
    criterion: AC003
    type: command
    command: npm test -- tests/unit/workload.test.ts
  - id: CT004
    criterion: AC008
    type: command
    command: npm test -- tests/unit/verification-status.test.ts
      tests/integration/milestone-complete.test.ts
      tests/integration/verify.test.ts
  - id: CT005
    criterion: AC006
    type: command
    command: npm test -- tests/unit/critical-path.test.ts
  - id: CT006
    criterion: AC004
    type: command
    command: npm test -- tests/unit/footer.test.ts tests/integration/resume.test.ts
      tests/integration/milestone-status.test.ts
  - id: CT007
    criterion: AC005
    type: command
    command: npm test -- tests/integration/milestone-status.test.ts
  - id: CT008
    criterion: AC007
    type: command
    command: npm test -- tests/integration/milestone-status.test.ts
  - id: CT009
    criterion: AC010
    type: command
    command: npm test
  - id: CT010
    criterion: AC010
    type: command
    command: npx tsc --noEmit
  - id: CT011
    criterion: AC009
    type: manual
    instruction: Confirm protocol-driver.md's new section documents the ADD-style
      routine-update convention, the footer-after-confirmation-only rule, and
      both new --status/--report flags; confirm it explicitly discloses that
      PitWay cannot verify a driver session actually follows the habit; confirm
      only this task's own declared write_scope was touched.
  - id: CT012
    criterion: AC010
    type: manual
    instruction: Confirm IMPLEMENTATION_PLAN.md's revision header, §7, the Bootstrap
      delivery table, the Revised Roadmap's M013 entry, the Status paragraph,
      and the Backlog section's task-name-field entry all reflect this
      milestone's actual delivered scope, including the disclosed
      driver_overhead omission.
  - id: CT013
    criterion: AC004
    type: review
    instruction: Confirm the footer's icon precedence (completed > blocked >
      verification-only-remains > running) is evaluated in exactly that order
      and that draft-status milestones return null, never a placeholder string.
  - id: CT014
    criterion: AC005
    type: review
    instruction: Confirm the Progress Report's token breakdown shows only
      directly-measured categories (task/planning/qa/total/missing) and never a
      fabricated driver_overhead figure.
---

# Contract — M013: PitWay Driver UX

## Objective

Build, for real and tested, the "PitWay Driver UX" scope this project's own roadmap has
carried as a session-local candidate since M012's drafting review: concise ADD-style
routine driver output, a permanent one-line racing progress footer shown only once a
milestone is confirmed, and an on-demand structured Progress Report -- all reusing data
PitWay already tracks, never a new authoritative data source, and strictly a
presentation-layer behavior. Two additional pieces ride this milestone at the
developer's explicit direction: a human-readable `name` field for tasks (AC001/AC002),
raised during M012's own hardening review and deliberately deferred to this milestone
rather than added into M012 mid-review; and a read-only `verify --status` view
(AC008), which both closes a real, twice-observed friction point from M011/M012
(`verify <id>` always re-executes every command check and always reports manual/review
checks as "pending" even when already recorded) and supplies the one shared
verification-status derivation AC003's workload percentage and AC004/AC005's
footer/report all need, so it is built first in the task graph rather than duplicated
per caller.

One deliberate, disclosed deviation from the original candidate's wording: that
candidate described the Progress Report's token breakdown as mirroring a "four-
dimension model" that includes "driver overhead." This project's own
`docs/evidence/M009/token-accounting-feasibility.md` explicitly flags orchestration/
driver overhead as **not directly reported by the runtime, only derivable**, and
states any such figure must be labeled PitWay-derived-and-conditional and never blended
with directly-measured dimensions -- and the Token Telemetry Spike that would validate
whether/how to compute it (E2/E3) has not run. Rather than fabricate a figure this
milestone cannot honestly measure, AC005's token breakdown reports exactly the three
directly-measured categories PitWay already tracks (task, planning, qa) plus the total
and missing-usage count, with driver-overhead omitted entirely -- not estimated, not
shown as a placeholder. AC010's reconciliation records this deviation in
`IMPLEMENTATION_PLAN.md` alongside the rest of this milestone's actual delivery.

The `name` field (AC001/AC002) is additive-optional and non-breaking for every one of
PitWay's own twelve completed milestones' `tasks.yaml` files, mirroring the precedent
already set by `mapped_ac_ids` and `required_skills`. As with those two fields, this
milestone's own `tasks.yaml` (drafted and validated by `milestone-add` before this
field exists in the running schema) cannot itself carry a `name` on any of its own
tasks -- the same disclosed non-bootstrap gap `mapped_ac_ids` (M011/T010) and
`required_skills` (M011/T003) already carry.

This milestone develops under `branch_strategy: main` (the conservative default) unless
the developer directs otherwise before confirmation -- `milestone` strategy would make
this the first real dogfood use of M012's own branch-isolation feature, at the cost of
every `.pitway/` command failing outside the milestone branch until it is eventually
merged (M012's own disclosed limitation). This is a developer decision, not assumed
silently by this draft.

## Scope

- `taskSchema` gains an additive-optional `name` field (AC001), surfaced with
  id-fallback in `resume` and `task-status` output (AC002).
- A pure, tested Core function computes the exact five-band cumulative workload
  percentage already in informal live use (AC003).
- A shared verification-status helper, extracted from `milestone-complete`'s own
  private gate-check logic with zero behavior change, backs both a new read-only
  `verify --status` view (AC008) and every other AC in this milestone that needs to
  know whether verification has passed (AC003, AC004, AC005).
- A pure, tested Core function computes the critical path -- the longest remaining
  dependency chain (AC006).
- A permanent one-line racing footer, wired into `resume` and `milestone-status`,
  shown only after confirmation, with four icon variants and no footer at all before
  confirmation (AC004).
- An on-demand, fully structured Progress Report via `milestone-status --report`,
  reusing AC001-AC008's own data and functions, with evidence-honest task-state
  labeling (AC005, AC007).
- `protocol-driver.md` documentation of the ADD-style convention, the footer rule,
  and the two new read-only flags, with an explicit disclosure of what PitWay can and
  cannot verify about driver-session habits (AC009).
- `IMPLEMENTATION_PLAN.md` reconciliation, including retiring the Backlog section's
  task-name-field entry as delivered, plus this milestone's own full-suite/typecheck
  gate (AC010).

**Out of scope**: no live/interactive rendering of any kind -- no spinners, no watch
mode, no implication that PitWay monitors a running process; this report and footer are
rendered once, on demand or at message-end, from already-persisted state, exactly like
every other PitWay command. No color or terminal theming. No retroactive `name`
backfill on any historical milestone's tasks -- every pre-M013 task stays exactly as it
is, unnamed. No `driver_overhead`/orchestration-overhead token figure of any kind (see
Objective) -- that remains gated on the not-yet-run Token Telemetry Spike. No actionable
missing-`.pitway/`-state diagnostic for the wrong-branch scenario M012/T007 disclosed --
evaluated and deferred: no shared CLI error-handling entry point currently exists to
hang such a diagnostic off without a broader, separately-scoped refactor; recorded as a
new Backlog candidate by AC010 rather than attempted here. No new top-level command --
`--status` and `--report` extend `verify` and `milestone-status` respectively, per this
project's own small-command-surface discipline. No change to `usage-add`'s categories,
`taskUsageSchema`, or any other persisted `.pitway/` state shape beyond AC001's own
additive `name` field.

## Change Log

- 2026-08-20 (T008 execution): T008's own milestone-level full-suite gate
  (`npm test && npx tsc --noEmit`) surfaced a real regression: two
  pre-existing tests -- `tests/integration/fresh-session-resume.test.ts` and
  `tests/integration/self-hosting-readiness.test.ts` -- assert `resume`'s
  task list as exactly `{id, status}`, predating AC002's own `name: null`
  addition to every entry. T008's drafted `write_scope` only covered
  `IMPLEMENTATION_PLAN.md`, not these two files, so fixing the stale
  assertions is a discovered scope conflict, not something to route around
  silently. Developer approved widening T008's `write_scope`/`context_files`
  (via a corresponding `task-amend`) to cover both test files -- delivering
  a genuinely green full-suite gate as AC010 already implicitly requires,
  rather than silently narrowing the gate's own meaning. No AC/CT text
  changes; only T008's declared scope is corrected to match what running
  its own gate to completion actually requires.
