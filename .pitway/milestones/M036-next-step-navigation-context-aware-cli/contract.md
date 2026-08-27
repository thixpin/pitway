---
schema_version: 1
id: M036
title: Next-step Navigation & Context-Aware CLI Guidance
status: completed
requirement: null
confirmed_at: 2026-08-27T12:00:00Z
verification_approved_hash: sha256:1bccb2b0561a1ec73832c882021aed360c676eb57d70a13cee75d12f7538a03a
base_branch: main
base_revision: 4abf9e459c24010d155a29e8b848d41471bd3e69
acceptance_criteria:
  - id: AC001
    text: task-verify's human-mode output, when the run passed, suggests the next
      command (task-update <id> review), and appends the existing racing footer
      when an active milestone exists -- matching the pattern already used by
      task-update/task-dispatch/task-integrate/task-discard.
  - id: AC002
    text: "task-amend's human-mode success output appends the existing racing footer
      when an active milestone exists, unconditionally (it operates on a task,
      always implicitly scoped to the active milestone). usage-add, verify's
      approve/commit/cancel, and verification-repair's approve/commit/cancel all
      take an explicit milestone id -- each of these appends the footer ONLY
      when that resolved milestone id equals state.active_milestone (never a
      footer for a different milestone than the one just acted on). auto-run's
      enable/disable subcommands append the footer when an active milestone
      exists. No footer on any read-only status/list display (verify --status,
      auto-run status), and milestone-add is explicitly excluded (its footer is
      a provable no-op: a freshly created milestone is always draft, for which
      computeRacingFooter always returns null)."
  - id: AC003
    text: verify's human-mode run and record paths (not --status), only when
      allChecksPassed(contract, computeLatestCheckResults(...)) is true AND
      every required task is already completed (computeMilestoneProgress shows
      completed === total), add one line naming milestone-complete <id> as the
      next command after developer approval -- never derived from
      VerifyRunView's own passed/pending fields, which never clear pending for a
      manual/review check even after it is recorded.
  - id: AC004
    text: "milestone-complete's three refusal messages name an accurate recovery
      command per affected item, never one fixed string: for an incomplete task,
      task-update <id> completed only when its status is review, task-update
      <id> ready when its status is blocked or failed, and no fabricated command
      for any other status (planned/waiting/ready/in_progress -- the existing
      bare '<id> (<status>)' entry is left as-is there); for a missing or
      failing check, pitway verify <mId> for a command-type check, pitway verify
      <mId> --check <id> --pass|--fail --evidence <text> for a
      manual/review-type check."
  - id: AC005
    text: "pitway resume's waiting task entries carry a structured detail naming the
      specific incomplete dependency they're waiting on (derivable from
      depends_on alone). Blocked task entries carry a structured detail with the
      verified recovery command (task-update <id> ready, per
      .claude/commands/task-update.md's own documented failed/blocked -> ready
      -> in_progress recovery path) -- never a fabricated cause, since no schema
      field records why a task is blocked. Both are additive: the existing
      blocked/waiting id-array fields keep their exact current shape and
      content."
  - id: AC006
    text: Every existing test's asserted output is unchanged, except
      milestone-complete.test.ts's assertions on the three refusal strings T004
      deliberately extends (covered by AC004's own criteria instead). All other
      additions are strictly additive -- new lines/fields only, in human mode or
      as new JSON keys -- and the full suite continues to pass.
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npx vitest run tests/integration/task-verify.test.ts
  - id: CT002
    criterion: AC002
    type: command
    command: npx vitest run tests/integration/task-amend.test.ts
      tests/integration/usage-add.test.ts tests/integration/verify.test.ts
      tests/integration/verification-repair.test.ts
      tests/integration/auto-run.test.ts
  - id: CT003
    criterion: AC003
    type: command
    command: npx vitest run tests/integration/verify.test.ts
  - id: CT004
    criterion: AC004
    type: command
    command: npx vitest run tests/integration/milestone-complete.test.ts
  - id: CT005
    criterion: AC005
    type: command
    command: npx vitest run tests/integration/resume.test.ts
  - id: CT006
    criterion: AC006
    type: command
    command: npm test
    timeout_ms: 900000
---

# Contract

## Objective

Make PitWay's CLI state-aware in the way its own best existing output
already is (the racing footer; `milestone-merge`'s "already merged"
no-op message; `resume`'s `DispatchResidue.detail` strings; `commit.ts`'s
RED→GREEN refusal, which names the exact next command including its
escape hatch): after an actionable command runs, tell the developer what
happened, what the state is now, and the exact next command or recovery
action — never a vague hint, and never a command that would itself
immediately fail.

This is a UX/output-layer milestone only. It reuses the existing racing
footer mechanism (`getFooterForActiveMilestone`, already proven across 8
commands) and extends it to the commands that lack it; it edits existing
error-message strings to name the recovery command the code already has
enough information to construct *correctly* (branched per task status /
check type, not one fixed string); and it adds one genuinely new
structured field to `resume`'s already-established
`DispatchResidue`-style detail pattern. No new state, no new commands,
no workflow/state-machine change, and no command ever auto-executes the
guidance it prints.

## Scope

- **T001**: `task-verify`'s human-mode output suggests `task-update <id>
  review` on a pass, and gains the racing footer.
- **T002**: wire the existing racing footer into `task-amend`
  (unconditional), `usage-add`, `verify` (approve/commit/cancel only),
  `verification-repair` (approve/commit/cancel only) -- the latter three
  guarded by an active-milestone-id match, since all three take an
  explicit milestone id argument -- and `auto-run` (enable/disable only).
  Never on a read-only status/list display.
- **T003**: `verify`'s human-mode run/record output adds a
  `milestone-complete <id>` hint, gated on the real completion
  precondition (`allChecksPassed` + full task completion), not on
  `VerifyRunView`'s own fields.
- **T004**: `milestone-complete`'s three refusal messages name an
  accurate, status/type-specific recovery command per affected item,
  never guessing one a developer could hit and have it fail.
- **T005**: `resume`'s `blocked`/`waiting` task lists gain a structured
  recovery-detail string per task (waiting: the specific blocking
  dependency; blocked: the verified `task-update <id> ready` recovery
  path), in both JSON and human mode.

## Non-Goals

- Redesigning the task/milestone state machine, or any transition rule.
- Auto-executing any suggested command — every command remains
  driver/developer-invoked, exactly as today.
- New state files, new schema fields under `.pitway/`, or new CLI
  commands/flags.
- `milestone-add`'s own footer — confirmed a structural no-op given
  current invariants (a fresh milestone is always `draft`, whose footer
  is always `null`); not worth wiring for a line that can never render.
- The 5 `milestone-review` subcommands' output — review's own
  report/decide flow already serves a different, deliberately separate
  status role; revisiting its output is a separate, later decision, not
  bundled into this pass.
- Any change to what the racing footer itself computes
  (`computeRacingFooter`/`resolveNextTask`) — only which commands render
  it, and under what condition.
- Naming a recovery command for an incomplete task in `planned`,
  `waiting`, `ready`, or `in_progress` status in `milestone-complete`'s
  refusal (T004) — the existing bare `<id> (<status>)` entry stays as-is
  there; inventing a single "next command" for those statuses isn't
  reliably correct without deeper task-lifecycle context this
  UX-only milestone doesn't add.

## Change Log

- 2026-08-27: Draft created.
- 2026-08-27: Revised after milestone-review (ui-ux, architect;
  revision_requested). Both roles independently found AC004/T003's fixed
  recovery commands wrong for non-`review` tasks and non-`command`
  checks (verified: `blocked` only transitions to `ready`;
  `pitway verify` never resolves manual/review checks) — now branched
  per status/type. AC003's original gating condition could never fire
  for a manual/review check (verified: `pending` never clears for one,
  even after a recorded pass) — now reuses `allChecksPassed` plus task
  completion. Dropped `milestone-add` from AC002 (provable no-op).
  Scoped AC002 to specific subcommands, never read-only displays, and
  added the active-milestone-id-match guard for `verify`/
  `verification-repair`. Corrected AC005/T005's source doc
  (`.claude/commands/task-update.md`, not `protocol-driver.md`) and its
  verified recovery command. Narrowed AC006 to exempt T004's three
  deliberately-changed refusal strings.
- 2026-08-27: Amended mid-T002 (developer-approved): `usage-add` also
  takes an explicit milestone id, sharing the identical wrong-milestone
  footer risk AC002 already guards for `verify`/`verification-repair` --
  discovered while implementing T002. Extended the same
  active-milestone-id-match guard to `usage-add` for consistency,
  instead of leaving it unconditional as originally drafted.
