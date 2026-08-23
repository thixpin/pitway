---
schema_version: 1
id: M028
title: Shared Artifact Format References for Driver Assets
status: in_progress
requirement: null
confirmed_at: 2026-08-23T06:24:34Z
verification_approved_hash: sha256:b7c63a6526424402cada446c84a0de14740d7214fc5d0771016396685d3d0369
base_branch: main
base_revision: 9d04d3a382d7b2827015e2f829e596ba72ca9b8c
acceptance_criteria:
  - id: AC001
    text: "A new shared asset src/integrations/common/draft-formats.md documents,
      with one minimal valid example each, the input formats for: a draft
      contract.md (frontmatter fields + body Change Log requirement), a draft
      tasks.yaml, a milestone-confirm --amend contract file (same shape plus an
      appended Change Log entry), a task-add --file single-task definition, a
      task-amend --file partial field object, and a milestone-review record
      --file findings document. Each example is the smallest that validates;
      prose stays under one page per format."
  - id: AC002
    text: A new unit test (tests/unit/draft-formats.test.ts) extracts each fenced
      example from draft-formats.md and validates it against the real production
      parsers (parseContractFile for contract/amend examples; taskSchema via the
      same candidate-building path task-add uses for the task examples;
      reviewRecordInputSchema for findings). The test fails if any documented
      example stops being accepted by the CLI -- documented formats can never
      drift from implemented reality. This test is written first and fails
      before the asset exists (TDD).
  - id: AC003
    text: "Every affected command doc gains a one-line pointer to
      ../draft-formats.md -- across all three installed drivers (claude,
      opencode, codex): milestone-add, ms-add, write-ms-artifacts,
      milestone-confirm, ms-confirm, task-add, task-amend, milestone-review,
      ms-review, task-update. Alias byte-parity is preserved everywhere it
      applies today, shipped-asset structure tests stay green, and the
      claude-assets hash manifest is updated for legitimately changed assets."
  - id: AC004
    text: No Core/CLI behavior changes, no schema changes, no new commands --
      docs-only milestone. Full suite and tsc --noEmit green; working tree clean
      at completion.
  - id: AC005
    text: "Governance: any amendment must be proposed by the agent and stop for
      explicit developer approval before the contract is mutated or execution
      continues; approval recorded before the amending command runs."
verification:
  - id: CT001
    criterion: AC001
    type: manual
    instruction: Review draft-formats.md for completeness (six formats present),
      minimality, and accuracy of surrounding prose.
  - id: CT002
    criterion: AC002
    type: command
    command: npx vitest run tests/unit/draft-formats.test.ts
  - id: CT003
    criterion: AC003
    type: command
    command: npx vitest run tests/unit/claude-assets.test.ts
      tests/unit/opencode-assets.test.ts tests/unit/codex-assets.test.ts
  - id: CT004
    criterion: AC004
    type: command
    command: npm run build && npm test && npx tsc --noEmit
    timeout_ms: 900000
  - id: CT005
    criterion: AC005
    type: manual
    instruction: Confirm every amendment applied to this contract carries recorded
      explicit developer approval made before the amending command ran.
---

# Contract

## Objective

Close the discovered root cause of drivers inspecting PitWay implementation source during milestone creation: installed driver assets never document the input formats of artifact-producing commands. Ship one shared, validation-tested format reference and wire pointers into every affected command doc across all drivers.

## Background

M026-era external dogfooding showed OpenCode reading implementation source to learn draft-file shapes when creating a milestone. Audit confirmed the gap extends beyond milestone-add: amend contracts, task-add/task-amend YAMLs, and review findings all lack installed format references; only USAGE.md (not installed) had examples. All production parsers are importable, so documented examples can be pinned to acceptance by the real validators.

## Scope

- One new common asset (draft-formats.md) with six validated minimal examples.
- One-line pointers in the ten affected command docs per driver.
- Structural/validation test coverage; hash-manifest refresh.

## Non-Goals

- New CLI flags (e.g. template-printing), Core or schema changes.
- Rewriting command docs beyond the added pointer lines.

## Change Log

- 2026-08-23: Draft created from developer-directed audit of artifact-producing commands.
