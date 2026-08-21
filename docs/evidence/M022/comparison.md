# Agent Driver Formats — Cross-Tool Comparison (M022/T005)

- **Date**: 2026-08-22
- **Inputs** (the only evidence base for this document — all in `docs/evidence/M022/`):
  1. `claude-code.md` — Claude Code (T001)
  2. `opencode.md` — OpenCode (T001)
  3. `codex.md` — Codex / OpenAI Codex CLI (T002)
  4. `cursor.md` — Cursor (T002)
  5. `github-copilot.md` — GitHub Copilot (T003)
  6. `gemini-cli.md` — Gemini CLI (T003)
  7. `aider.md` — Aider (T004)

**Method**: pure synthesis. Every claim below traces to a specific finding in one of the seven per-tool files (cited as `file.md §section`; the per-tool file's own source URL is repeated where load-bearing). No new research was done at synthesis time. Where a per-tool file marked a claim as conflicting, secondary, or unverified, that status is carried forward here unchanged — nothing is resolved by fiat. Two of the input files (`codex.md`, `cursor.md`) carry explicit fidelity notes that their extractions went through a summarizing fetch step; conclusions resting on them inherit that caveat.

**Tally convention**: "n/7" counts tools whose own evidence file documents the capability. Aider is a genuine outlier on several dimensions (`aider.md` states this about itself: "Several dimensions below are therefore honest 'not applicable' findings — that absence is itself the evidence"), so many strong convergences are 6/7 with Aider as the honest N/A.

---

## 1. Skills

### Common

- **The Agent Skills open standard is the single strongest convergence in this research: 6/7 tools implement `SKILL.md` — a directory per skill containing a `SKILL.md` file with YAML frontmatter whose load-bearing fields are `name` and `description`.**
  - Claude Code: `SKILL.md` with frontmatter, "Skills follow the Agent Skills open standard (<https://agentskills.io>), which Claude Code extends" (claude-code.md §1, <https://code.claude.com/docs/en/skills>).
  - OpenCode: "supports the Agent Skills format natively — one `SKILL.md` per skill directory"; required `name` + `description`, matching "the portable Agent Skills spec subset" (opencode.md §1, <https://opencode.ai/docs/skills/>).
  - Codex: skill = directory with `SKILL.md`, frontmatter `name`, `description` (codex.md §1, <https://developers.openai.com/codex/skills>).
  - Cursor: skill = folder containing `SKILL.md`; required `name` + `description` (cursor.md §1, <https://cursor.com/docs/skills>).
  - Copilot: "GitHub documents the Agent Skills specification as an open standard used by a range of AI systems"; required `name` + `description` (github-copilot.md §1, <https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-skills>).
  - Gemini CLI: "implements Agent Skills based on the same open standard Copilot and Claude Code use"; fields `name`, `description` (gemini-cli.md §1, docs/cli/skills.md, docs/cli/creating-skills.md).
  - Aider: **not applicable** — "no skills concept is documented"; nearest analogs are conventions files and `/save`+`/load` command replay (aider.md §1).
- **Description-driven automatic invocation** is common to all six skill-bearing tools: the agent decides to load a skill by matching the conversation against the skill's `description` (claude-code.md §1; opencode.md §1 — agent sees name+description and calls `skill({name})`; codex.md §1 — "Codex selects a skill automatically when the task matches its `description`"; cursor.md §1; github-copilot.md §1; gemini-cli.md §1 — `description` is "CRITICAL. This is how Gemini decides when to use the skill").
- **Lazy body loading** — only name+description in ambient context, full body injected on invocation — is documented for Claude Code (claude-code.md §1), OpenCode (`skill` tool, opencode.md §1), Gemini CLI (`activate_skill` tool, gemini-cli.md §1), Copilot ("when chosen, `SKILL.md` is injected into the agent's context", github-copilot.md §1), and Cursor ("loaded dynamically when judged relevant", cursor.md §1).
- **Explicit slash/name invocation** alongside auto-invocation: `/skill-name` in Claude Code (claude-code.md §1), Cursor (cursor.md §1), Copilot `/SKILL-NAME` (github-copilot.md §1); Codex uses `$skill-name` (codex.md §1).
- **The `.agents/skills/` cross-tool directory convention** appears in 4/7 evidence files: Codex (`$CWD/.agents/skills` chain — its *primary* location per the official doc, codex.md §1), Cursor (`.agents/skills/` alongside `.cursor/skills/`, cursor.md §1), Copilot (`.agents/skills` and `~/.agents/skills`, github-copilot.md §1), Gemini CLI (`.agents/skills/` takes precedence over `.gemini/skills/` within a tier, gemini-cli.md §1), plus OpenCode reading `.agents/skills` as a compatibility fallback (opencode.md §1). Claude Code's own doc lists only `.claude/skills/`-family paths (claude-code.md §1) — but Claude Code's `.claude/skills/` is itself read compatibly by OpenCode, Cursor, and Copilot (opencode.md §1; cursor.md §1; github-copilot.md §1).
- **Project + user (home-directory) skill tiers** exist in all six skill-bearing tools (claude-code.md §1 table; opencode.md §1; codex.md §1; cursor.md §1; github-copilot.md §1; gemini-cli.md §1).

### Driver-specific

- **Claude Code's extension frontmatter** is by far the largest: `when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`, `allowed-tools`/`disallowed-tools`, `model`, `effort`, `context: fork`, `agent`, `background`, `hooks`, `paths`, `shell`, etc. — its own doc says only `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` are part of the portable spec (claude-code.md §1). OpenCode explicitly documents *none* of these extensions (opencode.md §1). Cursor adopts a subset (`paths`, `disable-model-invocation`) plus its own `icon`/`color` (cursor.md §1); Copilot adds `allowed-tools` (github-copilot.md §1).
- **Codex's sidecar metadata file** `agents/openai.yaml` (interface display name, icon, brand color, `policy: allow_implicit_invocation`, `dependencies.tools`) has no counterpart in any other tool's file (codex.md §1, §5).
- **Gemini CLI's consent gate**: activation requires a user consent prompt between the model's `activate_skill` call and injection — no other file documents a per-skill consent step (gemini-cli.md §1). Gemini also has skill *install/link/disable* management commands (`gemini skills install <url>`), as does Copilot via `gh skill` (gemini-cli.md §1; github-copilot.md §1) — a distribution story absent from the other files.
- **OpenCode's permissioned skills**: pattern-based `permission.skill` rules where `deny` hides the skill entirely (opencode.md §1) — skills as a first-class permission surface is unique in this evidence set.
- **Unresolved conflict carried forward**: codex.md §1 records that official docs give the `.agents/skills` chain while "several third-party guides … describe `~/.codex/skills/` and `.codex/skills/` as the skill paths" (secondary, not authoritative). Cursor's official doc *also* lists `.codex/skills/` as a compatibility path it reads (cursor.md §1). This synthesis does not resolve which paths Codex itself currently reads beyond what its official doc states; the conflict stands as codex.md recorded it.

## 2. Commands

### Common

- **A file per command whose filename becomes the `/name`** is the dominant pattern — 5/7: Claude Code `.claude/commands/<name>.md` (claude-code.md §2), OpenCode `.opencode/commands/*.md` or JSON (opencode.md §2), Cursor `.cursor/commands/[command].md` (cursor.md §2), Gemini CLI `.gemini/commands/*.toml` (gemini-cli.md §2), Codex `~/.codex/prompts/*.md` as `/prompts:<name>` (codex.md §2). Copilot's analog is prompt files `.github/prompts/*.prompt.md` → `/name`, IDE surfaces only and public preview (github-copilot.md §2). Aider: **built-ins only** — "no user-defined custom command mechanism" (aider.md §2).
- **A `description` metadata field surfaced in the command picker** appears in every tool with custom commands (claude-code.md §2; opencode.md §2; codex.md §2 — frontmatter `description` "shown in the slash menu"; gemini-cli.md §2; github-copilot.md §2 prompt-file frontmatter; Cursor's command files are being folded into skills, which carry `description` — cursor.md §2).
- **The commands→skills fold is itself a cross-tool convergence finding**: three of the seven independently merged or deprecated their custom-command mechanism in favor of skills. Claude Code: "custom commands have been merged into skills … both create `/deploy` and work the same way" (claude-code.md §2). Codex: custom prompts "officially deprecated: … 'Use skills for reusable instructions'" (codex.md §2). Cursor: docs commands page redirects to Skills; `/migrate-to-skills` converts commands, with `disable-model-invocation: true` reproducing command semantics (cursor.md §2). Any shared representation should treat "command" as converging into "explicitly-invocable skill" rather than as a stable independent artifact type.
- **Built-in slash commands** exist in every tool including Aider (aider.md §2 lists the fixed built-in set; cursor.md §2 documents 33 CLI built-ins; codex.md §2; github-copilot.md §2).

### Driver-specific

- **Gemini CLI is the format outlier for commands**: TOML with a required `prompt` field and path→colon namespacing (`git/commit.toml` → `/git:commit`), not markdown frontmatter (gemini-cli.md §2).
- **OpenCode's dual JSON/markdown representation** (commands as `"command"` entries in `opencode.json` or as files) and its `agent`/`model`/`subtask` per-command routing fields (opencode.md §2) have no equivalents elsewhere in this evidence set.
- **Copilot's prompt files are IDE-only and preview**: "available in VS Code, Visual Studio, and JetBrains IDEs (not the CLI)", marked "subject to change" (github-copilot.md §2) — the least stable command surface surveyed. Community-reported user-level `~/.cursor/commands` remains **unverified** per cursor.md §2 and stays unverified here.
- **Dynamic content injection** (`` !`command` `` shell output; `@file` inclusion) is shared by Claude Code and OpenCode command/skill bodies (claude-code.md §1; opencode.md §2) and by Gemini in `!{...}`/`@{...}` form (gemini-cli.md §6), but is undocumented for Cursor, Copilot, and Codex in the files — a partial convergence at most.

## 3. Agents (subagents)

### Common

- **Markdown file + YAML frontmatter, body = the agent's system prompt**, in 5/7 tools: Claude Code (claude-code.md §3), OpenCode (opencode.md §3 — "the markdown body is the agent's prompt"), Cursor (cursor.md §3), Copilot agent profiles (github-copilot.md §3), Gemini CLI (gemini-cli.md §3 — "the body is the subagent's system prompt"). Codex diverges in format (TOML, see below); Aider is **not applicable** ("no subagent/agent-definition concept", aider.md §3).
- **Common frontmatter/field core across all six agent-bearing tools**: `description` (required or delegation-driving in every one: claude-code.md §3; opencode.md §3; codex.md §3; cursor.md §3; github-copilot.md §3; gemini-cli.md §3), a `model` override (all six), and a per-agent **tool/permission scoping** field (`tools`/`disallowedTools` in Claude Code; `permission` + `tools` in OpenCode; `sandbox_mode`/`mcp_servers`/`skills.config` overrides in Codex; `readonly` in Cursor; `tools` + `mcp-servers` in Copilot; `tools` + `mcpServers` in Gemini).
- **Dual invocation — automatic delegation by description, plus explicit mention** — in all six: Claude Code `@agent-<name>` (claude-code.md §3), OpenCode `@`-mention / `task` tool (opencode.md §3), Cursor `/verifier ...` or prose (cursor.md §3), Copilot `/agent` picker / natural language / `--agent` flag (github-copilot.md §3), Gemini `@agent-name` (gemini-cli.md §3), Codex prompt-driven spawning (codex.md §3).
- **Project + user directory tiers** for agent definitions in all six (claude-code.md §3; opencode.md §3; codex.md §3; cursor.md §3; github-copilot.md §3; gemini-cli.md §3).
- **Isolated context for subagents** is explicit in Cursor ("isolated context windows", cursor.md §3) and Gemini ("isolated contexts with restricted tools", gemini-cli.md §3), and structurally present in OpenCode's `subtask`/`task` model (opencode.md §2–3).

### Driver-specific

- **Codex agents are TOML, not markdown**: one agent per `.toml` file with `name`, `description`, `developer_instructions` — the prompt is a *field*, not a file body (codex.md §3). Its global `[agents]` tuning table (max concurrent threads, default subagent model/reasoning effort) is also unique. The `spawn_agent` tool name is **secondary evidence only** (a GitHub issue, per codex.md §3) and stays unverified.
- **Cursor's execution-model breadth**: parallel, nested (limited depth), cloud-VM (`/in-cloud`), resumable-by-ID subagents, `is_background`, and bracketed model parameters (`claude-opus-5[effort=high]`) (cursor.md §3) — no other file documents this range.
- **Cross-tool compatibility reads of other tools' agent dirs** are documented only for Cursor (`.claude/agents/`, `.codex/agents/`, priority-ordered; cursor.md §3) — unlike skills, agent-directory compatibility is not a general convention in this evidence.
- **Copilot's org-level distribution** (agents in the org's `.github`/`.github-private` repo `/agents` directory) and `target: vscode|github-copilot` field (github-copilot.md §3) are unique.
- **Gemini's `kind: local|remote`** field and recursion protection ("prevents subagents from calling other subagents even with `*`") (gemini-cli.md §3).
- **Aider's nearest analog** is architect mode's two-model pipeline (`--architect`, `--editor-model`) plus role-specialized model slots (`--weak-model`) — "model assignments within one session, not separately defined agents" (aider.md §3). It would not map onto any shared agent representation.

## 4. Rules / instructions

### Common

- **Plain-markdown, auto-loaded, hierarchically layered instruction files** in 6/7: Claude Code `CLAUDE.md` (managed/user/project/local scopes, claude-code.md §4), OpenCode `AGENTS.md` (project + global, opencode.md §4), Codex `AGENTS.md` (global + git-root→CWD chain, codex.md §4), Cursor `.cursor/rules/*.mdc` + `AGENTS.md` alternative (cursor.md §4), Copilot `.github/copilot-instructions.md` + `.github/instructions/` + `AGENTS.md` (github-copilot.md §4), Gemini `GEMINI.md` (global/workspace/just-in-time, gemini-cli.md §4). Aider is again the outlier: conventions files are **explicitly loaded**, "there is no auto-loaded rules file" (aider.md §4).
- **`AGENTS.md` as a converging cross-tool instructions name — real but not universal**: native in OpenCode and Codex (opencode.md §4; codex.md §4), supported as an alternative in Cursor ("plain markdown file without metadata", cursor.md §4) and Copilot (nearest-wins, github-copilot.md §4), configurable in Gemini (`context.fileName` can be set to `AGENTS.md`, gemini-cli.md §4). **Claude Code is the documented holdout**: it "reads `CLAUDE.md`, not `AGENTS.md`; the documented bridge is `@AGENTS.md` import or a symlink" (claude-code.md §4).
- **Reading *other* tools' instruction files** is itself common: OpenCode falls back to `CLAUDE.md` (opencode.md §4); Copilot reads `CLAUDE.md` or `GEMINI.md` as alternatives, and its CLI reads `.claude/CLAUDE.md` (github-copilot.md §4).
- **Path/glob-scoped conditional rules** in 4/7: Claude Code `.claude/rules/*.md` with `paths` frontmatter (claude-code.md §4), Cursor `.mdc` `globs` + `alwaysApply` (cursor.md §4), Copilot `applyTo` in `*.instructions.md` (github-copilot.md §4), and Gemini's just-in-time directory-scoped `GEMINI.md` loading (gemini-cli.md §4). OpenCode explicitly has **no** per-file `paths` frontmatter — scoping is by file placement or `instructions` globs (opencode.md §4).
- **`@file` import syntax** inside instruction files: Claude Code (max depth 4 hops, claude-code.md §4) and Gemini (`@./components/instructions.md`, gemini-cli.md §4).
- **Concatenation, not override**, as the merge semantics: Claude Code ("concatenated, not overridden", claude-code.md §4), Codex (concatenated root-downward, later wins by position, codex.md §4), Copilot CLI ("combines their instructions", github-copilot.md §4).

### Driver-specific

- **Codex splits "rules" into a second, non-prose mechanism**: Starlark `.rules` execution-policy files (`prefix_rule(...)`) governing which commands run outside the sandbox (codex.md §4, §8). No other tool's "rules" are executable policy — this naming collision matters for any shared vocabulary.
- **Cursor's `.mdc` format** with four application types (Always / Intelligent / glob / manual `@`-mention), Team Rules from a dashboard, and remote rule import from GitHub repos (cursor.md §4) is the richest and most Cursor-specific rules machinery. Legacy `.cursorrules` remains **unverified** per cursor.md §4.
- **Copilot's `excludeAgent` field** (excluding `code-review` or `cloud-agent` from an instructions file) and the documented CLI position that it "does not define a general precedence order between these files" (github-copilot.md §4).
- **OpenCode's remote-URL instructions** (`"instructions"` array accepting globs *and* remote URLs, opencode.md §4).
- **Codex's size cap** (`project_doc_max_bytes`, default 32 KiB) and configurable fallback filenames (codex.md §4).
- **Aider's watch-mode inline "AI comments"** (`# ... AI!` / `AI?` markers in source files as an instruction channel, aider.md §4) — no analog anywhere else in the set.

## 5. Metadata

### Common

- **Metadata lives in per-artifact frontmatter/fields, not a separate manifest**, in 6/7: stated explicitly for Claude Code ("no separate manifest for skills/commands/agents", claude-code.md §5), OpenCode ("carries metadata inside each artifact's own definition rather than a separate manifest", opencode.md §5), Copilot ("YAML frontmatter per artifact type, not … a single unified schema", github-copilot.md §5), Gemini ("No single unified metadata schema; each artifact type carries its own declared shape", gemini-cli.md §5), and evident in the field lists for Codex and Cursor (codex.md §5; cursor.md §5). Aider's metadata is model capability/pricing data only — "no documented task/command/agent metadata format" (aider.md §5).
- **`name` + `description` is the universal metadata core** for every artifact type in every tool that has the artifact (see §§1–3 above) — the only metadata a shared representation could rely on everywhere.
- **A free-form key-value `metadata` map** appears in 4/7: Claude Code skills ("Claude Code doesn't act on its contents", claude-code.md §5), OpenCode skills (string-to-string map, opencode.md §5), Cursor skills ("an explicit arbitrary-metadata slot", cursor.md §5), Copilot custom agents (github-copilot.md §5). Codex explicitly has **no** such field ("No arbitrary free-form metadata field … is documented for any artifact type", codex.md §5); Gemini and Aider document none either (gemini-cli.md §5; aider.md §5). Relevant to PitWay: a tool-ignored metadata bag exists in several majors but is *not* portable to all.
- **`license` / `compatibility` spec-level fields** on skills in Claude Code and OpenCode (claude-code.md §5; opencode.md §1); `license` also in Copilot skills (github-copilot.md §1).

### Driver-specific

- **Config-file format is fully divergent**: JSON settings families (Claude Code `.claude/settings.json`, claude-code.md §8; Cursor `permissions.json`/`cli-config.json`/`mcp.json`, cursor.md §8, §7; Copilot `~/.copilot/*.json`, github-copilot.md §8; Gemini layered `settings.json`, gemini-cli.md §5), TOML (Codex layered `config.toml` + profiles, codex.md §5), JSON-with-schema (OpenCode `opencode.json` with `$schema`, opencode.md §5), YAML (Aider `.aider.conf.yml`, aider.md §6).
- **Codex's `agents/openai.yaml`** skill-presentation block and Gemini's `gemini-extension.json` extension manifest (gemini-cli.md §5) are the only sidecar-manifest patterns, each unique to its tool.
- **OpenCode's published JSON Schema** (`$schema: https://opencode.ai/config.json`) — "the closest thing to machine-validated metadata for the whole config surface" (opencode.md §5) — has no documented counterpart in the other files.
- **Aider's model metadata files** (`.aider.model.settings.yml`, `.aider.model.metadata.json`, litellm-backed) are an entirely different notion of "metadata" (aider.md §5).

## 6. Arguments

### Common

This is the **weakest convergence** of the eight dimensions. What is shared:

- **Some form of argument passing into a reusable prompt** exists in 5/7, but the *syntax* fragments into at least four families:
  - `$ARGUMENTS` + positional `$1..$n`: Claude Code (plus named `$name` via an `arguments` field and `$ARGUMENTS[N]`, claude-code.md §6) and OpenCode commands (opencode.md §6) — the closest pairwise match; Codex custom prompts use `$1`–`$9`, `$ARGUMENTS`, plus named uppercase `KEY=value` placeholders, but that whole mechanism is **deprecated with custom prompts** (codex.md §6).
  - `{{args}}` with append-by-default and shell-escaping inside shell blocks: Gemini CLI (gemini-cli.md §6).
  - `${input:variable_name:prompt_text}` typed input prompts: Copilot prompt files (github-copilot.md §6).
  - Free text after the invocation name, with no placeholder scheme documented: Cursor ("a formal positional-placeholder scheme, if any, is not documented in the pages fetched", cursor.md §6) and Copilot skills/agents (github-copilot.md §6 — "No generic `$ARGUMENTS`/`{{args}}`-style placeholder … was found").
- **`argument-hint` autocomplete metadata** is shared by exactly two: Claude Code and Codex custom prompts (claude-code.md §6; codex.md §2, §6).
- **Skills mostly do *not* take structured arguments**: OpenCode skills are name-only loads with "no argument-passing or placeholder-substitution mechanism" (opencode.md §6); Codex skills "receive the user's request as natural language" (codex.md §6); Copilot `/SKILL-NAME` "references a skill inside a prompt rather than parameterizing it" (github-copilot.md §6). Claude Code, which *does* pass `$ARGUMENTS` into skills (claude-code.md §6), is the exception, not the rule.

### Driver-specific

- Claude Code's named-argument declaration (`arguments:` frontmatter) and `${CLAUDE_*}` environment-style substitutions (claude-code.md §6).
- OpenCode's typed Zod argument schemas — but for **custom tools**, not commands (opencode.md §6).
- Cursor's bracketed model parameters (`id[key=value]`) as its only documented parameterization (cursor.md §6).
- Aider: arguments means **CLI flags > `AIDER_*` env vars > `.aider.conf.yml`** layering plus `--message` one-shot scripting; "no per-command argument templating … because there are no user-defined command files" (aider.md §6). The unofficial Python API is explicitly unsupported (aider.md §6).

## 7. Tools

### Common

- **MCP (Model Context Protocol) as the external-tool mechanism in 6/7**: Claude Code (`.mcp.json` / `claude mcp add`, claude-code.md §7), OpenCode (`"mcp"` key in `opencode.json`, opencode.md §7), Codex (`[mcp_servers.<name>]` TOML tables, codex.md §7), Cursor (`mcpServers` in `.cursor/mcp.json`, cursor.md §7), Copilot (`~/.copilot/mcp-config.json` CLI / repo-settings JSON for the coding agent, github-copilot.md §7), Gemini (`mcpServers` in `settings.json`, gemini-cli.md §7). Aider: **no MCP in mainline as of v0.86.1**, settled against the official release history; existing integrations are third-party wrappers exposing Aider *as* an MCP server (aider.md §7).
- **Common MCP configuration shape** across those six: named servers, stdio (`command`/`args`/`env`) and HTTP/SSE (`url`/headers/auth) transports, and per-server tool filtering (`enabled_tools`/`disabled_tools` in Codex, codex.md §7; `includeTools`/`excludeTools` in Gemini, gemini-cli.md §7; wildcarded `"tools"` config in OpenCode, opencode.md §7; mandatory `tools` array in Copilot coding agent, github-copilot.md §7).
- **Named built-in tools referenced by permission/config surfaces** in all six non-Aider tools — but the *names and casing* diverge: `Read`/`Bash`/`Edit` (Claude Code, claude-code.md §7), lowercase `bash`/`edit`/`read` (OpenCode, opencode.md §7), `shell`/`write`/`read`/`web_fetch` (Copilot, github-copilot.md §7), `run_shell_command`/`read_file`/`write_file` (Gemini, gemini-cli.md §7), `Shell()`/`Read()`/`Write()`/`WebFetch()` classes (Cursor — inferred from permission syntax, "not an official enumerated tool list", cursor.md §7).
- **MCP tool naming schemes also diverge**: `mcp__<server>__<tool>` (Claude Code, claude-code.md §7), `mcp_{serverName}_{toolName}` (Gemini — with a documented parsing hazard for underscored server names, gemini-cli.md §7–8), `Mcp(server:tool)` / `server:tool` (Cursor, cursor.md §7–8), `MyMCP(create_issue)` (Copilot, github-copilot.md §8). Convergence on the concept, none on the identifier format.
- **Per-artifact tool scoping** (a skill or agent narrowing which tools may run) in all six: claude-code.md §7; opencode.md §3, §7; codex.md §3, §7; cursor.md §3 (`readonly`); github-copilot.md §7; gemini-cli.md §3, §7.

### Driver-specific

- **OpenCode's custom tools in TypeScript** (`tool()` from `@opencode-ai/plugin`, Zod-typed args, filename→tool-name, overrides built-ins; opencode.md §7) — the only user-authored *executable* tool mechanism in the set.
- **Gemini's extensions** bundling MCP servers + commands + skills + subagents + context + hooks + policies + themes in one installable unit (gemini-cli.md §7).
- **Codex's per-tool approval coupling** (`default_tools_approval_mode`, `tools.<tool>.approval_mode`) and its unverified `apply_patch` built-in — "explicitly left unclaimed" in codex.md §7 and left unclaimed here too.
- **Aider's edit formats** (`whole`, `diff`, `udiff`, …): editing as structured *reply text*, "not function/tool calls" (aider.md §7) — a fundamentally different mechanism that no tool-list representation would capture.

## 8. Permissions

### Common

- **The three-verdict vocabulary — allow / ask / deny — recurs across 5/7 tools** and is the only genuinely shareable permissions concept: Claude Code `allow`/`ask`/`deny` rule arrays (claude-code.md §8), OpenCode every rule resolves to `"allow"`/`"ask"`/`"deny"` (opencode.md §8), Codex exec-policy decisions `allow`/`prompt`/`forbidden` plus approval categories (codex.md §8), Gemini policy-engine decisions `allow`/`deny`/`ask_user` (gemini-cli.md §8), Copilot allow/deny tool patterns (a two-verdict subset with interactive approval standing in for "ask", github-copilot.md §8). Cursor's `permissions.json`/CLI config is allowlist/denylist-shaped (cursor.md §8). Aider has **no rule language at all** — interactive confirmation plus flags (aider.md §8).
- **`Tool(pattern)`-style rule syntax** in 3/7: Claude Code `Bash(npm run *)` (claude-code.md §8), Cursor CLI `Shell(git)`/`Mcp(datadog:*)` (cursor.md §8), Copilot `shell(git commit)`/`MyMCP(create_issue)` (github-copilot.md §8) — a real family resemblance, with per-tool differences in casing and glob semantics.
- **Layered scopes (user/project/system-or-org) with a precedence rule** in all six non-Aider tools (claude-code.md §8 — user/project/local/managed; opencode.md §8 — global + per-agent; codex.md §8 — user/project-trusted/system/admin; cursor.md §8 — admin dashboard > file > IDE; github-copilot.md §8 — session/saved/trusted-folders; gemini-cli.md §8 — tiered Default<Extension<Workspace<User<Admin).
- **Conflict resolution is NOT uniform and must not be flattened into one rule**: deny-wins in Claude Code ("Deny > ask > allow", claude-code.md §8), Copilot ("Deny rules always take precedence … even under `--allow-all`", github-copilot.md §8), Cursor ("Deny rules take precedence over allow rules", cursor.md §8), and Codex rules ("most restrictive wins", codex.md §8) — but OpenCode is **last-matching-wins** (opencode.md §8) and Gemini is **highest-priority-wins** by numeric tier arithmetic (gemini-cli.md §8). Semantically similar goals, incompatible resolution algorithms.
- **A "dangerous bypass everything" escape hatch** in most: Claude Code `bypassPermissions` mode (claude-code.md §8), Codex `--dangerously-bypass-approvals-and-sandbox`/`--yolo` (codex.md §6), Copilot `--allow-all`/`--yolo` (github-copilot.md §8), OpenCode `--auto` (opencode.md §8), Aider `--yes-always` (aider.md §8).
- **Trusted-folder/project gating** in Codex (project config loads "only when the project is marked trusted", codex.md §8), Copilot (`trustedFolders` in `~/.copilot/config.json`, github-copilot.md §8), and Gemini (trusted-folders mechanism — **existence-only**; gemini-cli.md §8 fetched no details, and none are claimed here).

### Driver-specific

- **Codex's three interlocking mechanisms** — `sandbox_mode` (capability) × `approval_policy` incl. granular per-category control (interaction) × Starlark exec-policy rules (policy), plus network-proxy domain allow/deny and protected paths — is by its own file "the richest of the eight dimensions in Codex" (codex.md §8) and structurally unlike anything else surveyed. OS-level sandboxing as the *primary* axis appears only here.
- **Gemini's numeric-priority policy engine** (TOML `[[rule]]` with `priority` 0–999, tier-base arithmetic; gemini-cli.md §8).
- **Cursor's natural-language `autoRun` steering** (`allow_instructions`/`block_instructions` prose consumed by an auto-review classifier; cursor.md §8) — permissions expressed as prose for a classifier exists nowhere else in the set.
- **OpenCode's per-tool-key permission object** (permission keys like `doom_loop`, `external_directory`; `.env` reads denied by default; per-agent frontmatter overrides; opencode.md §8).
- **Claude Code's permission modes** (`default`/`acceptEdits`/`auto`/`dontAsk`/`bypassPermissions`/`plan`, pinnable per-subagent; claude-code.md §8).
- **Aider's whole model** — confirmation prompts, `--read` read-only scoping, `--aiderignore`, `--dry-run`, git guardrails (aider.md §8) — is interaction-design, not configuration, and would not map to any shared permission schema.

---

## Cross-tool convergence (the load-bearing findings)

1. **Agent Skills (`SKILL.md` with `name` + `description` frontmatter) is a real open standard with 6/7 adoption.** Claude Code's doc names the standard and agentskills.io (claude-code.md §1); OpenCode, Cursor, Copilot, and Gemini each independently describe implementing the same standard (opencode.md §1; cursor.md §1; github-copilot.md §1; gemini-cli.md §1 — "the same open standard Copilot and Claude Code use"). The portable core is small — `name`, `description`, markdown body, optional `license`/`compatibility`/`metadata` — and everything beyond it is per-tool extension.
2. **The `.agents/` directory convention is emerging as the cross-tool neutral ground for skills** (Codex primary; Cursor, Copilot, Gemini, OpenCode all read it — §1 above), alongside widespread compatibility reads of `.claude/skills/`. The parallel convention for instructions is `AGENTS.md` — with Claude Code as the documented holdout (claude-code.md §4).
3. **Commands are collapsing into skills** in three tools (Claude Code merged, Codex deprecated, Cursor migrating — §2 above). "Explicitly-invocable prompt with a description" is the durable abstraction; "command file" as a distinct artifact type is losing ground.
4. **Agents converge on description-driven delegation + per-agent model/tool scoping**, mostly as markdown-with-frontmatter (5/6), with Codex's TOML as the format outlier (§3).
5. **MCP is the de facto external-tool standard (6/7)** — but tool *naming* and permission *rule syntax* around it do not converge (§7).
6. **Permissions share only a vocabulary (allow/ask/deny), not a semantics** — conflict-resolution algorithms genuinely diverge (deny-wins vs last-match-wins vs priority arithmetic, §8). Any shared representation could carry intent, but faithful per-tool translation of rule *interactions* is not supported by this evidence.
7. **Aider demonstrates the floor**: a real, widely used tool for which skills, agents, extensible tools, and rule-based permissions are all genuinely not applicable (aider.md §§1, 3, 7, 8). A "shared representation" that assumed those concepts universal would simply not target Aider.

## Per-tool character summaries

- **Claude Code** (claude-code.md): the maximal implementation — follows and extends the Agent Skills standard with the largest extension frontmatter surface (fork contexts, hooks, path scoping, named arguments), four-scope `CLAUDE.md` memory plus glob-scoped rules, `Tool(pattern)` permission arrays with six permission modes. Its formats are the ones other tools most often read compatibly; it is also the holdout that reads `CLAUDE.md` rather than `AGENTS.md`.
- **OpenCode** (opencode.md): deliberately spec-faithful and config-centric — skills kept to the portable Agent Skills subset, everything (commands, agents, permissions, MCP, tools) expressible in one schema-validated `opencode.json`, explicit Claude Code compatibility fallbacks, and the set's only TypeScript custom-tool mechanism. Permissions are per-tool-key maps with last-match-wins.
- **Codex** (codex.md): the security-architecture outlier — TOML everywhere (config, agents), skills under the `.agents/skills` chain with an `agents/openai.yaml` sidecar, custom prompts deprecated in favor of skills, and the deepest permissions stack (sandbox mode × granular approval policy × Starlark exec-policy rules × network proxy). Carries the set's most prominent unresolved conflict (`.agents/skills` vs third-party-reported `.codex/skills`).
- **Cursor** (cursor.md): the compatibility omnivore — reads `.claude/` and `.codex/` skill and agent directories by design, folds commands into skills via `/migrate-to-skills`, has the richest rules machinery (`.mdc` types, Team Rules, remote import) and the broadest subagent execution model (parallel, nested, cloud, resumable), plus two overlapping permission files and prose-steered auto-run.
- **GitHub Copilot** (github-copilot.md): the multi-surface platform — the same artifact families (skills, agent profiles, instructions) shared across CLI, cloud coding agent, code review, and IDEs, with org-level distribution through `.github` repos, `Kind(argument)` deny-wins permissions, and explicit read-compatibility with `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md`. Its command analog (prompt files) is its least settled surface (IDE-only, public preview).
- **Gemini CLI** (gemini-cli.md): the consent-and-policy engineer — Agent Skills with a user-consent activation gate, TOML custom commands with colon namespacing, subagents with recursion protection and `kind: remote`, renameable `GEMINI.md` context, extensions as all-in-one bundles, and a numeric-priority TOML policy engine layered over per-tool settings.
- **Aider** (aider.md): the honest outlier — a single-session pair-programming chat loop with git integration. No skills, no agents, no user-defined commands, no tool-calling framework, no MCP in mainline (v0.86.1), no permission rule language; instead: explicitly loaded conventions files, edit-format reply text, architect-mode model pipelines, and flag/confirmation-based control. Its absences are findings, not gaps in the research.

## No MVP-boundary decision is made by this milestone

This milestone is investigation-only, and this document is findings, not a decision. Per AC001 of the M022 contract ("Agent Driver Format Research"), quoted from the contract:

> Scope discipline: this milestone is investigation-only. No code under src/ changes; write_scope is restricted to new files under docs/evidence/M022/. No new driver adapter is implemented, and no change is made to Core's provider-agnosticism constraint ("Core must never import AI-provider code... No other adapters, no plugin system in MVP", CLAUDE.md). Any recommendation to build a canonical PitWay-native format, an OpenCode driver, or `pitway update` is a separate, later decision requiring explicit developer sign-off before any implementation task is drafted — this milestone's deliverable is real, sourced findings, never a decision to act on them.

Accordingly, **nothing in this document decides or recommends committing to**: a canonical PitWay-native format for skills/commands/agents/rules; a new driver adapter (for OpenCode or any other tool); a plugin architecture; or a `pitway update` mechanism. The convergence findings above (Agent Skills standard, `.agents/` convention, commands→skills fold, MCP ubiquity) are inputs to such a decision, not the decision. Any such step requires separate, explicit developer sign-off before any implementation task is drafted.
