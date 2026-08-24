---
schema_version: 1
id: M031
title: Sequential Subagent Dispatch Protocol
status: in_progress
requirement: R005
confirmed_at: 2026-08-24T06:05:31Z
verification_approved_hash: sha256:2b55942838dcd7b4cffbcf3a2075731e3a02934edb3faa06b12caf73a5ca9bc6
base_branch: main
base_revision: 52e5724ac19a54a2b7f45f020b9bce090c020a00
acceptance_criteria:
  - id: AC001
    text: >-
      dispatch.md gains a new 'Sequential subagent dispatch' section
      documenting: (a) scope -- applies only to a genuine dependency chain
      within a milestone (task B depends_on task A, and so on), never used to
      serialize two or more otherwise-parallel-eligible ready tasks with
      disjoint write scopes, which stay eligible for parallel_worktrees or
      independent dispatch exactly as today; (b) what it actually saves -- the
      dispatched subagent's own re-briefing/context-priming overhead across the
      chain, explicitly NOT a reduction in the driver's own per-task work, which
      stays the full existing dispatch.md sequence (steps 1-8: confirm ready,
      task-update in_progress, gather the bundle, dispatch, diff/write_scope
      review, task-verify, task-update review, task-update completed) run once
      per task exactly as today; (c) driver-agnostic behavior -- when the
      driving harness can resume a previously-dispatched subagent with its own
      retained context, reuse that identity for tasks 2+ in the chain, handing
      it only the new task's bundle (step 3, unchanged); when the harness
      cannot, dispatch a fresh worker per task exactly as the existing sequence
      already does -- the behavioral contract is identical either way, and
      nothing about correctness depends on which path a given driver takes; (d)
      usage is attributed per dispatch/resume call, never estimated or split
      from an aggregate figure -- the existing MUST rule (dispatch.md step 8),
      applied once per task in the chain rather than once for the whole
      sequence; (e) a task that does not complete cleanly (diff review or
      task-verify does not pass) stops the chain -- the same subagent is not
      resumed for the next task until that one reaches completed through the
      normal recovery path (blocked/failed, task-amend, or a fresh attempt); (f)
      results, evidence, status, and usage for every task in the chain remain
      visible to the driver via the normal task-status/ milestone-status
      surfaces, since the driver itself runs every state-mutating command,
      exactly as for any other dispatch; (g) a pointer to AC005's dedicated
      context-isolation trade-off disclosure below -- this point does not itself
      restate or substitute for that disclosure, to avoid diluting it into a
      bare unverifiability caveat.

      protocol-worker.md gains a short addendum: a worker resumed for a
      subsequent task in a chain follows every existing Hard Rule unchanged --
      in particular, it still never calls pitway or touches .pitway/ -- and task
      authorization stays task-specific: it carries forward none of a prior
      task's write scope or acceptance criteria into the next task's execution.
      (Ambient context retained from prior turns is a separate matter, governed
      by AC005, not by this Hard-Rule addendum.)

      protocol-driver.md's 'Dispatch discipline' section gains a new one-line
      pointer to the new dispatch.md subsection, written in the same terse
      cross-file pointer style already used elsewhere in these docs (for
      example, dispatch.md's own 'Parallel dispatch (worktree mode)' section
      already points to protocol-driver.md's 'Parallel dispatch' section). There
      is no existing reverse pointer inside Dispatch discipline today for this
      to mirror -- this adds the first one, in that established style.
  - id: AC002
    text: "A documentation-presence regression test in
      tests/unit/claude-assets.test.ts (mirroring the existing M019 'driver
      usage-propagation MUST instruction is documented' pattern -- narrow
      contains-checks against key phrases, never verbatim sentences, so a future
      wording tweak doesn't break it) confirms dispatch.md's new section states
      the driver-agnostic fallback, the per-task usage-attribution rule, and
      AC005's context-isolation trade-off disclosure as its own distinct point
      (e.g. asserts both an enforcement-related phrase, such as 'write_scope' or
      'enforced', and a distinct relaxation/cannot-prevent phrase, such as
      'cannot enforce' or 'cannot prevent', both appear). Written first and
      failing before the content exists (TDD: RED before GREEN). The
      claude-assets pinned sha256 manifest (PRE_M023_ASSET_MANIFEST) is
      refreshed for dispatch.md, protocol-worker.md, and protocol-driver.md to
      match their new content."
  - id: AC003
    text: This is a protocol-documentation-only milestone -- no Core/CLI/schema code
      changes anywhere. Every PitWay-enforced governance mechanism (write_scope
      enforcement, state-machine transitions, verification evidence, the
      journal, usage-tracking, and the developer/amendment approval gate)
      remains exactly as it is today for every task, resumed-chain or not,
      consistent with the requirement's "existing milestone, task, verification,
      journal, usage-tracking, and governance rules remain unchanged." The one
      explicit exception is CLAUDE.md's Context isolation guarantee for a
      resumed-chain subagent, which is not claimed unchanged here -- see AC005,
      which documents and discloses that trade-off instead. Full suite and tsc
      --noEmit stay green; working tree clean at completion.
  - id: AC004
    text: "Governance: any amendment must be proposed by the agent and stop for
      explicit developer approval before the contract is mutated or execution
      continues."
  - id: AC005
    text: "Context-isolation trade-off, disclosed explicitly (developer-directed,
      2026-08-24): dispatch.md's new section and protocol-worker.md's addendum
      state plainly, as their own first-class point rather than folded into a
      general unverifiability caveat, that: (1) task authorization and isolation
      remain fully enforced regardless of dispatch mode -- write_scope, PitWay
      state access, the task lifecycle, verification evidence, and usage
      attribution stay task-specific and driver-controlled, exactly as today,
      for every task in a chain; (2) context isolation is intentionally relaxed
      for a resumed subagent -- prior tasks in the same delegated sequence may
      remain present in the subagent's own context and may influence its
      reasoning on a later task in that chain; (3) this retention is the
      mechanism the feature relies on to cut re-briefing cost, not an accidental
      side effect, and is the intended benefit; (4) PitWay cannot enforce or
      prevent that cross-task context influence inside a resumed harness
      session, nor verify how much of it actually occurred -- only the
      write_scope check at task-update completion bounds the blast radius, and
      only for writes, not reasoning. This must read as a clear, standalone
      disclosure of a real trade-off, not as a claim that the existing
      context-isolation invariant (CLAUDE.md's Context isolation rule) is
      unchanged for a resumed-chain task."
verification:
  - id: CT001
    criterion: AC001
    type: manual
    instruction: Review dispatch.md's new "Sequential subagent dispatch" section
      (including its AC005 context-isolation trade-off disclosure),
      protocol-worker.md's resumed-worker addendum, and protocol-driver.md's new
      pointer for accuracy, completeness (all seven points a-g plus the AC005
      disclosure), and consistency with the existing dispatch sequence and hard
      rules. Confirm the disclosure reads as a standalone trade-off statement,
      not diluted into a bare unverifiability caveat.
  - id: CT002
    criterion: AC002
    type: command
    command: npx vitest run tests/unit/claude-assets.test.ts
      tests/unit/opencode-assets.test.ts tests/unit/codex-assets.test.ts
  - id: CT003
    criterion: AC003
    type: command
    command: npm run build && npm test && npx tsc --noEmit
    timeout_ms: 900000
  - id: CT004
    criterion: AC004
    type: manual
    instruction: Confirm every amendment applied to this contract carries recorded
      explicit developer approval made before the amending command ran.
  - id: CT005
    criterion: AC005
    type: manual
    instruction: Confirm dispatch.md's disclosure and protocol-worker.md's addendum
      state all four points of AC005 (isolation enforced; relaxation
      intentional; relaxation is the intended benefit; PitWay cannot
      enforce/verify it) plainly and are not merged into or overshadowed by the
      general required_skills/reviewer-independence style honesty-caveat pattern
      used elsewhere in these docs.
---

# Contract

## Objective

Document a new, optional, driver-agnostic dispatch pattern -- sequential
subagent dispatch across a dependency chain -- that reduces a dispatched
subagent's own re-briefing overhead when a harness supports resuming it
with retained context, without changing anything about the driver's own
per-task epilogue, the task lifecycle, or any Core/CLI behavior. Task
authorization and isolation (write_scope, state access, verification,
usage attribution) remain fully enforced per task; only the subagent's own
ambient context isolation is intentionally relaxed across a resumed chain,
disclosed explicitly rather than left implicit.

## Background

Per `.pitway/requirements/R005.md`: today, each task in a dependency chain
that isn't otherwise parallel-eligible gets a fresh subagent dispatch (or
inline execution), each paying its own re-briefing/startup cost with zero
memory of the chain's earlier tasks. The requirement asks for an optional
pattern where one subagent identity is reused across such a chain to cut
that repeated overhead -- while explicitly preserving every existing
governance invariant: the driver still runs the full per-task lifecycle
itself (`task-verify`, review, `task-update completed`, usage
attribution), and the dispatched subagent still never touches `.pitway/`
or calls `pitway` -- the same hard rule that already applies to every
existing dispatch mode, inline or worktree.

**Investigated and confirmed before drafting**: `dispatch.md` and
`protocol-worker.md` already state this invariant unconditionally ("Report
back, don't persist... you never call `pitway`, not even `task-update`" --
even in worktree mode, where a CLI guard actively refuses state-mutating
commands from inside a task worktree). Nothing about this milestone
relaxes that. Because every single task's lifecycle is still processed
through the exact same CLI commands regardless of whether the "worker"
behind a given dispatch is a fresh subagent or a resumed one, **this
requires zero Core/CLI/schema changes** -- it is a protocol-documentation
milestone only, which is what R005's own bullet "existing milestone, task,
verification, journal, usage-tracking, and governance rules remain
unchanged" already implies.

**Design decision, made explicit for the approval gate (developer-directed
2026-08-24):** the resume-a-subagent mechanism is inherently harness-
specific (this driver's own session-resume capability is not necessarily
available in another driver's harness). `dispatch.md` is a shared asset
across all three installed drivers (claude, codex, opencode), so its new
section is written entirely in driver-agnostic language -- it never names a
specific tool or mechanism, only the behavioral contract ("resume when your
harness supports it, dispatch fresh per task when it doesn't; the contract
is identical either way") -- matching the existing convention already used
throughout `dispatch.md`/`protocol-driver.md`/`protocol-worker.md`, none of
which name a specific tool today either. No per-driver override file is
introduced; this stays on the single shared common asset.

**R005.md itself was revised** (developer-directed) before drafting, to
remove ambiguity in its own opening paragraph that could be read as "the
driver does less per-task work" -- it now states explicitly that the
driver's full epilogue is unchanged and only re-briefing overhead is
reduced, and adds an explicit driver-agnostic-fallback bullet.

**Milestone review, developer-directed revision (2026-08-24):** an
independent `milestone-review` (`developer`,`architect` roles) surfaced a
major finding: the original AC001(g) framed the trade-off as "PitWay
cannot verify a resume genuinely retained context" -- backwards from the
real risk, which is that a genuine resume *does* retain the prior task's
context by design (that's the mechanism the feature relies on), and this
was in tension with CLAUDE.md's Context isolation rule while AC003
implied nothing changed. Per explicit developer direction, the design
itself is unchanged; the contract now distinguishes (a) task
authorization/isolation, which stays fully enforced per task
(write_scope, state access, lifecycle, verification, usage), from (b)
ambient context isolation, which is intentionally relaxed for a resumed
subagent as the feature's own intended benefit -- disclosed explicitly as
AC005, not claimed away. AC003 no longer implies the context-isolation
invariant is untouched. The review also caught a second, minor,
independently-confirmed-by-both-roles error: AC001(c)'s original claim
that the new protocol-driver.md pointer "mirrors" an existing cross-
reference inside Dispatch discipline was factually wrong (no such
reference exists there); the text now describes the actual one-directional
pointer relationship instead.

## Change Log
