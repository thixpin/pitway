---
schema_version: 1
id: M037
title: Quick Change & Workflow Lifecycle Hardening
status: completed
requirement: null
confirmed_at: 2026-08-27T08:15:59Z
verification_approved_hash: sha256:7fed774e6c371ab1736f71e283f66f3c9395536ee6c421c4badffdb33cb3278d
base_branch: main
base_revision: 3f17601a2a3b5a5644407662701ab81486c4a467
acceptance_criteria:
  - id: AC001
    text: quick-change create accepts --closes <backlog-id>, validating the id
      exists and is pending; the choice is locked into the change's approved
      hash exactly like --tdd-exempt, and re-validated by run the same way.
  - id: AC002
    text: "quick-change commit, when closesBacklogId is set, archives the linked
      backlog item and lands that archive in the SAME atomic commit as the fix
      (backlog.yaml joins the commit's expectedPaths, archived via
      archiveBacklogItem before staging) -- one commit, PitWay-Change: <id>
      trailer preserved, no other .pitway/** path ever permitted into that
      commit."
  - id: AC003
    text: "quick-change cancel and promote never archive the linked backlog item
      even when closesBacklogId is set -- it stays pending, exactly as if
      --closes had never been passed. commit is self-healing/idempotent: it
      checks the linked item's current status before archiving and skips the
      archive call when already archived (mirroring the existing
      status-check-before-mutate pattern used for task completion), so a resume
      after an interrupted commit neither double-commits, nor double-archives,
      nor errors."
  - id: AC004
    text: pitway backlog add succeeds with no active milestone (source.milestone
      recorded as null), using a milestone-less path that never touches the
      entry-kind journal schema's non-nullable milestone id requirement --
      mirrors archive's own already-milestone-less journal record kind rather
      than weakening the shared entry schema other record kinds still depend on.
  - id: AC005
    text: milestone-complete's own human-mode output states plainly that
      milestone-merge requires separate, explicit developer approval and is
      never run automatically -- the same next-step-guidance discipline M036
      established elsewhere, closing the exact gap that let milestone-merge get
      chained automatically after milestone-complete twice this session.
  - id: AC006
    text: pitway resume names, among ready tasks, which ones are eligible for
      parallel dispatch today (pairwise-disjoint write_scope, independent
      dependencies) when execution.strategy is parallel_worktrees -- an additive
      field/section, never auto-dispatching anything itself.
  - id: AC007
    text: Every protocol, command, skill, and driver doc affected by AC001-AC006 is
      updated across all three drivers where applicable (backlog.md's now-false
      'requires an active milestone' claim rewritten, quick-change.md documents
      --closes, milestone-complete.md/protocol-driver.md reinforce the
      merge-approval gate, task-dispatch.md/protocol-driver.md mention the new
      resume nudge) -- no contradictory or stale instruction left behind, and
      every touched common/claude doc's pinned sha256 in the driver-asset test
      manifests is regenerated to match.
  - id: AC008
    text: Every existing test's asserted output is unchanged except where
      AC001-AC006 deliberately change existing behavior (backlog.md's stale
      claim, milestone-complete's output). All additions are additive. Full
      suite passes.
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npx vitest run tests/unit/quick-change-lifecycle.test.ts
      tests/integration/quick-change.test.ts
  - id: CT002
    criterion: AC002
    type: command
    command: npx vitest run tests/unit/quick-change-commit.test.ts
      tests/integration/quick-change.test.ts
  - id: CT003
    criterion: AC003
    type: command
    command: npx vitest run tests/unit/quick-change-lifecycle.test.ts
      tests/unit/quick-change-commit.test.ts
      tests/integration/quick-change.test.ts
  - id: CT004
    criterion: AC004
    type: command
    command: npx vitest run tests/unit/backlog-state.test.ts
      tests/integration/backlog.test.ts
  - id: CT005
    criterion: AC005
    type: command
    command: npx vitest run tests/integration/milestone-complete.test.ts
  - id: CT006
    criterion: AC006
    type: command
    command: npx vitest run tests/integration/resume.test.ts
  - id: CT007
    criterion: AC007
    type: command
    command: npx vitest run tests/unit/claude-assets.test.ts
      tests/unit/codex-assets.test.ts tests/unit/opencode-assets.test.ts
      tests/integration/init.test.ts
  - id: CT008
    criterion: AC008
    type: command
    command: npm test
    timeout_ms: 900000
---

# Contract

## Objective

Harden three workflow-lifecycle gaps this session's own dogfooding
exposed, plus one enhancement the same dogfooding motivated:

1. Closing a backlog item's fix via `quick-change` today takes two
   commits (the fix, then a separate manual `chore: archive` commit),
   because `quick-change`'s scope validation categorically forbids any
   `.pitway/` path — for good reason (state stays CLI-owned), but with no
   sanctioned exception for the one case that's actually safe: archiving
   the specific backlog item the change itself closes.
2. `pitway backlog add` refuses without an active milestone, even though
   `archive` already works fine without one — an unnecessary coupling
   that made filing this session's own findings from a completed
   milestone add friction.
3. `milestone-complete`'s own output says nothing about `milestone-merge`
   needing separate developer approval — a real doc-only gate exists in
   `protocol-driver.md`, but nothing in the command's own output
   reinforces it, and the driver (this session) chained the two together
   automatically, twice, despite knowing the rule.
4. `pitway resume` never names which `ready` tasks are actually eligible
   for parallel dispatch today, even when `parallel_worktrees` is
   enabled — the driver (this session) defaulted to inline execution
   repeatedly with no surfaced signal to prompt otherwise.

## Scope

- **T001**: `quick-change create --closes <backlog-id>` — validate,
  lock via hash, fold the backlog archive into the same atomic commit as
  the fix at `commit` time, checking the linked item's status before
  archiving so a crash/retry between archive and git-commit is a safe
  no-op instead of a hard failure; `cancel`/`promote` never archive.
- **T002**: `pitway backlog add` works with no active milestone
  (`source.milestone: null`), by appending a new milestone-less journal
  record kind (mirroring `archive`'s own `backlog_archive` kind — never
  by skipping journaling, and never by loosening the shared `entry`-kind
  schema other journal record kinds still require a real milestone for).
  Touches `src/state/journal.ts`, the same file T001 extends, so T002 is
  sequenced after T001 rather than run in parallel with it.
- **T003**: `milestone-complete`'s human-mode output states the
  merge-approval gate explicitly.
- **T004**: `pitway resume` names parallel-dispatch-eligible ready tasks
  when `execution.strategy: parallel_worktrees` is set — advisory only,
  never auto-dispatching.
- **T005**: documentation across `protocol-driver.md` and all three
  drivers' affected command docs, plus every touched common/claude
  asset's pinned-hash manifest entry.

## Non-Goals

- Redesigning the milestone or task state machine, or any transition
  rule — this hardens existing gates and adds one advisory signal, it
  does not restructure the workflow.
- Weakening any existing safety/approval boundary — `milestone-merge`
  itself still requires the same explicit developer approval it always
  has; this only makes that requirement more visible at the point of
  action.
- Loosening `.pitway/` protection for quick-change scope generally —
  `--closes` is one narrow, explicit, validated exception (a single
  known backlog id, archived through the existing `archiveBacklogItem`
  function, never an arbitrary `.pitway/**` write).
- Auto-dispatching anything: T004 is a resume-time advisory only: it
  names eligibility, it never calls `task-dispatch` itself.
- `backlog promote`'s existing active-milestone requirement — unlike
  `add`, `promote` targets a task, which is inherently milestone-scoped;
  only `add`'s unnecessary coupling is in scope.

## Change Log

- 2026-08-27: Draft created.
- 2026-08-27: Revised per architect review (rev-e88416c6a982,
  revision_requested): AC003/T001 now require a status check before
  archiving so a crash between archive and git-commit is a safe no-op,
  not a hard failure; T002 now appends a proper milestone-less journal
  record (never skips journaling) and is sequenced after T001 since both
  touch `src/state/journal.ts`; T004 now reuses the existing
  `parallel-eligibility.ts` implementation instead of reimplementing it,
  and drops `relevant_files` from the eligibility comparison.
- 2026-08-27: Round 2 architect review (rev-4fca2ad989a7) accepted with
  2 minor, non-blocking findings; folded as implementer notes into
  T001 (archive.ts's pre-existing journal-before-state ordering is
  out of scope) and T004 (exclude self from the pairwise comparison
  loop; update the redundancy comment for the new call site).
