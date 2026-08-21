# Codex (OpenAI Codex CLI) — Driver Format Research

- **Tool**: Codex — OpenAI's CLI coding agent (open-source CLI at <https://github.com/openai/codex>)
- **Research date**: 2026-08-22
- **Method**: live web research against official documentation. All `https://developers.openai.com/codex/...` URLs below are the canonical doc URLs; at research time each returned a `308 Permanent Redirect` to a `https://learn.chatgpt.com/docs/...` page ("ChatGPT Learn"), whose content is what was actually read. Both URL forms are real and current.
- **Sources consulted** (all fetched, except where marked secondary):
  - Config basics — <https://developers.openai.com/codex/config-basic> (→ learn.chatgpt.com/docs/config-file/config-basic)
  - Agent approvals & security — <https://developers.openai.com/codex/agent-approvals-security>
  - Build skills — <https://developers.openai.com/codex/skills> (→ learn.chatgpt.com/docs/build-skills)
  - Custom prompts — <https://developers.openai.com/codex/custom-prompts> (→ learn.chatgpt.com/docs/custom-prompts)
  - Subagents — <https://developers.openai.com/codex/subagents> (→ learn.chatgpt.com/docs/agent-configuration/subagents)
  - AGENTS.md — <https://developers.openai.com/codex/guides/agents-md> (→ learn.chatgpt.com/docs/agent-configuration/agents-md)
  - Rules (exec policy) — <https://developers.openai.com/codex/rules.md> (→ learn.chatgpt.com/docs/agent-configuration/rules.md)
  - MCP — <https://developers.openai.com/codex/mcp> (→ learn.chatgpt.com/docs/extend/mcp?surface=cli)
  - CLI reference (developer commands) — <https://developers.openai.com/codex/cli/reference> (→ learn.chatgpt.com/docs/developer-commands?surface=cli)
  - Repo docs (limited fetch) — <https://raw.githubusercontent.com/openai/codex/main/docs/config.md>

Fidelity note: extractions were made through a summarizing fetch step; each exact key/value below is attributed to the single page it came from and was not cross-checked against the Rust source tree.

## 1. Skills

