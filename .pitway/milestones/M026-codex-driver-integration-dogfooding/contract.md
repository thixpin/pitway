---
schema_version: 1
id: M026
title: Codex Driver Integration & Dogfooding
status: in_progress
requirement: null
confirmed_at: 2026-08-22T18:21:52Z
verification_approved_hash: sha256:a380fdb1e4aefbf34b8dc385a296158660216de05a88737162cdeff730729a8c
base_branch: main
base_revision: 7c540b66cf1484adc2aa05b5737fc558a3a76d41
acceptance_criteria:
  - id: AC001
    text: "Codex research is reused as the primary reference:
      docs/evidence/M022/codex.md and docs/evidence/M022/comparison.md findings
      (format, capabilities, skills under .agents/skills chain, custom prompts
      deprecated, agents as TOML in .codex/agents/, AGENTS.md layering, MCP,
      sandbox/approval/rules) are the evidence base for design. No new Codex
      research is repeated unless a specific gap is verified and recorded."
  - id: AC002
    text: "Codex is added as a third first-class PitWay driver following the
      existing driver architecture established by M023:
      src/state/driver-assets.ts hardcodes DRIVERS =
      ['claude','opencode','codex'] and DRIVER_DESTINATION_DIRS =
      {claude:'.claude', opencode:'.opencode', codex:'.codex'}, with the same
      flat static two-tier lookup (src/integrations/<driver>/ first, then
      src/integrations/common/ fallback). No redesign of the driver
      architecture, no new adapter model, no dynamic driver registration, no
      Core AI-provider code, no manifest/template engine."
  - id: AC003
    text: Codex-specific command docs ship under src/integrations/codex/commands/
      (24 canonical + 8 ms-* aliases = 32 files) in the native PitWay
      command-doc format (markdown with description frontmatter, pitway
      invocation). Content mirrors Claude/Opencode command docs for the same
      PitWay CLI surface. Skills and protocol docs (protocol-driver.md,
      protocol-worker.md, dispatch.md, coordination.md, report-format.md,
      lsp-guidance.md, interactive-ux.md) are NOT overridden for Codex; they
      resolve to common/ entirely unless a real, disclosed incompatibility is
      found (named in evidence if so). Stray-override guard passes.
  - id: AC004
    text: pitway init --codex installs the resolved Codex asset set into .codex/
      (skills at .codex/skills/<name>/SKILL.md, commands at
      .codex/commands/<name>.md, protocol docs at .codex/<name>.md root-level,
      mirroring .claude/.opencode layout). Existing drivers remain unaffected
      (Claude default-on and --no-claude, Opencode --opencode still work
      byte-identical). Codex coexists with both without destination collisions
      (disjoint .claude/.opencode/.codex). Generated assets resolve from the
      correct PitWay-managed source (driver wins on collision, common fallback
      otherwise), proven by structural tests.
  - id: AC005
    text: Managed dirty-path recognition (src/state/managed-init-paths.ts and
      src/git/baseline.ts via listSafeManagedDirtyPaths) is extended to also
      recognize installed .codex/ managed paths, so
      milestone-confirm/quick-change create do not refuse on freshly installed
      Codex assets. The required_skills pre-dispatch gate
      (src/core/tasks/skills.ts via listInstalledSkillNames) is extended to
      check .codex/skills alongside .claude/skills and .opencode/skills.
  - id: AC006
    text: A real Codex-driven PitWay workflow executes at least one milestone/task
      end-to-end through the installed Codex driver (command discovery, contract
      handling, task execution, verification, completion) with
      transcript/evidence captured in docs/evidence/M026/codex-dogfood.md.
      Evidence honestly scopes what was executable in this environment (Codex
      CLI availability, sandbox) and does not claim a live Codex session when
      run via emulation.
  - id: AC007
    text: Codex-specific findings and limitations discovered during integration are
      recorded as evidence (docs/evidence/M026/codex-limitations.md) and/or
      backlog items, not silently absorbed into scope. At least the
      .agents/skills vs .codex/skills primary-path conflict, TOML agents vs
      markdown, deprecated custom prompts, and sandbox/approval differences are
      dispositioned. No unrelated backlog fixes and no changes to existing
      drivers beyond what AC003-AC005 requires.
  - id: AC008
    text: Focused integration/unit tests cover Codex driver assets, pitway init
      --codex, multi-driver coexistence, and skill-gate extension; relevant docs
      (README.md, IMPLEMENTATION_PLAN.md if needed) are updated. Full suite and
      tsc --noEmit stay green. M026 is strictly limited to Codex integration,
      verification, and dogfooding.
  - id: AC009
    text: "Governance: any amendment to this contract must be proposed by the agent
      and then stop for explicit developer approval before the contract is
      mutated or execution continues; approval is recorded before the amending
      command runs."
