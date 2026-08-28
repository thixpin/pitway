---
schema_version: 1
id: M041
title: Orchestrator Protocol Adoption & Split-Role Dogfood
status: completed
requirement: null
confirmed_at: 2026-08-28T12:54:28Z
verification_approved_hash: sha256:98cffec5fdabdc8b4848409d26be4ef56c44321bb41e1c624ec3ec51970b0b6c
base_branch: main
base_revision: ab3e5253cf7b3ffcce0d314401228436ebb1fe6d
acceptance_criteria:
  - id: AC001
    text: Every shipped command doc (src/integrations/common/commands/*.md and the
      claude/ overrides) carries a one-line role annotation -- Main Agent,
      Orchestrator, or either (read-only) -- exactly matching M040 Decision 1's
      partition table; ms-* aliases stay byte-identical to their canonical docs;
      claude override bodies stay byte-identical to common/.
  - id: AC002
    text: protocol-orchestrator.md and protocol-driver.md describe the same
      partition (no contradiction), and the partition is asserted by a test that
      derives the expected role of each command doc from
      docs/architecture/orchestrator-role.md's table rather than a second
      hardcoded list.
  - id: AC003
    text: One real PitWay milestone (this one or a designated sibling) is executed
      with the Main Agent and the Orchestrator as two separate sessions
      following their respective protocol docs, with the Orchestrator running as
      one persistent identity for the whole milestone per M040 Decision 2, and
      the run is recorded under docs/evidence/M041/ -- which commands each role
      ran (checked against M040 Decision 1's partition), every human decision
      surfaced via the Main Agent, any restart and whether resume alone
      re-oriented it, any protocol gap found, and whether protocol-enforcement
      of the boundary was sufficient.
  - id: AC004
    text: No Core/CLI/State/Git source changes; no CLI output changes; all pinned
      common/claude asset hashes regenerated for touched docs and every
      untouched one passes unmodified; full suite passes.
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npx vitest run tests/unit/claude-assets.test.ts
      tests/unit/codex-assets.test.ts tests/unit/opencode-assets.test.ts
  - id: CT002
    criterion: AC002
    type: command
    command: npx vitest run tests/unit/claude-assets.test.ts
  - id: CT003
    criterion: AC003
    type: review
    instruction: Read docs/evidence/M041/split-role-dogfood.md. Confirm both roles'
      command usage is listed, every human decision went through the Main Agent,
      and the sufficiency verdict on protocol-enforcement is stated with
      evidence.
  - id: CT004
    criterion: AC004
    type: command
    command: npm run typecheck && npm test
    timeout_ms: 900000
---

# Contract

> Depends on M040 (Orchestrator Role Architecture, completed and merged at
> 0b985b2). M040's approved decisions are the source of truth here and are
> not re-decided: Decision 1 (the CLI responsibility partition and approval
> boundaries in docs/architecture/orchestrator-role.md) and Decision 2
> (persistent Orchestrator identity per milestone, flushed at the
> milestone's terminal state, never carried into the next milestone).

## Objective

Adopt the Orchestrator role in the shipped driver protocol: annotate every
command doc with its owning role, keep protocol-driver.md and
protocol-orchestrator.md consistent, and prove the split works by running
one real milestone with the two roles as separate sessions -- the first
evidence on whether a protocol-enforced boundary is enough.

## Scope / tasks

- T001 Role annotations on all command docs (common/ and claude/ overrides
  in lockstep), pinned hashes regenerated.
- T002 Partition-consistency test deriving expectations from the decision
  record's table.
- T003 Split-role dogfood run and evidence record under docs/evidence/M041/.
- T004 Full gate.

## Dependencies

- M040 completed and merged (Decisions 1-2 final).
- The dogfood exercises M040 Decision 2 as approved: one Orchestrator
  identity persists for the whole dogfood milestone, is flushed only after
  the milestone reaches its terminal state, and carries nothing into any
  later milestone. The evidence record states that this mode was used and
  notes any restart that occurred and whether re-orientation from
  `pitway resume` alone sufficed.

## Non-Goals

- Any runtime orchestration: no orchestrator/scheduler/session code, no
  role checks in Core (a possible later milestone, only if the dogfood shows
  protocol-enforcement insufficient), no change to how any command behaves.
- Any token telemetry or usage attribution work (the Token Telemetry Spike
  and usage-schema migration drafts own that).
- Re-deciding or reinterpreting M040's partition, identity, or approval
  boundaries; a conflict with them is a scope conflict to surface, not a
  local judgment call.
- Rewording any existing protocol rule; changes are additive annotations
  and cross-references only.

## Change Log

- 2026-08-28: Follow-up draft created from the M040 architecture review.
- 2026-08-28: Tightened before confirmation -- identity mode pinned to the
  approved M040 Decision 2 (persistent per milestone, flushed at terminal
  state); non-goals extended to exclude runtime orchestration, telemetry,
  and any re-decision of M040's partition/approval boundaries.
