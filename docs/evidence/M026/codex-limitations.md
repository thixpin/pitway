# M026 Codex Integration — Specific Findings and Limitations

Date: 2026-08-23 · Milestone: M026 (Codex Driver Integration & Dogfooding) · Source: `docs/evidence/M022/codex.md` + `comparison.md` (8 dimensions)

This document records Codex-specific findings discovered during M026 integration, their disposition, and honest scoping. No finding silently expanded scope; each is either accepted as a limitation for M026, dispositioned via the chosen destination/layout, or captured as a backlog item where appropriate. At least 4 findings are dispositioned per AC007.

---

## 1. Skills primary path: `.agents/skills` (official) vs `.codex/skills` (secondary)

- **Finding**: `codex.md §1` (Build skills) documents the official Codex skills chain as `$CWD/.agents/skills` → parent → `$REPO_ROOT/.agents/skills` → `$HOME/.agents/skills` → `/etc/codex/skills`. Secondary guides (agensi.io, agentskillshub.dev) report `~/.codex/skills` / `.codex/skills` as the path; `comparison.md §1` carries this as an unresolved conflict. Cursor's official doc also lists `.codex/skills` as a compatibility read.
- **PitWay choice for M026**: Install Codex skills to `.codex/skills/<name>/SKILL.md` (isolated, disjoint from `.claude`/`.opencode`/`.agents`). This mirrors `DRIVER_DESTINATION_DIRS[codex]='.codex'` and keeps `DRIVERS` flatMap handling for `listSafeManagedDirtyPaths` and `classifyDriverAssets` simple and collision-free.
- **Consequence**: A Codex installation that only scans `.agents/skills` (per official docs primary) will not discover PitWay's `.codex/skills` without an additional lookup. In practice, PitWay's common skills installed via `.codex` are still discoverable by Codex if the user configures Codex to also scan `.codex/skills` (secondary path) or via a symlink/copy to `.agents/skills`. The neutral shared dir `.agents/skills` is intentionally not used by PitWay's installer to avoid cross-driver pollution (multiple drivers' skills would collide there).
- **Disposition**: Accepted as a documented limitation for M026. Honest scoping in `codex-dogfood.md` notes the emulation vs live Codex TUI. No scope expansion to a dual-destination installer. If Codex usage via PitWay in the wild shows discovery gaps, a follow-up can add an opt-in `pitway init --codex --agents-skills` dual-install or a `post-install` symlink, captured as a future backlog item, not M026.

---

## 2. Agents: TOML per-agent files vs PitWay's markdown

