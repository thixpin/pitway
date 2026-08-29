---
schema_version: 1
id: M044
title: Orchestrator Lifecycle & Context Handling
status: completed
requirement: null
confirmed_at: 2026-08-28T18:37:09Z
verification_approved_hash: sha256:0895e474fe0070614cb958e7f29948ec6964eb0f38b83759e464017f92669a99
base_branch: main
base_revision: f69d3448c378a94d4ff567ab87804db809c76b5d
acceptance_criteria:
  - id: AC001
    text: A durable-state audit (docs/architecture/orchestrator-flush-audit.md)
      enumerates every fact an Orchestrator session needs to continue or recover
      a milestone -- task statuses and attempts, live dispatch records, pending
      journal entries, verification results and evidence records, open review
      sessions, pending human decisions, backlog items, the milestone branch --
      and for each names the .pitway/ file or journal record kind that already
      persists it and the pitway command that surfaces it. Any fact found to
      live only in agent context is listed as a gap with a proposed durable
      home, not silently fixed.
  - id: AC002
    text: An integration test proves Orchestrator restart recovery in the identity
      mode M040 Decision 2 selected (persistent per milestone) -- a milestone
      mid-execution with one task in_progress, one task dispatched under
      parallel_worktrees, one pending journal entry, and one open review session
      is re-oriented from `pitway resume` output alone, with no other input, to
      the exact next action the protocol prescribes; M041's two real restarts
      (docs/evidence/M041/split-role-dogfood.md section 4) are the reference
      scenarios.
  - id: AC003
    text: The two protocol-text gaps M041 recorded are decided by the developer in
      conversation and then written into protocol-orchestrator.md -- (i)
      working-tree git operations by the Orchestrator (M041 finding 5-ii;
      options -- adopt the worker's git-free rule, or permit self-reverting
      experiments confined to the current task's write_scope), and (ii)
      ownership of the blocked/failed -> ready recovery transition after a
      developer-approved amendment (M041 finding 5-v; options -- the
      Orchestrator re-runs it on resume, or Decision 1 carves out recovery
      transitions for the Main Agent). Each decision is recorded in
      docs/architecture/orchestrator-role.md as an addendum with rationale and
      rejected alternative, and the M041 partition test still passes.
  - id: AC004
    text: protocol-orchestrator.md's lifecycle section is finalized against the
      audit -- when the Orchestrator may flush its working context (only after
      the milestone's terminal state and only once every AC001 fact is durable),
      what it must never carry into the next milestone, and the restart
      procedure -- with no new mechanism introduced unless AC001 recorded a gap
      the developer approved closing; its pinned sha256 is regenerated.
  - id: AC005
    text: Any gap closure approved from AC001 is additive and read-only on the CLI
      surface (a new resume/milestone-status field or section, never a changed
      existing field), keeps --json output byte-identical when the addition is
      absent, and is recorded as a Change Log amendment before implementation.
      Full suite and typecheck pass.
verification:
  - id: CT001
    criterion: AC001
    type: review
    instruction: Read the flush audit; confirm every listed fact cites a real
      durable location and a surfacing command, and gaps are listed rather than
      fixed.
  - id: CT002
    criterion: AC002
    type: command
    command: npx vitest run tests/integration/fresh-session-resume.test.ts
      tests/integration/resume.test.ts
  - id: CT003
    criterion: AC003
    type: review
    instruction: Confirm both M041 gaps have a developer-approved decision recorded
      as an addendum in docs/architecture/orchestrator-role.md with rationale
      and rejected alternative, and that protocol-orchestrator.md states the
      decided rules.
  - id: CT004
    criterion: AC004
    type: command
    command: npx vitest run tests/unit/claude-assets.test.ts
      tests/unit/codex-assets.test.ts tests/unit/opencode-assets.test.ts
  - id: CT005
    criterion: AC005
    type: command
    command: npm run typecheck && npm test
    timeout_ms: 900000
---

# Contract

> Depends on M040 (decisions), M041 (dogfood evidence, findings 5-ii and
> 5-v), and M043 (documentation alignment), all completed and merged into
> main. M040 Decision 2 (persistent Orchestrator identity per milestone,
> flushed at terminal state) is the fixed input; it is not re-decided here.

## Objective

Make the Orchestrator's working context safely disposable and its rules
complete: prove that everything needed to continue or recover a milestone
already lives in durable PitWay state, define exactly when and how the
Orchestrator flushes and restarts, and close the two protocol-text gaps the
M041 dogfood exposed -- each by an explicit developer decision -- without
adding to Core unless the audit finds a real gap the developer approves
closing.

## Scope / tasks

- T001 Durable-state audit against real .pitway/ files and journal kinds.
- T002 Orchestrator-restart recovery integration test from `pitway resume`
  alone, modelled on M041's two real restarts.
- T003 Decide and record the two M041 protocol-text gaps (developer
  presented each option in conversation before recording).
- T004 Finalize protocol-orchestrator.md's lifecycle and rule text;
  regenerate its pinned hash.
- T005 (conditional, amendment-gated) close an approved audit gap
  additively; cancelled if the audit found none.
- T006 Full gate.

T001, T002, and T003 are independent; T004 depends on T001 and T003; T005
depends on T001; T006 depends on all.

## Dependencies

- M040, M041, M043 completed and merged -- satisfied.
- M040 Decision 2 fixed; Decision 1 amended only by the AC003 addendum if
  option (ii-b) is chosen.

## Non-Goals

- Session or identity registries, transcripts, or any persistence of agent
  context -- durable state is .pitway/ and the journal only.
- Depending on any AI session identifier for resume (standing rule).
- Runtime role checks in Core; any usage, telemetry, or schema work (the
  usage-schema migration draft owns that, re-scoped against
  docs/evidence/M042/synthesis.md section 9).
- Rewording any protocol rule other than the two decided gaps and the
  lifecycle section.

## Change Log

- 2026-08-28: Follow-up draft created from the M040 architecture review
  (provisional label M042).
- 2026-08-29: Registered as M044 -- next sequential id after M043 -- with
  M041's two protocol-text gaps folded in as AC003/T003 and the restart
  test anchored on M041's real restarts.
- 2026-08-29: T005 activated (developer-approved, per AC005). The T001
  audit found two gaps -- G1: pending journal entries are tolerated but not
  listed on any read-only surface; G2: a pending verification repair is not
  visible on resume. Closing both additively: resume gains read-only fields
  `pendingJournal` (type, target, operationId per pending entry for the
  active milestone) and `pendingRepair` (id, files, checks), each absent
  when empty so existing --json output stays byte-identical, plus matching
  human sections; tests added; M044/T002's deliberate 'not listed'
  assertion is flipped to assert the new field. No existing field changes.
