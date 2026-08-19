---
schema_version: 1
id: M007
title: Dogfood Validation and Adaptive Workflow Intensity Decision
status: in_progress
requirement: null
confirmed_at: 2026-08-19T11:56:41Z
verification_approved_hash: sha256:812fc4fbe22e87e5e46afd63d6b4d796abe9de8ce4b6eda3f3decd1e2d48b100
acceptance_criteria:
  - id: AC001
    text: "Core sequential-MVP dogfood validation, using real evidence gathered from
      this repository's own history rather than synthetic scenarios, compiled
      into a durable deliverable at docs/evidence/M007/ dogfood-evidence.md (not
      a draft — evidence this milestone's own completion depends on, matching
      M006/AC005's docs/evidence/ M006-context-efficiency.md precedent):
      fresh-session state reconstruction (already demonstrated 2026-08-18,
      formalized here as a regression-covered scenario), API-interrupted
      sub-agent resume (attempted during M004/T007; first interruption resumed
      cleanly via SendMessage to the same agent id, second interruption was a
      hard session-limit stop requiring a different recovery approach — both
      outcomes recorded and evaluated here), task-amendment behavior audited
      against every amendment actually made during M005 (2 contract amends, 2
      task-amend calls, plus the T007 bootstrap repair), a Git traceability
      audit across the full M001-M006 commit history (trailer coverage, and the
      standalone-fix-commit pattern's frequency including BOTH M005's four
      hotfix commits AND ALL THREE of M006's — `81c99a2` fix(workflow): honor
      write_scope during task completion, `1e07014` fix(workflow): recognize
      managed Claude assets at baseline, and `81a420a` test(verification):
      isolate recursion guard environment — seven standalone recovery/hotfix
      commits total across M005-M006, plus squash/rewrite exposure). The audit
      additionally classifies `85fa243` chore: ignore local workflow reports as
      a separate category — a between-milestone maintenance commit, not an
      eighth hotfix: it fixes no defect and recovers from no incident, it
      normalizes repository-local tooling (`.gitignore`) between M006's
      completion and M007's drafting, and it carries no PitWay trailer for the
      same underlying reason as the seven recovery commits (no supported
      PitWay-attributed path existed for landing it any other way — see AC005).
      The distinction is preserved throughout, never collapsed into one number:
      7 standalone recovery/hotfix commits across M005-M006, plus 1
      between-milestone maintenance commit (`85fa243`). Also part of this task:
      context-efficiency evidence compiled as an explicit before/after
      comparison against M006's own measurements (docs/evidence/
      M006-context-efficiency.md, itself unedited — a new comparison document,
      not a rewrite of that historical snapshot). This task also investigates
      M006's own disclosed CT012 full-suite flakiness finding (two bounded
      full-suite runs after M006/T002 each completed without hanging and left
      zero surviving processes, but reported a different, small,
      non-T002-related transient failure set each run under concurrent
      subprocess load) and records a decision — the cause remains unproven and
      may be explicitly deferred with the evidence stated as such, or a specific
      vitest concurrency/isolation change (e.g. `--pool=forks` tuning,
      serialized execution for subprocess-heavy files) may be adopted — never
      asserted as proven environmental noise either way, rather than leaving it
      uninvestigated. Finally, this task constructs one genuinely matched
      inline-vs-sub-agent dispatch pair (same model/config held constant, per
      M006/AC005's own comparability methodology) as fresh evidence for AC010,
      since M006's own T004-vs-T001/T002/T003/T005 split is real but
      retrospective and unmatched."
  - id: AC002
    text: "A design evaluation of the M005 report's contract-fixed, task-adaptive
      execution model (reports/M005.md §11.1, a local, non-authoritative
      supplementary input — not evidence that survives a fresh clone; the
      underlying claims are independently re-verifiable from Git history and
      `.pitway/` state): whether locking task definitions as tightly as the
      milestone contract is warranted, given the M005 evidence of repeated
      in-milestone friction (T001, T003, T004, T007). The evaluation states,
      with evidence, whether the proposed rule (tasks may be adjusted
      automatically only when the change maps to an existing contract AC, stays
      in scope, does not weaken verification, and is journaled with reason and
      diff) should be adopted, and if so, whether it requires new Core mechanism
      or is achievable through disciplined use of the existing task-amend
      command (M005/AC005). Recorded at
      docs/evidence/M007/contract-fixed-task-adaptive-decision.md."
  - id: AC003
    text: "A dogfood-evaluated comparison of exhaustive positive write_scope file
      lists (current M005 model) against narrower-than-file-list boundaries —
      glob/directory-scoped write_scope plus an explicit protected-path denylist
      — measuring whether ceremony (amendment frequency, scope-widening
      incidents) decreases without weakening contract verification or
      write-boundary enforcement. Recorded as a decision, not merely an
      observation, at docs/evidence/M007/ write-scope-boundary-decision.md:
      either adopt, defer with a named reason, or reject with a named reason."
  - id: AC004
    text: "A dogfood-evaluated policy for small, directly-related ripple fixes
      discovered mid-task — the pattern used repeatedly for standalone,
      trailer-less commits: M005's T003/T004/T007 ripples, AND ALL THREE of
      M006's own hotfixes (`81c99a2`, `1e07014`, `81a420a`), each explicitly
      modeled on the same M005 pattern per this session's own record — whether a
      worker may fix such a fix within the current contract's existing
      ACs/verification without a standalone out-of-band commit or repeated
      developer approval, provided the reason and evidence are recorded, and
      never expanding contract or verification scope. Recorded as an
      adopt/defer/reject decision with the mechanism (if adopted) specified, at
      docs/evidence/ M007/ripple-fix-policy-decision.md."
  - id: AC005
    text: "A design decision — not an implementation — for a lightweight,
      non-milestone quick-change/hotfix workflow for changes too small to
      warrant full milestone ceremony. AC006's Adaptive Workflow Intensity
      decision governs which workflow tiers exist and is made only after
      AC001-AC005 (and AC009-AC010)'s evidence exists; a brand-new mechanism
      cannot itself supply real usage evidence before it is built, so building
      it unconditionally ahead of that decision would pre-empt AC006 rather than
      inform it. This AC therefore delivers a complete design at
      docs/evidence/M007/quick-change-design.md, evaluated and recorded as
      adopt/defer/reject, with implementation explicitly out of this milestone's
      scope regardless of outcome — if adopted, implementation is deferred to a
      later, not-yet-numbered milestone sequenced after M007 (a
      roadmap/release-numbering impact reported to the developer at
      contract-drafting time, not silently absorbed into IMPLEMENTATION_PLAN.md
      here). The design must specify, concretely enough that a future
      implementation task could take an exact write_scope file census directly
      from it (every entry an exact file, never a directory or glob) — the
      anticipated set: src/state/schemas.ts (a new QuickChange record shape and
      a new journal record kind, quick_change), src/state/ journal.ts
      (append/read for that kind), src/core/quick-change/create.ts,
      src/core/quick-change/run.ts, src/core/quick-change/commit.ts,
      src/core/quick-change/promote.ts, src/cli/commands/quick-change.ts,
      src/cli/index.ts (one new registration line), plus its test files. The
      design must define: lifecycle (draft -> approved -> committed, with
      draft|approved -> cancelled and approved -> promoted, never a transition
      out of committed); approved-verification handling (the verification
      command is declared at creation and explicitly approved — hashed and gated
      exactly as milestone verification_approved_hash gates `pitway verify`
      today — before any execution, so an arbitrary, unapproved command can
      never run); state/journal storage (quick_change is a new top-level journal
      kind, sibling to entry/checkpoint/auto_run, never folded into a checkpoint
      commit, mirroring M006/AC009's auto_run structural-exclusion pattern
      exactly); crash recovery (an in-flight quick-change is discoverable and
      resumable via `pitway resume` or a new `quick-change status`, the same
      repo/worktree-local durability class as auto-run — persists across
      sessions, not across a fresh clone); commit identity (a `PitWay-Change:
      <change-id>` trailer, parallel to PitWay-Milestone/PitWay-Task, resolved
      by re-reading committed content the same way — no SHA ever persisted in
      state, per decision 4); PitWay-Change trailer lookup (a resolver scoped
      only to quick_change journal records, analogous to resolveTargetPath but
      never touching it); cancellation (`quick-change cancel` appends a new
      journal record, never rewrites or deletes a prior one, never touches a
      commit that already landed); and promotion-to-milestone (an explicit
      `quick-change promote` command, triggered when scope or risk expands
      beyond the declared bounded scope, converting the quick-change into a
      milestone draft referencing its original objective — never automatic,
      never silent). Core/CLI safety invariants (clean-tree-at-start, one atomic
      commit, no unapproved commands) apply to the design identically to the
      milestone workflow, stated explicitly as a design constraint even though
      nothing is built yet. Worked example motivating this design, cited as
      evidence rather than left abstract: `85fa243` chore: ignore local workflow
      reports — a genuinely tiny, legitimate, between-milestone repository-
      maintenance change (a one-line `.gitignore` normalization) that currently
      has no supported PitWay-attributed lightweight path: it was not milestone
      work (no contract, no task, no `PitWay-Milestone`/ `PitWay-Task` trailer
      applies to a change with no milestone), yet it still needed the same
      underlying safety discipline a quick-change would formalize (an explicit
      objective, a bounded scope reviewed before landing, and one atomic commit)
      without any of it being PitWay-attributed or durably recorded anywhere
      PitWay itself tracks. This AC's design must state explicitly whether a
      commit shaped like `85fa243` is the kind of change quick-change is meant
      to cover, and if so, what a `PitWay-Change`-trailed version of that exact
      commit would have looked like under the designed lifecycle."
  - id: AC006
    text: The Adaptive Workflow Intensity design decision (which workflow tiers
      exist, how a change is routed to one, and what changes after this
      milestone) is made and recorded only after AC001-AC005's dogfood evidence
      AND AC009-AC010's decisions exist — not assumed or decided in M006 or
      earlier, and not assumed ahead of AC009/AC010 either, since both are
      themselves workflow-shape decisions this milestone is making. Recorded at
      docs/evidence/M007/adaptive-workflow-intensity-decision.md. A
      roadmap-reconciliation task (mirroring M005/T009 and M006/T006) confirms
      IMPLEMENTATION_PLAN.md accurately reflects the decision and M007's
      actually-delivered scope, including any milestone-numbering impact from
      AC005/AC009 adoptions deferred to later milestones.
  - id: AC007
    text: "A first-class recovery path exists for defects discovered in
      already-completed PitWay tooling itself (distinct from ordinary in-scope
      task work), generalizing the M005/T007 task-amend bootstrap repair into a
      defined, repeatable procedure: how such a defect is diagnosed, whether it
      is fixed within the current milestone's approved scope or deferred to a
      new task/milestone, and how the fix and its evidence are recorded. The
      procedure is demonstrated, not just described, against FOUR worked
      examples, not one: M005/T007's task-amend bootstrap repair, M006/T001's
      write_scope completion-staging fix (`81c99a2`), M006/T003's
      baseline-managed-assets fix (`1e07014`), and M006's own recursion-guard
      test-isolation fix (`81a420a`) — a defect in T002's already-completed test
      suite, discovered only later during the milestone's own end-to-end dogfood
      of `pitway verify M006`, the same already-completed-deliverable-defect
      shape as the other two M006 examples — establishing this as a recurring
      pattern class, not a one-off. The procedure also incorporates the related,
      narrower finding from M006/T003's incident: when a task introduces a new
      category of repository-managed file (not just new source code),
      contract/task-drafting must explicitly check it against every existing
      git-safety/dirty-path allowlist the codebase already has
      (computeExpectedBaselinePaths, classifyDirtyPaths, assertDirtySubset), not
      only against the tasks being drafted' own declared write_scope. Recorded
      at docs/evidence/M007/ tooling-defect-recovery-path.md."
  - id: AC008
    text: "A supported path exists — using only already-shipped commands
      (milestone-add, milestone-confirm, task-update, milestone-complete), zero
      new Core/CLI code — to deliver corrective work for a previously-completed
      task's deliverable later found incomplete (reports/M005.md §11.7, a local
      supplementary input — confirmed after M005/T009: no command transitions a
      task out of completed, appends a task to an already-confirmed milestone's
      graph, or rewrites a completion commit). Documentation alone is not this
      AC's deliverable: the path is proven as a real, tested mechanism by an
      integration test that exercises the real lifecycle order — milestone-add
      A, milestone-confirm A, execute and complete A's task, milestone-complete
      A, only then milestone-add and milestone-confirm B, execute and complete
      B's corrective task — never task completion before milestone confirmation,
      and asserting A remains completed and unchanged throughout B's entire
      lifecycle. The convention: corrective work lands as an ordinary task
      within a NEW (or next-drafted) milestone, never by reopening the original
      — the new task's objective explicitly names the original milestone/task id
      and what was found incomplete, and its completed result (task-update's
      existing structured summary/evidence fields) explicitly references the
      original as what this corrective work revises. It never transitions any
      task out of completed and never rewrites or amends an existing completion
      commit's history — corrective work always lands as new, separately
      verified, separately committed work under its own
      PitWay-Milestone/PitWay-Task trailers. Recorded at docs/evidence/M007/
      completed-task-revision-path.md, proven by tests/integration/
      completed-task-revision-path.test.ts."
  - id: AC009
    text: "An adopt/defer/reject decision for explicit, task-specific Claude Code
      skills (a reusable-workflow mechanism distinct from PitWay's existing
      src/integrations/claude/commands/*.md assets), adapted from — not copied
      from — github.com/thixpin/claude-config, reviewed firsthand this session
      (README.md, CONTRIBUTING.md, skills/bug-fix/SKILL.md all fetched and read
      verbatim, not inferred). The evaluation must resolve, not merely list, the
      open design questions already identified: whether a SKILL.md at
      src/integrations/claude/skills/<name>/SKILL.md is actually picked up by
      claude-assets.ts's existing recursive glob with zero installer changes
      (verify, don't assume); whether a task gains a new optional field naming
      its required skill(s), checked by the dispatch bundle generator, with
      missing-required-skill failing dispatch visibly rather than silently
      proceeding unskilled; which installation strategy — project-local
      (leaning, per PitWay's own deterministic-process principle),
      reference-only, or both — is adopted; and a behavioral comparison
      (skill-enabled vs. skill-free dispatch: startup tokens, total task tokens,
      reads outside declared write_scope/ context_files, structured-report
      compliance against report-format.md, task outcome) under M006/AC005's
      comparable-model/config methodology, retaining or shipping a skill only
      when the comparison demonstrates benefit. This AC is strictly
      decision-only: if adopted, implementation (the actual skill files, any
      schema field, any installer change) is deferred to a separately scoped
      later milestone, unconditionally — no skills implementation, partial or
      otherwise, lands within M007 regardless of how early the decision
      resolves. Recorded at docs/evidence/M007/claude-skills-decision.md."
  - id: AC010
    text: "An adopt/defer/reject decision for right-sized task dispatch — choosing
      inline driver execution vs. sub-agent dispatch deliberately per task, not
      by fixed convention — using AC001's fresh matched-pair comparison as
      primary evidence alongside M006's own retrospective split (T004 inline;
      T001, T002, T003, T005 sub-agent-dispatched, already matching the
      directive's criteria without a formal rule). The decision must state a
      concrete rule (task-metadata-driven signals, e.g. verification.strategy:
      manual/review plus a small write_scope count favoring inline,
      verification.strategy: tdd favoring sub-agent dispatch) and must state
      explicitly that a contract-mandated sub-agent dispatch, if a future
      contract ever declares one, is never silently overridden by this
      optimization. Because implementing this decision (if adopted) is a
      documentation-only change — no new Core/CLI code, only formalizing the
      rule into src/integrations/claude/protocol-driver.md and
      src/integrations/claude/dispatch.md — that formalization, unlike
      AC005/AC009, is delivered within this same task when adopted, not
      deferred. Recorded at docs/evidence/M007/dispatch-mode-decision.md."
  - id: AC011
    text: "The M006/AC005-measured context-bundle duplication defect is fixed:
      buildTaskContextBundle (src/core/tasks/context-bundle.ts) currently passes
      contractExcerpt.acceptanceCriteria as the contract's entire, unfiltered
      acceptance_criteria array — measured at 89% of one real M006 bundle's
      bytes, carrying all 10 ACs when the receiving task mapped to exactly one —
      contradicting IMPLEMENTATION_PLAN.md §8's stated design ('objective +
      mapped ACs only'). Fix: a new, additive- optional task-definition field
      (mapped_ac_ids: string[]) in src/state/schemas.ts, absent on every
      M001-M006 historical task (non-breaking); when present,
      buildTaskContextBundle filters contractExcerpt.acceptanceCriteria to
      exactly those ids; when absent, behavior is byte-for-byte unchanged from
      today (the full array), so no historical milestone's bundle generation
      changes. This is a concrete, already-diagnosed, already-measured defect
      fix, not an evaluate/decide item — implemented in this milestone. This
      AC's task depends on AC001's dogfood evidence task, so the
      M006-context-efficiency baseline comparison is captured against
      context-bundle.ts's pre-fix behavior before this fix changes it — not
      measured after the fact against already-filtered bundles. Non-Bootstrap
      Disclosure: M007's own contract and task definitions are created and
      confirmed via milestone-add before mapped_ac_ids exists as a schema field,
      so M007's own persisted tasks.yaml cannot gain mapped_ac_ids values
      through its own lifecycle without an unsupported rewrite of
      already-confirmed task definitions — no command supports that, and none is
      added here. This AC's task proves the additive schema/filter behavior
      entirely through its own regression tests (schema validation plus
      context-bundle filtering exercised against synthetic, test-only task
      definitions), not by M007 dogfooding the fix on itself — unlike M004's
      milestone-complete or M005's journal/checkpoint model, which each later
      used their own mechanism on themselves, this is the inverse case, and no
      self-application is claimed. mapped_ac_ids becomes available for real
      milestone artifacts starting with M008's own contract-drafting — the first
      milestone drafted after this fix lands — not M007. M007 does not claim to
      receive a bounded, post-fix context bundle for any of its own tasks unless
      a supported command path for that is separately found to exist; none is
      assumed here."
  - id: AC012
    text: "An adopt/defer/reject decision for structured failure-evidence extraction
      ahead of the evidence-size cap. Current state (M006/AC001):
      executeCommandCheck (src/core/verification/run.ts) captures raw
      stdout+stderr and trims it with the shared tail-preserving trimTail cap
      (src/core/verification/text-trim.ts) — a byte-position decision, not a
      content-aware one; demonstrated live during M006's own CT002/CT012
      recursion-guard incident, where the retained tail landed mid-stack- trace,
      discarding the actual failing test name even though it existed earlier in
      the captured output. The decision must address what 'structured' means
      across arbitrary command output (not only vitest's format), whether
      extraction is a text-trim.ts change or a new, narrowly-scoped step ahead
      of it, and whether it is test-runner- specific pattern matching or
      something more general. Because any adopted mechanism touches production
      verification code (run.ts/text-trim.ts), implementation is deferred to a
      later milestone if adopted, mirroring AC005/AC009's decide-before-build
      discipline — this AC delivers the decision only. This AC's task depends on
      AC001's dogfood evidence task and uses that task's compiled live
      failure-evidence findings (the CT002/CT012 recursion-guard incident,
      captured in docs/evidence/M007/dogfood-evidence.md) as its evidence base,
      rather than re-deriving or re-investigating them independently. Recorded
      at docs/evidence/M007/ structured-failure-extraction-decision.md."
  - id: AC013
    text: "Dispatch/worker protocol hardening from M006's own live incidents,
      implemented as text-only updates (no new Core/CLI code) to
      src/integrations/claude/protocol-worker.md, src/integrations/claude/
      dispatch.md, and src/integrations/claude/protocol-driver.md: (1) a
      dispatched worker must never leave a long-running command (test suite,
      build) backgrounded and unattended — it must wait for it synchronously
      within its own turn, or explicitly report that it is still running and
      why, never simply stop and let the driver infer state from an ambiguous
      final message (M006/T002's incident); (2) every foreground verification
      command, driver- or worker-run, carries an explicit bounded timeout as
      standard practice, not only when a problem is already suspected
      (M006/T002's incident); (3) an empty or non-standard worker report is
      never treated as completion evidence — the driver always independently
      re-derives evidence (read the diff, rerun verification, check for stray
      processes), reinforcing protocol- driver.md's existing independent-review
      discipline explicitly rather than leaving it implicit (M006/T002's
      incident); (4) an explicit, git-free, collision-safe RED-check toggle
      pattern for workers proving a test fails for the right reason — rename via
      Edit/Write into distinctly-named backup files, never a flat same-basename
      scratch directory, and never git for this — replacing the improvised
      pattern a sub-agent reached for during M006/T005 (an unprompted,
      disclosed, blocked-before-execution `git stash` attempt plus a near-miss
      same- basename file collision in a flat scratch directory, both self-
      disclosed and caught before any harm). Because this AC and AC010 both edit
      dispatch.md and protocol-driver.md, this AC's task depends on AC010's task
      and applies its four additions on top of whatever AC010 already committed
      to those two files — never reverting or overwriting AC010's dispatch-mode
      formalization."
verification:
  - id: CT001
    criterion: AC001
    type: review
    instruction: Review docs/evidence/M007/dogfood-evidence.md for completeness and
      accuracy against the actual repository history, including the
      CT012-flakiness investigation's recorded decision and the fresh matched
      inline/sub-agent dispatch pair constructed for AC010.
  - id: CT002
    criterion: AC001
    type: command
    command: npm test
  - id: CT003
    criterion: AC002
    type: manual
    instruction: Confirm the contract-fixed/task-adaptive evaluation reaches an
      explicit adopt/defer/reject decision with supporting evidence, not an
      open-ended discussion.
  - id: CT004
    criterion: AC003
    type: manual
    instruction: Confirm the write_scope-boundary comparison reaches an explicit
      adopt/defer/reject decision with supporting evidence.
  - id: CT005
    criterion: AC004
    type: manual
    instruction: Confirm the ripple-fix policy evaluation cites both M005's and
      M006's standalone-hotfix commits as evidence and reaches an explicit
      adopt/defer/reject decision with, if adopted, a specified mechanism.
  - id: CT006
    criterion: AC005
    type: manual
    instruction: Confirm the quick-change design covers lifecycle,
      approved-verification handling, state/journal storage, crash recovery,
      commit identity, PitWay-Change trailer lookup, cancellation, and
      promotion-to-milestone, includes an exact-file census, addresses the
      85fa243 worked example explicitly, reaches an explicit adopt/defer/ reject
      decision, and that no quick-change implementation code exists in this
      milestone's diff regardless of the decision.
  - id: CT007
    criterion: AC006
    type: manual
    instruction: Confirm the Adaptive Workflow Intensity decision is recorded with
      explicit reasoning tied to AC001-AC005 and AC009-AC010's evidence, and
      that IMPLEMENTATION_PLAN.md is reconciled against M007's actual delivery,
      including any milestone-numbering impact from deferred adoptions.
  - id: CT008
    criterion: AC007
    type: manual
    instruction: Confirm the recovery-path procedure is documented and demonstrably
      covers all four worked examples (M005/T007, M006/T001, M006/T003, M006's
      recursion-guard test-isolation fix) plus the
      new-repository-managed-file-category guidance.
  - id: CT009
    criterion: AC008
    type: command
    command: npm test -- tests/integration/completed-task-revision-path.test.ts
  - id: CT010
    criterion: AC008
    type: manual
    instruction: Confirm docs/evidence/M007/completed-task-revision-path.md
      accurately documents the convention proven by CT009's test, and that no
      new Core/CLI production code was added for this AC.
  - id: CT011
    criterion: AC009
    type: manual
    instruction: Confirm the Claude-skills decision resolves every listed open
      question (glob pickup, schema field, installation strategy, behavioral
      comparison) explicitly and reaches an adopt/defer/reject outcome.
  - id: CT012
    criterion: AC010
    type: manual
    instruction: Confirm the dispatch-mode decision states a concrete rule,
      preserves contract-mandated sub-agent dispatch, and — if adopted — that
      protocol-driver.md and dispatch.md were actually updated in this task.
  - id: CT013
    criterion: AC011
    type: command
    command: npm test -- tests/unit/schemas.test.ts
      tests/integration/task-status.test.ts
  - id: CT014
    criterion: AC012
    type: manual
    instruction: Confirm the structured-failure-extraction decision addresses
      cross-command-format generality and reaches an explicit adopt/defer/
      reject outcome, with implementation correctly deferred rather than built
      in this milestone.
  - id: CT015
    criterion: AC013
    type: manual
    instruction: Review the four protocol-hardening additions against
      protocol-worker.md, dispatch.md, and protocol-driver.md for accuracy
      against the M006/T002 and M006/T005 incidents they codify.
---

# Contract — M007: Dogfood Validation and Adaptive Workflow Intensity Decision

## Objective

Validate PitWay's sequential-MVP workflow against real evidence from its own
development history (M001-M006), evaluate five architectural findings carried
forward from M005/M006's execution (contract-fixed/task-adaptive tasking,
write-scope boundary shape, small ripple-fix policy, task-specific Claude
skills, right-sized dispatch mode), design (but not implement) a lightweight
quick-change workflow for sub-milestone changes, fix one concretely-diagnosed
context-bundle duplication defect, decide (but not implement) a structured
failure-evidence extraction mechanism, define first-class recovery paths for
both defects in already-completed PitWay tooling and completed task
deliverables later found incomplete, harden the dispatch/worker protocol
against M006's own disclosed incidents, and make the Adaptive Workflow
Intensity design decision only once all of that evidence exists. This
milestone gates M008's release increment.

## Scope

- Dogfood evidence compilation: fresh-session resume, sub-agent
  interruption-resume, task-amendment audit, Git traceability audit
  (including all three of M006's standalone hotfixes), CT012-flakiness
  investigation and decision, context-efficiency before/after (against
  M006), and one fresh matched inline/sub-agent dispatch pair.
- Contract-fixed/task-adaptive execution model: evaluate and decide.
- Write-scope boundary shape (exhaustive file list vs. glob/directory +
  protected-path denylist): evaluate and decide.
- Small related ripple-fix policy: evaluate and decide, citing M005's
  standalone hotfixes and all three of M006's.
- Lightweight quick-change/hotfix workflow: design only (full lifecycle,
  storage, recovery, commit-identity, cancellation, and promotion
  specification with an exact file census), adopt/defer/reject decision;
  implementation explicitly out of scope regardless of outcome.
- Claude-code skills adoption: evaluate and decide, resolving every open
  design question named in AC009.
- Right-sized dispatch mode: evaluate and decide; formalize into
  protocol-driver.md/dispatch.md within this same task if adopted (text-only,
  no new code).
- Context-bundle AC-filtering fix: implemented (mapped_ac_ids, additive-
  optional).
- Structured failure-evidence extraction: evaluate and decide only;
  implementation deferred if adopted.
- First-class recovery path for defects in already-completed PitWay tooling,
  demonstrated against four worked examples.
- A supported, tested path (existing commands only, zero new code) to
  deliver corrective work for a previously-completed task's deliverable
  later found incomplete.
- Dispatch/worker protocol hardening from M006's T002 and T005 incidents.
- Adaptive Workflow Intensity design decision, recorded with reasoning.
- Roadmap-reconciliation review against `IMPLEMENTATION_PLAN.md`, including
  milestone-numbering impact from any deferred adoptions.

## Non-Goals

- Building any quick-change Core/CLI mechanism — AC005 is design-only; if
  adopted, implementation is a later, not-yet-numbered milestone.
- Building any Claude-skills implementation — AC009 is strictly
  decision-only; if adopted, implementation is a separately scoped later
  milestone, unconditionally, regardless of when the decision resolves.
- Building any structured-failure-extraction mechanism — AC012 is
  decision-only; if adopted, implementation is a later milestone.
- Building any M009/M010 branch-isolation or parallel-worktree mechanism —
  this milestone's Git traceability audit informs, but does not implement,
  that later work.
- README, packaging, npm publish (M008, or renumbered per AC006's roadmap
  impact if a deferred adoption inserts a new milestone before it).
- Re-opening or amending M005/M006 contracts or their completed task history.
- Deciding the write-scope boundary shape, ripple-fix policy, quick-change
  adoption, skills adoption, dispatch-mode adoption, or structured-failure-
  extraction adoption without evidence — any of these decided ahead of this
  milestone's own dogfood evidence is out of scope and would defeat the
  corresponding AC's purpose.

## Design Decisions

- Every decision in this milestone (AC002, AC003, AC004, AC005, AC006, AC009,
  AC010, AC012) must be evidence-based and explicitly recorded as
  adopt/defer/reject with reasoning — this milestone exists specifically so
  these decisions are not made speculatively ahead of real usage evidence.
- A new mechanism cannot supply real usage evidence before it exists: AC005,
  AC009, and AC012 are all strictly decision-only and defer any resulting
  implementation to a separately scoped later milestone unconditionally,
  rather than building ahead of or during AC006's Adaptive Workflow
  Intensity decision. AC010 and AC013 are the exception — both are text-only
  formalizations of already-observed behavior, not new mechanisms, so they
  implement directly within their own task when adopted.
- AC011 is a concretely diagnosed, already-measured defect fix, not a
  workflow-intensity decision — it is implemented unconditionally in this
  milestone regardless of any AC006 outcome.
- The recovery-path procedure for already-completed-tooling defects (AC007)
  is scoped to a defined process, not a blanket exception — it must state how
  a future occurrence is diagnosed and routed, demonstrated against all
  four worked examples (M005/T007, M006/T001, M006/T003, M006's
  recursion-guard test-isolation fix), not just the first.
- AC008's supported path uses only already-shipped commands and adds zero
  new Core/CLI code — the deliverable is a documented convention plus a
  regression test proving it, not new production mechanism.
- Every write_scope entry in this milestone's own task graph is an exact
  file — never a directory or a glob — including for AC005's design-only
  deliverable and AC013's protocol-hardening updates.

## References

Local `reports/*.md` and `.git/pitway/*-report-notes.md` files cited below
are **supplementary reading only, never authoritative evidence** — both are
untracked, gitignored (`/reports/` in `.gitignore`), and do not survive a
fresh clone. Every claim this contract draws from them is independently
re-derivable from Git history, `.pitway/` state, the test suite, or
`docs/evidence/**` (all committed, authoritative, and clone-durable); AC001's
own dogfood-evidence task re-verifies against those durable sources directly,
never taking a local report's prose as evidence on its own.

- IMPLEMENTATION_PLAN.md Revised Roadmap M007 entry.
- reports/M005.md §7 (verification-hardening defect background), §10 (M007
  carried-forward backlog), and §11 (architectural findings detail:
  contract-fixed/task-adaptive finding, write-scope and ripple-fix findings,
  the completed-task-revision gap, the already-completed-tooling-defect
  finding) — local, supplementary; the underlying commits and journal state
  are the authoritative source.
- .pitway/milestones/M005/tasks.yaml T007 result (task-amend bootstrap
  repair, one of AC007's four worked examples) — authoritative.
- reports/M006.md (the assembled M006 report: the T002 worker-dispatch-
  hygiene findings, the three standalone hotfix incidents, the CT012
  flakiness finding — explicitly unproven, not proven noise — the
  Claude-skills and right-sized-dispatch candidate designs, the T005
  git-command-disclosure and file-collision incident, and the
  structured-failure-extraction candidate) — local, supplementary; this is
  the primary document this contract was reconciled against, but every
  finding it summarizes traces back to the commits, journal entries, and
  test evidence named within it. `.git/pitway/m006-report-notes.md` is the
  private running-notes predecessor reports/M006.md was assembled from — it
  remains in place as a private working file, per standing convention,
  and is not itself cited as a source going forward.
- docs/evidence/M006-context-efficiency.md (context-bundle duplication
  finding, AC011's source measurement) — authoritative, committed.

## Change Log

- (none yet — draft, not confirmed.)