- **Finding**: `codex.md §3` (Subagents) – Codex custom agent roles are TOML files, one per agent, in `~/.codex/agents/` or `.codex/agents/` (fields `name`, `description`, `developer_instructions` plus `model`, `sandbox_mode`, `mcp_servers`, `skills.config` overrides). PitWay's agent artifacts are markdown files with YAML frontmatter (body = prompt) in `src/integrations/common/skills/` and command docs, plus the `protocol-worker.md` bounded context. Codex's `spawn_agent` tool name is secondary evidence only (GitHub issue #14579).
- **PitWay choice for M026**: Do not ship Codex-native TOML agent files. PitWay's driver docs (`src/integrations/codex/commands/*.md` + `protocol-worker.md`) are the instruction surface Codex reads via its shell/markdown tooling. A Codex session would still spawn subagents prompt-driven (“spawn one agent per point”) as `codex.md` describes, but PitWay does not generate ` .codex/agents/*.toml` for the agent.
- **Consequence**: A Codex installation that expects ` .codex/agents/*.toml` for role-scoped model/sandbox/MCP overrides will not get PitWay-specific roles out of the box. The worker brief (`protocol-worker.md` + `pitway task-status --context` bundle) still works as bounded context, but per-agent model/permission scoping must be done via Codex's global `[agents]` table or manually, not via PitWay-generated TOML.
- **Disposition**: Accepted. No TOML generation in M026. If dogfooding shows Codex benefits from a dedicated `pitway-worker.toml` (e.g., `sandbox_mode = "workspace-write"`), a follow-up can add `src/integrations/codex/agents/pitway-worker.toml` as a driver-specific override, captured as backlog, not M026 scope.

---

## 3. Commands: custom prompts (`~/.codex/prompts/*.md` → `/prompts:<name>`) deprecated in favor of skills

- **Finding**: `codex.md §2` (Commands) – Codex custom prompts are markdown files in `~/.codex/prompts/` invoked as `/prompts:<name>` with frontmatter `description` + `argument-hint`, but are **officially deprecated**: “Use skills for reusable instructions that Codex can invoke explicitly or implicitly.” The CLI also has built-in slash commands (`/permissions`, `/model`, etc.) and `codex exec` subcommands.
- **PitWay choice for M026**: Ship PitWay CLI reference as `src/integrations/codex/commands/*.md` (32 files, `description` frontmatter, `pitway <command>` invocation) installed to `.codex/commands/*.md` – the same driver-asset layout as `.claude/commands/*.md` and `.opencode/commands/*.md`. This is a PitWay driver doc, not a Codex-native `~/.codex/prompts/*.md` prompt. Codex reads it as a markdown reference via its file tools, not as a registered `/prompts:<name>` command.
- **Consequence**: A Codex session will not surface PitWay commands as native `/prompts:<name>` completions. Discovery is via file read (`ls src/integrations/codex/commands/` or `.codex/commands/`) or via the installed `protocol-driver.md` pointer, which is the same for Claude/OpenCode. This is consistent with `comparison.md §2` finding that 3/7 tools (including Codex and Claude Code) are folding commands into skills – “explicitly-invocable prompt with a description” is the durable abstraction, not “command file as distinct artifact.”
- **Disposition**: Accepted. No `~/.codex/prompts/*.md` generation in M026. If Codex dogfooding shows `/prompts` completion is valuable, a follow-up could generate a `prompts/` mirror from the command docs, but it would be a deprecated surface, so likely not. Documented here, not expanded.

---

## 4. Permissions: sandbox_mode × approval_policy × Starlark `.rules` (deepest stack)

- **Finding**: `codex.md §8` (Permissions) – Codex has three interlocking mechanisms: `sandbox_mode` (`read-only` | `workspace-write` (default) | `danger-full-access`), `approval_policy` (`untrusted` | `on-request` | `never` | granular `{sandbox_approval, rules, mcp_elicitations, request_permissions, skill_approval}`), and Starlark `prefix_rule()` exec-policy files in `rules/` per config layer. Plus network proxy allow/deny, protected paths (`.git`, `.agents`, `.codex`), and trust gating for `.codex/` config. This is “the richest of the eight dimensions” per `codex.md` and `comparison.md §8`.
- **PitWay choice for M026**: No PitWay-owned `rules/*.rules` or `config.toml` is shipped for Codex. PitWay's `protocol-driver.md` and `dispatch.md` already instruct the driver to run only the task's declared verification command, with bounded timeout, and to never leave a long-running command backgrounded – the same guidance that works for Claude/OpenCode. A Codex installation's `sandbox_mode`/`approval_policy` is left to the developer's `~/.codex/config.toml` or `.codex/config.toml` (project, trusted) – PitWay does not generate or override it.
- **Consequence**: A fresh `pitway init --codex` does not pre-configure a Codex sandbox or approval policy for PitWay. A Codex session will run with its default `workspace-write` + `untrusted` unless the developer configures otherwise. PitWay's `listSafeManagedDirtyPaths` and `task-dispatch` worktree isolation still hold, but Codex's OS-level sandbox is an additional layer PitWay does not manage.
- **Disposition**: Accepted as a documented limitation. No `config.toml` or `.rules` shipped in M026. If dogfooding shows Codex needs a recommended `sandbox_mode = "workspace-write"` + `approval_policy = "untrusted"` starter, a follow-up can add `docs/evidence/M022/codex.md`-cited `config.toml` snippet to `README.md` or a `src/integrations/codex/config.toml.example`, captured as backlog, not M026 scope.

---

## 5. Additional notes (not blockers)

- **AGENTS.md layering** (`codex.md §4`): Codex discovers `AGENTS.md` root→CWD (global `~/.codex/AGENTS.md` first, then git-root→CWD chain, 32 KiB cap, concatenation root-downward). PitWay's `AGENTS.md` managed block (`<!-- pitway:managed:start -->`) is installed at repo root via `pitway init` (shared across drivers). This is native for Codex (preferred over `CLAUDE.md`), so no driver-specific override is needed – verified by `listSafeManagedDirtyPaths` including `AGENTS.md` and by `init` tests. No finding.
- **MCP** (`codex.md §7`): `[mcp_servers.*]` TOML tables. PitWay does not ship MCP config for Codex in M026; Codex's `codex mcp add` remains manual. Consistent with `comparison.md` that MCP is de facto (6/7) but tool naming diverges – PitWay's `dispatch.md` already abstracts tool scoping per-agent. No M026 change.
- **Hardcoded literals follow-up**: `src/state/claude-assets.ts:listInstalledSkillNames` and `src/cli/commands/init.ts` preservedAssets/install still use literal `'.claude/.opencode/.codex'` arrays rather than deriving from `DRIVERS`/`driverDestinationDir` – noted in the second M026 review as a 4-minor follow-up, accepted for M026, captured for later.

---

## Backlog capture

- `B021` already captures the driver-independent human approval gate enforcement discovered during M026 review – a cross-driver MUST, not Codex-specific.
- No new Codex-specific backlog items are opened in M026 beyond this evidence file; the four findings above are dispositioned as accepted limitations for M026. If a follow-up proves load-bearing (e.g., `.agents/skills` discovery gap), it will be opened as `pitway backlog add` against M026 or its successor milestone per `protocol-driver.md` Choosing a correction mechanism.

---

## No silent scope expansion

M026 stayed strictly limited to Codex driver registration, command docs, `pitway init --codex`, managed-dirty-path and skill-gate extension, focused tests, and dogfooding evidence. No changes to existing Claude/OpenCode drivers beyond the additive `DRIVERS`/`DRIVER_DESTINATION_DIRS` registry and the `listInstalledSkillNames` extension, and no unrelated backlog fixes. Every Codex-specific decision above was recorded here rather than silently absorbed.