Codex has a first-class skills system. A skill is a directory containing a `SKILL.md` file with YAML frontmatter (`name`, `description`) followed by markdown instructions, plus optional `scripts/`, `references/`, and `assets/` folders and an optional `agents/openai.yaml` metadata file ([Build skills](https://developers.openai.com/codex/skills)).

Discovery locations per the official skills doc (same source):

- `$CWD/.agents/skills` (current working directory), `$CWD/../.agents/skills` (parent folders in nested repos), `$REPO_ROOT/.agents/skills` (repo root)
- `$HOME/.agents/skills` (personal, cross-repo)
- `/etc/codex/skills` (system/admin) plus bundled built-in skills from OpenAI

Note a source conflict: several third-party guides (e.g. <https://www.agensi.io/learn/codex-cli-skills-install-skill-md>, <https://agentskillshub.dev/guides/codex-skills/> — secondary, not treated as authoritative here) describe `~/.codex/skills/` and `.codex/skills/` as the skill paths. The official doc's `.agents/skills` chain is taken as the current finding; the approvals doc corroborates that both `.agents/` and `.codex/` are agent-managed directories (both are sandbox-protected paths, see §8).

Invocation: explicit via `$skill-name` mention in the Codex CLI (`@skill` in ChatGPT), or implicit — Codex selects a skill automatically when the task matches its `description`. Implicit invocation can be turned off per skill via `agents/openai.yaml`: `policy: allow_implicit_invocation: false`. Individual skills can be disabled locally in `~/.codex/config.toml` via `[[skills.config]]` entries with `path` and `enabled = false` ([Build skills](https://developers.openai.com/codex/skills)). Skill execution is also an approval category (`skill_approval`) under the granular approval policy ([Agent approvals & security](https://developers.openai.com/codex/agent-approvals-security)).

## 2. Commands

Two layers:

- **Built-in slash commands** in the interactive TUI: `/permissions`, `/model`, `/fast`, `/personality`, `/approve`, `/compact`, `/copy`, `/diff`, `/exit`, etc. ([CLI reference](https://developers.openai.com/codex/cli/reference)). CLI subcommands include `codex` (TUI), `codex exec` (non-interactive, alias `codex e`), `codex resume`, `codex fork`, `codex review`, `codex apply`, `codex cloud`, `codex mcp`, `codex sandbox`, `codex app-server` (same source).
- **Custom prompts** — user-defined slash commands as top-level Markdown files in `~/.codex/prompts/` (subdirectories are ignored), invoked as `/prompts:<name>`, with YAML frontmatter `description` (shown in the slash menu) and `argument-hint`. **Officially deprecated**: the docs now say "Use skills for reusable instructions that Codex can invoke explicitly or implicitly" ([Custom prompts](https://developers.openai.com/codex/custom-prompts)).

## 3. Agents

Codex supports subagents/multi-agent workflows ([Subagents](https://developers.openai.com/codex/subagents)):

- Global `[agents]` config table: `agents.enabled` (boolean, default `true`), `agents.max_concurrent_threads_per_session`, `agents.default_subagent_model`, `agents.default_subagent_reasoning_effort`, `agents.interrupt_message`.
- **Custom agent roles** are TOML files — one agent per file — in `~/.codex/agents/` (personal) or `.codex/agents/` (project). Required fields: `name`, `description`, `developer_instructions`. A role may override `model`, `model_reasoning_effort` (`low`…`xhigh` etc.), `sandbox_mode` (`read-only`, `workspace-write`), `mcp_servers`, and `skills.config` — i.e. per-agent tool and permission scoping.
- Spawning is prompt-driven ("spawn one agent per point", delegation requested from `AGENTS.md` or from skill instructions); the doc describes no explicit user-facing spawn-tool API. (A GitHub issue references a `spawn_agent` tool name — <https://github.com/openai/codex/issues/14579> — secondary evidence only.)

## 4. Rules / instructions

Codex splits this dimension into two distinct mechanisms:

- **Instructions: `AGENTS.md`** ([AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md)). Discovery: global `~/.codex/AGENTS.override.md` or `~/.codex/AGENTS.md` (first match), then from the Git root down to the CWD, checking each directory for `AGENTS.override.md`, then `AGENTS.md`, then configured fallback filenames. Files are concatenated root-downward; files closer to the CWD appear later in the prompt and therefore override earlier guidance. Combined size cap `project_doc_max_bytes` (default 32 KiB); fallback names configurable via `project_doc_fallback_filenames = [...]` in config.toml. Plain markdown — no frontmatter or metadata schema.
- **Rules: `.rules` files** — Codex's other, literally-named "Rules" feature is an execution-policy mechanism, not prose guidance: Starlark files in `rules/` under each config layer (`~/.codex/rules/default.rules` user layer; `<repo>/.codex/rules/` when the project is trusted; admin/team layers) containing `prefix_rule(pattern=[...], decision="allow|prompt|forbidden", justification=..., match=[...], not_match=[...])` declarations governing which commands may run outside the sandbox; most-restrictive decision wins ([Rules](https://developers.openai.com/codex/rules.md)). Detailed in §8.

Additionally, `developer_instructions` config injects user instructions before AGENTS.md, and base instructions can be overridden with a file path ([Config basics](https://developers.openai.com/codex/config-basic), surfaced in search result summary — secondary detail).

## 5. Metadata

- **Config metadata**: layered `config.toml` — `~/.codex/config.toml` (user), `.codex/config.toml` (project, trusted projects only), `/etc/codex/config.toml` (system), profile files `~/.codex/profile-name.config.toml`; precedence CLI flags > project > profile > user > system > defaults. Keys include `model`, `approval_policy`, `sandbox_mode`, `web_search` (`"cached"|"indexed"|"live"|"disabled"`), `model_reasoning_effort`, `personality`, `log_dir`, plus tables `[features]`, `[windows]`, `[tui.keymap]`, `[shell_environment_policy]`, `[permissions.<name>]` ([Config basics](https://developers.openai.com/codex/config-basic)).
- **Artifact metadata**: SKILL.md YAML frontmatter (`name`, `description`); custom-prompt frontmatter (`description`, `argument-hint`); agent-role TOML fields (`name`, `description`, `developer_instructions`). Skills carry extended presentation metadata in `agents/openai.yaml`: `interface.display_name`, `interface.short_description`, `interface.icon_small`, `interface.brand_color`, and `dependencies.tools` (e.g. `type: "mcp"`) ([Build skills](https://developers.openai.com/codex/skills)).
- No arbitrary free-form metadata field (à la a generic key-value bag) is documented for any artifact type.

## 6. Arguments

- **Custom-prompt placeholders** ([Custom prompts](https://developers.openai.com/codex/custom-prompts)): positional `$1`–`$9`; `$ARGUMENTS` (all args joined); named uppercase placeholders (e.g. `$FILE`, `$TICKET_ID`) supplied as `KEY=value` pairs at invocation (`/prompts:draftpr FILES="path1 path2" PR_TITLE="..."`); `$$` for a literal dollar sign; `argument-hint` frontmatter documents expected parameters. This mechanism is deprecated together with custom prompts; no equivalent placeholder substitution is documented for skills (skills receive the user's request as natural language).
- **CLI arguments** ([CLI reference](https://developers.openai.com/codex/cli/reference)): `--model/-m`, `--sandbox/-s`, `--profile/-p`, `--ask-for-approval/-a untrusted|on-request|never`, repeatable `-c/--config key=value` inline config overrides, `--cd/-C`, `--oss`, `--dangerously-bypass-approvals-and-sandbox` (`--yolo`).

## 7. Tools

- **MCP servers** ([MCP](https://developers.openai.com/codex/mcp)): configured as `[mcp_servers.<name>]` tables in config.toml. STDIO servers: `command` (required), `args`, `env`, `env_vars`, `cwd`, `experimental_environment`. Streamable-HTTP servers: `url` (required), `auth` (oauth/chatgpt), `bearer_token_env_var`, `http_headers`, `env_http_headers`. Common: `startup_timeout_sec` (default 10), `tool_timeout_sec` (default 60), `enabled`, `required`, and per-server tool filtering via `enabled_tools` / `disabled_tools`. Managed via `codex mcp add|list|login`.
- **Per-tool approval**: `default_tools_approval_mode` = `auto | prompt | writes | approve`, overridable per tool via `tools.<tool>.approval_mode` (same source) — tools and permissions are directly coupled.
- **Built-in tools**: a sandboxed shell (the sandbox/approval machinery in §8 governs it) and web search controlled by the `web_search` config key ([Config basics](https://developers.openai.com/codex/config-basic)). Other built-ins (e.g. an `apply_patch` editing tool) are widely referenced in the repo but were **not verified** from a fetched official page in this research — explicitly left unclaimed.
- Per-agent tool scoping: agent roles can carry their own `mcp_servers` selection (§3).

## 8. Permissions

The richest of the eight dimensions in Codex — three interlocking mechanisms ([Agent approvals & security](https://developers.openai.com/codex/agent-approvals-security) unless noted):

- **`sandbox_mode`** — what Codex is technically able to do: `"read-only"`, `"workspace-write"` (default), `"danger-full-access"`; CLI `--sandbox`. Under `[sandbox_workspace_write]`: `network_access = true|false`. Network filtering via `[features.network_proxy]`: `enabled`, `domains = { "host" = "allow"|"deny" }` with `*.example.com` / `**.example.com` / `*` patterns, `allow_local_binding`; deny always wins. Protected read-only paths inside writable roots: `<root>/.git`, `<root>/.agents/`, `<root>/.codex/` (recursive).
- **`approval_policy`** — when Codex pauses to ask: `"untrusted"`, `"on-request"`, `"never"`, or `{ granular = { ... } }` with per-category control (`sandbox_approval`, `rules`, `mcp_elicitations`, `request_permissions`, `skill_approval`). `approvals_reviewer = "user"` (default) or `"auto_review"` routes approval decisions to an automatic reviewer. `/permissions` adjusts these mid-session ([CLI reference](https://developers.openai.com/codex/cli/reference)).
- **Rules (exec policy)** — declarative allow/prompt/forbid lists for commands outside the sandbox, as Starlark `prefix_rule()` declarations in `.rules` files (locations and syntax in §4). Decisions: `"allow"` (run outside sandbox without prompting), `"prompt"`, `"forbidden"` (block); when multiple rules match, the most restrictive wins (forbidden > prompt > allow). Approving a command in the TUI persists it to `~/.codex/rules/default.rules`; smart approvals may propose a `prefix_rule` for review ([Rules](https://developers.openai.com/codex/rules.md)).
- Trust gating: project-scoped `.codex/` config, hooks, and rules load only when the project is marked trusted ([Config basics](https://developers.openai.com/codex/config-basic)). Admin-side: `requirements.toml` with `allow_managed_hooks_only = true` restricts hook sources ([repo docs/config.md](https://raw.githubusercontent.com/openai/codex/main/docs/config.md)).

## Summary table

| Dimension | Codex representation | Primary source |
|---|---|---|
| Skills | `SKILL.md` dirs under `.agents/skills` chain (CWD → repo root → `$HOME` → `/etc/codex/skills`); frontmatter `name`/`description`; `$skill` or implicit; `agents/openai.yaml` policy/metadata; `[[skills.config]]` disable | developers.openai.com/codex/skills |
| Commands | Built-in slash commands + CLI subcommands; custom prompts `~/.codex/prompts/*.md` as `/prompts:<name>` — **deprecated in favor of skills** | developers.openai.com/codex/custom-prompts, /codex/cli/reference |
| Agents | TOML agent roles in `~/.codex/agents/`, `.codex/agents/` (`name`, `description`, `developer_instructions` + model/sandbox/MCP/skill overrides); `[agents]` global settings; prompt-driven spawning | developers.openai.com/codex/subagents |
| Rules/instructions | Prose: layered `AGENTS.md` (global + root→CWD, 32 KiB cap). Policy: Starlark `prefix_rule` `.rules` files per config layer | developers.openai.com/codex/guides/agents-md, /codex/rules.md |
| Metadata | Layered `config.toml` (+profiles); YAML frontmatter on skills/prompts; TOML fields on agents; `agents/openai.yaml` interface block | developers.openai.com/codex/config-basic, /codex/skills |
| Arguments | Prompt placeholders `$1`–`$9`, `$ARGUMENTS`, named `KEY=value`, `$$` (deprecated with prompts); CLI flags incl. repeatable `-c key=value` | developers.openai.com/codex/custom-prompts, /codex/cli/reference |
| Tools | `[mcp_servers.<name>]` tables (stdio + streamable HTTP), tool filtering + per-tool approval modes; built-in sandboxed shell, `web_search` | developers.openai.com/codex/mcp |
| Permissions | `sandbox_mode` × `approval_policy` (incl. granular categories) × Starlark exec-policy rules; network proxy domain allow/deny; protected paths; trust-gated project config | developers.openai.com/codex/agent-approvals-security, /codex/rules.md |