verification:
  - id: CT001
    criterion: AC001
    type: manual
    instruction: Review contract Background and codex.md/comparison.md citations;
      confirm no unnecessary re-research and that gaps are explicitly noted if
      any.
  - id: CT002
    criterion: AC002
    type: command
    command: npx vitest run tests/unit/driver-assets.test.ts
      tests/unit/claude-assets.test.ts tests/unit/codex-assets.test.ts
  - id: CT003
    criterion: AC003
    type: command
    command: npx vitest run tests/unit/codex-assets.test.ts
      tests/unit/claude-assets.test.ts
  - id: CT004
    criterion: AC004
    type: command
    command: npx vitest run tests/integration/init.test.ts
      tests/integration/multi-driver-assets.test.ts
      tests/unit/managed-init-paths.test.ts
  - id: CT005
    criterion: AC005
    type: command
    command: npx vitest run tests/unit/managed-init-paths.test.ts
      tests/unit/skills.test.ts tests/integration/task-status.test.ts
  - id: CT006
    criterion: AC006
    type: manual
    instruction: Review docs/evidence/M026/codex-dogfood.md against the real run it
      documents -- every workflow stage evidenced, findings dispositioned,
      mismatch between claimed Codex session and emulation honestly disclosed if
      applicable.
  - id: CT007
    criterion: AC007
    type: manual
    instruction: Review docs/evidence/M026/codex-limitations.md and backlog for
      disposition of at least the four Codex-specific findings; confirm no
      silent scope expansion.
  - id: CT008
    criterion: AC008
    type: command
    command: npm run build && npm test && npx tsc --noEmit
    timeout_ms: 900000
  - id: CT009
    criterion: AC009
    type: manual
    instruction: Confirm every amendment applied to this contract carries recorded
      explicit developer approval made before the amending command ran.
---

# Contract

## Objective

Add Codex (OpenAI Codex CLI) as a first-class PitWay driver, reusing the findings, format analysis, and integration details already established in `docs/evidence/M022/codex.md` and `docs/evidence/M022/comparison.md`. Follow the existing driver architecture and native integration format established by the current drivers (Claude Code and OpenCode via `src/integrations/claude/`, `src/integrations/opencode/`, `src/integrations/common/`, and `src/state/driver-assets.ts`'s hardcoded two-tier lookup) — no redesign or new adapter model.

## Background

M022 investigated seven agent driver formats, with Codex covered in `docs/evidence/M022/codex.md` (8 dimensions, 9 cited sources, fidelity note) and synthesized in `comparison.md`. Key Codex findings: skills are `SKILL.md` with `name`/`description` under the `.agents/skills` chain (official primary, with secondary reports of `.codex/skills`); custom prompts (`~/.codex/prompts/*.md` → `/prompts:<name>`) are officially deprecated in favor of skills; agents are TOML per-agent files in `.codex/agents/` (fields `name`, `description`, `developer_instructions` plus overrides); instructions are layered `AGENTS.md` (root→CWD, 32 KiB cap); permissions are sandbox_mode × approval_policy × Starlark `.rules`; MCP via `[mcp_servers.*]` tables. M023 then introduced the common driver asset layer (`src/integrations/common/` + `src/state/driver-assets.ts`'s flat static hardcoded lookup over `['claude','opencode']`) and OpenCode integration as the first proof of that architecture. M026 extends it to a third driver, Codex, as the second proof — demonstrating the architecture scales without Core changes, dynamic registration, or provider code.

## Scope

- Register Codex in `src/state/driver-assets.ts` (`DRIVERS` and `DRIVER_DESTINATION_DIRS`).
- Ship Codex command docs under `src/integrations/codex/commands/` (32 files).
- Extend `pitway init` with `--codex` (opt-in, additive, coexistence).
- Extend managed-dirty-path and required_skills gate for `.codex/`.
- Add focused tests and update docs.
- Execute and evidence a real Codex-driven workflow.
- Record Codex-specific limitations as evidence/backlog.

## Non-Goals

- New driver architecture, plugin system, or Core adapter SDK.
- Changes to existing Claude/OpenCode drivers beyond coexistence compatibility.
- Unrelated backlog fixes or new features.
- Repeating Codex research already in M022 unless a gap requires verification.

## Change Log

- 2026-08-23: Draft created for developer review.
