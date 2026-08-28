---
schema_version: 1
id: M043
title: Driver Documentation Alignment for the Orchestrator Role
status: in_progress
requirement: null
confirmed_at: 2026-08-28T18:11:23Z
verification_approved_hash: sha256:73892b6e521645f333ac9e08e620118f3e99d737e6e70f8097af3d7a799cf96e
base_branch: main
base_revision: 1a5c4d8b1e301db5005631220c6e298f0c434f33
acceptance_criteria:
  - id: AC001
    text: README.md and USAGE.md each gain one short section describing the three
      roles -- Main Agent, Orchestrator, Worker -- with what each does, which
      protocol doc it loads (protocol-driver.md, protocol-orchestrator.md,
      protocol-worker.md), and that the Main/Orchestrator boundary is
      protocol-enforced (detected in review, never prevented at runtime); the
      "Which Workflow Should I Use?" guide is unchanged except for a pointer to
      the role section.
  - id: AC002
    text: The root instruction blocks installed by pitway init (AGENTS_MD_BLOCK and
      CLAUDE_MD_BLOCK in src/state/root-instructions.ts) reference
      protocol-orchestrator.md beside protocol-driver.md; a repo carrying the
      previous block classifies as block_mismatch and migrates on init
      --reconfigure with no other content of its AGENTS.md / CLAUDE.md touched;
      unit and init integration tests cover both.
  - id: AC003
    text: dispatch.md, coordination.md, and report-format.md gain only the
      cross-references needed to name which role performs each step; no existing
      rule in any of them is reworded or removed; every touched asset's pinned
      sha256 in tests/unit/claude-assets.test.ts is regenerated and every
      untouched one passes unmodified; the M041 partition-consistency test still
      passes.
  - id: AC004
    text: Evidence-driven corrections are applied with their finding cited -- (a)
      docs/evidence/M041/split-role-dogfood.md section 6 no longer joins the two
      Orchestrator readings with "+", restated per
      docs/evidence/M042/synthesis.md section 6 as readings of an
      undetermined-semantics figure with no session total; (b)
      docs/architecture/orchestrator-role.md Decision 1 names the ms-review
      alias on the Orchestrator row (M041 finding 5-iv); (c) the
      protocol-orchestrator.md "not installed here" finding (M041 5-iii) is
      addressed as a documented developer step -- the README role section states
      that existing installs need pitway init --reconfigure to receive the new
      protocol asset -- not by running init in this repository.
  - id: AC005
    text: No Core, CLI, State, or Git behavior change except one bounded,
      precedent-backed addition in src/state/root-instructions.ts -- the exact
      previous managed-block text (frozen byte-for-byte, like the LEGACY_*
      forms) is recognised and rewritten to the new block on init --reconfigure,
      while any other differing managed block stays block_mismatch and is
      preserved untouched; no change under src/integrations/ other than the
      additive cross-references of AC003; full suite and typecheck pass.
verification:
  - id: CT001
    criterion: AC001
    type: review
    instruction: Read the README and USAGE role sections; confirm accuracy against
      docs/architecture/orchestrator-role.md and the three protocol docs, and
      that the workflow guide gained only a pointer.
  - id: CT002
    criterion: AC002
    type: command
    command: npx vitest run tests/unit/root-instructions.test.ts
      tests/integration/init.test.ts
  - id: CT003
    criterion: AC003
    type: command
    command: npx vitest run tests/unit/claude-assets.test.ts
      tests/unit/codex-assets.test.ts tests/unit/opencode-assets.test.ts
  - id: CT004
    criterion: AC004
    type: review
    instruction: Confirm M041 section 6 contains no "+" between the readings and
      cites synthesis section 6; the Decision 1 Orchestrator row names
      ms-review; the README states the init --reconfigure step; each cites its
      finding.
  - id: CT005
    criterion: AC005
    type: command
    command: npm run typecheck && npm test
    timeout_ms: 900000
---

# Contract

> Depends on M040 (Orchestrator role architecture), M041 (protocol
> adoption and split-role dogfood), and M042 (telemetry spike), all
> completed and merged into main (0b985b2, 116bbe2, 1a5c4d8). This is the
> user-facing-documentation half of adopting the role split, plus the
> documentation corrections those three milestones' evidence demands.

## Objective

Make the role split discoverable to a developer and to a fresh driver
session: project docs, installed root-instruction blocks, and the
supporting protocol docs all name the three roles and where each role's
rules live -- without rewording any rule those docs already state. Apply
the documentation corrections M041 and M042 produced as evidence, each
citing its finding, so no shipped document contradicts the measured record.

## Scope / tasks

- T001 README/USAGE role sections (with the init --reconfigure note for
  existing installs).
- T002 Root-instruction block update with migration classification tests.
- T003 Role cross-references in dispatch.md / coordination.md /
  report-format.md; pinned hashes regenerated.
- T004 Evidence corrections: M041 section 6 restatement; Decision 1
  ms-review alias.
- T005 Full gate.

T001-T004 are independent; T005 depends on all four.

## Dependencies

- M040, M041, M042 completed and merged -- satisfied.
- M040 Decisions 1-2 and the M042 synthesis are the source of truth for
  every statement here; a conflict with them is a scope conflict to
  surface, never a local edit.

## Non-Goals

- Command-doc role annotations (done in M041) and any change to their
  bodies.
- The two protocol-text gaps M041 found (Orchestrator working-tree git
  operations; blocked -> ready transition ownership) -- these belong to the
  lifecycle follow-up, which decides them before any protocol wording
  changes.
- Any usage/telemetry/schema work; any change to protocol-orchestrator.md
  or protocol-driver.md beyond what AC003 allows (none planned).
- Running pitway init --reconfigure in this repository as part of a task.
- website/ content; version bump, CHANGELOG, or release preparation.

## Change Log

- 2026-08-28: Follow-up draft created from the M040 architecture review
  (provisional label M045).
- 2026-08-29: Registered as M043 -- next sequential id after M042 -- with
  the M041/M042 evidence corrections folded in (AC004) and the M041
  protocol-text gaps explicitly deferred to the lifecycle follow-up.
- 2026-08-29: AC005 amended during T002 (developer-approved). Core's
  existing rule preserves any differing managed block (block_mismatch),
  so changing the block text alone would leave every existing install --
  this repository included -- without the new protocol-orchestrator.md
  pointer. AC002's migration therefore needs one bounded Core addition: the
  exact previous managed block is frozen and rewritten to the new block on
  init --reconfigure, exactly as the pre-B008 LEGACY_* forms already are;
  user-authored or otherwise-differing blocks remain preserved.
