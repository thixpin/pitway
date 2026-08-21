---
schema_version: 1
id: M022
title: Agent Driver Format Research
status: completed
requirement: null
confirmed_at: 2026-08-21T19:24:33Z
verification_approved_hash: sha256:2dcfa17a9c8cb348c2d68eb07a41a13b7b333aeeb2b6214b06d0caf59f63e1e5
base_branch: main
base_revision: 8e803c74c6db30ce5db1fc071b0589039ba838e5
acceptance_criteria:
  - id: AC001
    text: "Scope discipline: this milestone is investigation-only. No code under
      src/ changes; write_scope is restricted to new files under
      docs/evidence/M022/. No new driver adapter is implemented, and no change
      is made to Core's provider-agnosticism constraint ('Core must never import
      AI-provider code... No other adapters, no plugin system in MVP',
      CLAUDE.md). Any recommendation to build a canonical PitWay-native format,
      an OpenCode driver, or `pitway update` is a separate, later decision
      requiring explicit developer sign-off before any implementation task is
      drafted -- this milestone's deliverable is real, sourced findings, never a
      decision to act on them."
  - id: AC002
    text: "Real, sourced research (cited real documentation/source URLs, never
      invented) on Claude Code's and OpenCode's own representations of: skills,
      commands, agents, rules/instructions, metadata, arguments, tools, and
      permissions -- all 8 dimensions for each tool, or an explicit 'not
      applicable / no such concept' note per dimension where genuinely true,
      never silently skipped."
  - id: AC003
    text: Same 8-dimension real, sourced research for Codex and Cursor.
  - id: AC004
    text: Same 8-dimension real, sourced research for GitHub Copilot and Gemini CLI.
  - id: AC005
    text: Same 8-dimension real, sourced research for Aider.
  - id: AC006
    text: "A synthesis document (docs/evidence/M022/comparison.md) grounded in
      AC002-AC005's own per-tool findings (never asserted independently of them)
      identifies: capabilities common across most/all 7 tools (candidates for a
      shared representation), and capabilities that are genuinely
      driver-specific (candidates that would not generalize). Every claim in the
      synthesis traces back to a specific tool's own documented finding -- no
      new research invented at synthesis time."
  - id: AC007
    text: "Write-scope discipline is verifiable directly: the milestone's full diff
      touches only new files under docs/evidence/M022/, nothing else. No src/ or
      tests/ file is created, modified, or deleted."
verification:
  - id: CT001
    criterion: AC001
    type: manual
    instruction: Confirm via git diff --stat that only docs/evidence/M022/ files
      were added, and that no MVP-boundary code change or new driver adapter was
      implemented.
  - id: CT002
    criterion: AC002
    type: manual
    instruction: Review docs/evidence/M022/claude-code.md and opencode.md for real
      citations and 8-dimension coverage.
  - id: CT003
    criterion: AC003
    type: manual
    instruction: Review docs/evidence/M022/codex.md and cursor.md for real citations
      and 8-dimension coverage.
  - id: CT004
    criterion: AC004
    type: manual
    instruction: Review docs/evidence/M022/github-copilot.md and gemini-cli.md for
      real citations and 8-dimension coverage.
  - id: CT005
    criterion: AC005
    type: manual
    instruction: Review docs/evidence/M022/aider.md for real citations and
      8-dimension coverage.
  - id: CT006
    criterion: AC006
    type: manual
    instruction: Review docs/evidence/M022/comparison.md; spot-check that several of
      its claims trace back to specific per-tool findings.
  - id: CT007
    criterion: AC007
    type: manual
    instruction: At milestone-complete time, review the full milestone diff
      (baseline commit to HEAD) and confirm every changed path is under
      docs/evidence/M022/ -- no src/ or tests/ file touched.
---

# M022: Agent Driver Format Research

## Background

Task 3 of the developer's original multi-stage spec (see M020's own
Background section for the fuller context): research how 7 agent coding
tools -- Claude Code, OpenCode, Codex, Cursor, GitHub Copilot, Gemini CLI,
Aider -- each represent skills, commands, agents, rules/instructions,
metadata, arguments, tools, and permissions, and identify common vs.
driver-specific capabilities. Per the developer's own explicit staging
decision ("Split into stages. Keep research/design separate from
implementation, and require an explicit architecture decision before
changing the MVP boundary"), this is Stage 3: research only. Stage 1
(the missing `ms-merge` alias) and Stage 2 (B004/B005, delivered as M020)
are already complete.

## Design Decisions

- **No MVP-boundary decision here.** CLAUDE.md's binding architecture
  constraint ("No other adapters, no plugin system in MVP... Core must
  never import AI-provider code") is not revisited by this milestone. This
  milestone produces findings; a future milestone would need to present the
  canonical-format/OpenCode-driver/`pitway update` design *and* the
  MVP-boundary reversal explicitly, for separate developer sign-off, before
  any of that is implemented.
- **Real research, not recall.** Every per-tool document must cite real
  sources (official docs, changelogs, or primary repos) rather than rely on
  possibly-stale training-data recall, especially for tools that evolve
  their config format over time.
- **Task shape**: four independent per-tool-cluster research tasks
  (parallel-eligible, disjoint file scope) feeding one synthesis task.

## Change Log

- 2026-08-22: Initial draft.
