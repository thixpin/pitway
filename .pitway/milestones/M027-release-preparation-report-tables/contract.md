---
schema_version: 1
id: M027
title: Release Preparation — Report Tables, Approval Gates, Docs Reconciliation
status: completed
requirement: null
confirmed_at: 2026-08-23T04:34:31Z
verification_approved_hash: sha256:fb7b980e5d45d3015fff57bed02a9afa5083be7190c08f5e313446efd724da34
base_branch: main
base_revision: 992bc808fe10efd17b18e845be6d1434bd85a26e
acceptance_criteria:
  - id: AC001
    text: "B022: pitway milestone-status and pitway milestone-status --report render
      their task tables as content-aware fixed-width padded columns -- each
      column width derived from the maximum display width across header and
      cells (Unicode-safe via the existing renderer), consistent padding per
      column -- instead of compact raw markdown pipes. Implemented by enabling
      the existing table renderer's padded mode at exactly these two call sites;
      every other caller of the renderer stays byte-identical. TDD: failing
      assertions on the padded shape land before the implementation change."
  - id: AC002
    text: "The updated workflow diagram ships: docs/assets/workflow.mmd reflects the
      current flows (Quick Change anchored to a completed milestone with
      RED→GREEN, Milestone Merge after Complete, failed-final-test re-plan
      through milestone revision back to execution, Backlog exit),
      docs/assets/workflow.svg is a render of that exact source, and a
      structural test pins the key labels so the SVG cannot silently drift from
      the .mmd again."
  - id: AC003
    text: "B021: the installed driver assets make the human approval gate explicit
      for every driver -- protocol-driver.md's decision-gate section states the
      MUST (never run milestone-confirm/milestone-complete without the
      developer's explicit in-conversation approval; never inferred from 'keep
      going', never from a subagent report), and each driver's
      milestone-confirm/ms-confirm command doc carries the same gate
      instruction. Claude/opencode/codex canonical+alias byte-parity is
      preserved and pinned by the existing asset tests. Honestly disclosed:
      PitWay enforces the wording, never a driver session's obedience --
      detection-and-record discipline, not runtime prevention."
  - id: AC004
    text: "B023: README.md and USAGE.md are reconciled with delivered behavior --
      Codex as third driver (init --codex), quick-change RED→GREEN gate and
      --tdd-exempt, milestone-merge, milestone-review, backlog, racing footer /
      Progress Report -- with no claims beyond what tests/evidence support.
      IMPLEMENTATION_PLAN.md gains an M026 roadmap entry, this milestone's entry
      slot, a refreshed point-in-time status snapshot replacing the M020-era
      one, and the backlog disposition below."
  - id: AC005
    text: package.json gains curated keywords appropriate for discovery (CLI, AI
      coding agents, workflow, the shipped driver names, TDD/milestone terms).
      Version stays 0.2.0 -- bumping to 1.0.0 is a separate developer decision
      at release time, explicitly out of scope here. No publish runs.
  - id: AC006
    text: "Backlog disposition: B021, B022, B023 promoted into this milestone's
      tasks; B024 (backlog auto-promotion/close lifecycle) deliberately remains
      pending -- real but unowned work, not silently absorbed. No unrelated
      fixes; existing driver architecture untouched beyond AC003's asset text.
      Full suite and tsc --noEmit green; working tree clean at completion."
  - id: AC007
    text: "Governance: any amendment to this contract must be proposed by the agent
      and then stop for explicit developer approval before the contract is
      mutated or execution continues; approval is recorded before the amending
      command runs."
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npx vitest run tests/unit/table-renderer.test.ts
      tests/integration/milestone-status.test.ts
  - id: CT002
    criterion: AC002
    type: command
    command: npx vitest run tests/unit/workflow-diagram.test.ts
  - id: CT003
    criterion: AC003
    type: command
    command: npx vitest run tests/unit/claude-assets.test.ts
      tests/unit/opencode-assets.test.ts tests/unit/codex-assets.test.ts
  - id: CT004
    criterion: AC004
    type: manual
    instruction: Review README.md and USAGE.md against delivered behavior (Codex,
      RED→GREEN quick-change, merge, review, backlog, footer/report); review
      IMPLEMENTATION_PLAN.md's M026 entry, status snapshot, and backlog
      disposition against .pitway/backlog.yaml and git history.
  - id: CT005
    criterion: AC005
    type: manual
    instruction: Review package.json keywords list for accuracy/discovery value;
      confirm version field unchanged at 0.2.0.
  - id: CT006
    criterion: AC006
    type: command
    command: npm run build && npm test && npx tsc --noEmit
    timeout_ms: 900000
  - id: CT007
    criterion: AC006
    type: manual
    instruction: Confirm B021-B023 show promoted_to this milestone, B024 still
      pending, and the final diff touches only files named in the tasks'
      write_scopes.
  - id: CT008
    criterion: AC007
    type: manual
    instruction: Confirm every amendment applied to this contract carries recorded
      explicit developer approval made before the amending command ran.
---

# Contract

## Objective

Prepare the repository for the upcoming release by closing the three actionable pending backlog items (B022 report-table formatting, B021 approval-gate hardening, B023 documentation reconciliation), shipping the already-updated workflow diagram, and curating package metadata — strictly scoped, no unrelated fixes, no version bump, no publish.

## Background

M026 (Codex Driver Integration & Dogfooding) completed and merged. Four backlog items accumulated during M026: B021 (drivers auto-running approval-gated commands), B022 (raw markdown table output in milestone-status/--report), B023 (README/USAGE lagging delivered behavior), B024 (backlog auto-promotion lifecycle). The developer directed: fold the first three plus the workflow-diagram update and package-keyword review into one release-preparation milestone; B024 stays backlog. The workflow `.mmd` was hand-updated and its `.svg` re-rendered in the working tree; this milestone commits and guards them.

## Scope

- Padded fixed-width task tables in `milestone-status` and `--report` (renderer capability already exists; call sites opt in).
- Workflow `.mmd`/`.svg` committed together, label-sync proven by a structural test.
- Approval-gate MUST language across `protocol-driver.md` + every driver's `milestone-confirm`/`ms-confirm` docs, byte-parity kept.
- README/USAGE/IMPLEMENTATION_PLAN reconciliation; package.json keywords; backlog promotion bookkeeping.

## Non-Goals

- Version bump to 1.0.0 or any npm publish.
- B024 (auto-promotion/close lifecycle) implementation.
- Any new CLI surface, schema change, or Core behavior change.
- Driver architecture changes beyond AC003's text assets.

## Change Log

- 2026-08-23: Draft created for developer review (release-preparation scoping directive).
