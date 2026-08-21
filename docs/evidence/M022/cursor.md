# Cursor — Driver Format Research

- **Tool**: Cursor (AI code editor + Cursor CLI / Cloud Agents) — <https://cursor.com>
- **Research date**: 2026-08-22
- **Method**: live web research against official documentation at `cursor.com/docs` (the older `docs.cursor.com` host redirects there). All pages below were fetched unless marked secondary.
- **Sources consulted**:
  - Rules — <https://cursor.com/docs/rules>
  - Agent Skills — <https://cursor.com/docs/skills>
  - Subagents — <https://cursor.com/docs/subagents>
  - permissions.json reference — <https://cursor.com/docs/reference/permissions>
  - CLI permissions — <https://cursor.com/docs/cli/reference/permissions>
  - CLI slash commands — <https://cursor.com/docs/cli/reference/slash-commands>
  - MCP — <https://cursor.com/docs/context/mcp>
  - Changelog 1.6 (custom commands) — <https://cursor.com/changelog/1-6>
  - Changelog 2.4 announcement page (subagents/skills) — <https://cursor.com/changelog/2-4> (located via search; feature detail taken from the docs pages above)

Fidelity note: extractions were made through a summarizing fetch step; each exact field name below is attributed to the page it came from.

## 1. Skills

Cursor has first-class Agent Skills ([Agent Skills](https://cursor.com/docs/skills)): a skill is a folder containing a `SKILL.md` file. Discovery locations:

- Project: `.cursor/skills/` and `.agents/skills/` — a skills folder **anywhere inside the repo** is picked up, and skills in nested project directories are automatically scoped to files inside that directory (monorepo support). Nesting/category folders are allowed; discovery is recursive and the skill's name comes from the folder containing `SKILL.md`.
- User: `~/.cursor/skills/`, `~/.agents/skills/`.
- Compatibility paths: `.claude/skills/`, `.codex/skills/` (and `~/` variants) — Cursor deliberately reads other agents' skill directories.

`SKILL.md` frontmatter: required `name` (lowercase/numbers/hyphens, matching folder name) and `description`; optional `paths` (glob scoping), `disable-model-invocation` (when `true` the skill is only available as an explicit `/skill-name` slash invocation), `icon`, `color` (Custom Mode badge), and `metadata` (arbitrary key-value pairs). Invocation: automatic (agent decides relevance from `description`), manual via `/` in chat, or as a persistent session "Custom Mode". A built-in `/migrate-to-skills` skill converts legacy dynamic rules and slash commands into skills, using `disable-model-invocation` to preserve explicit-invocation behavior. Unlike Rules (always/conditionally included), skills are loaded dynamically when judged relevant (same source).

## 2. Commands

- **Built-in slash commands** — the CLI documents 33 built-ins ([CLI slash commands](https://cursor.com/docs/cli/reference/slash-commands)): mode switches (`/plan [prompt]`, `/ask`, `/debug [prompt]`, `/goal [objective]`), `/model [filter]`, `/run-everything [on|off|status]` (alias `/auto-run`), session management (`/clear` + aliases, `/resume`, `/fork`, `/rename <name>`), utilities (`/shell [command]` aliases `/sh`, `/run`; `/mcp [list|list-tools]`; `/config`; `/logs`).
- **Custom commands** — introduced as markdown files in `.cursor/commands/[command].md`, surfaced in the `/` dropdown, intended as shareable reusable prompts ([Changelog 1.6](https://cursor.com/changelog/1-6)). At research time the docs commands page (`cursor.com/docs/agent/chat/commands`) redirects to the Skills documentation: Cursor is folding custom commands into skills (`disable-model-invocation: true` reproduces command semantics, and `/migrate-to-skills` migrates them — [Agent Skills](https://cursor.com/docs/skills)). Community reports also describe user-level commands (`~/.cursor/commands`), but no official page confirming that path was captured — **unverified**.

## 3. Agents

- **Subagents** ([Subagents](https://cursor.com/docs/subagents)): markdown files with YAML frontmatter in project `.cursor/agents/` or user `~/.cursor/agents/`, with cross-tool compatibility reads of `.claude/agents/` and `.codex/agents/` (priority `.cursor/` > `.claude/` > `.codex/`). Frontmatter fields (all optional): `name` (defaults to filename), `description` (shown in Task-tool hints), `model` (`inherit` default, or a model ID with bracketed parameters, e.g. `composer-2.5[fast=false]`, `claude-opus-5[effort=high]`), `readonly` (restrict writes), `is_background` (async execution). Invocation is automatic (delegation by description) or explicit (`/verifier ...`, or naming the subagent in prose); subagents run in isolated context windows, in parallel, can nest (limited depth), can run in cloud VMs via `/in-cloud`, and can be resumed by agent ID.
- **Built-in subagents**: `Explore` (codebase search/analysis), `Bash` (shell command series), `Browser` (browser control via MCP tools) — deployed automatically, no configuration (same source).
- **Agent modes**: Agent / Plan (`/plan`) / Ask (`/ask`) / debug modes are session modes, per the CLI slash-command reference above; skills can also act as persistent Custom Modes ([Agent Skills](https://cursor.com/docs/skills)). Cloud Agents run in remote environments (referenced by the subagents doc's cloud execution; not separately fetched).

## 4. Rules / instructions

([Rules](https://cursor.com/docs/rules)) Project rules are `.mdc` files in `.cursor/rules`, version-controlled; a plain `.md` file there is ignored because it lacks frontmatter. Frontmatter fields: `description` (used by the agent to judge relevance), `globs` (comma-separated file patterns, e.g. `src/components/**/*.tsx`), `alwaysApply` (boolean). Four application types: Always Apply (`alwaysApply: true`), Apply Intelligently (agent evaluates `description`), Apply to Specific Files (glob match), Apply Manually (`@`-mention only). Additional layers:

- **User Rules**: global, defined in settings; applied only to Agent chat, not Inline Edit.
- **Team Rules**: Team/Enterprise plans, managed in the dashboard; precedence Team Rules → Project Rules → User Rules (merged, earlier source wins on conflict).
- **Remote rules**: `.mdc` files importable from GitHub repos into `.cursor/rules/imported/<repoName>`.
- **`AGENTS.md`**: supported in project root or subdirectories as a "plain markdown file without metadata" — the simple-alternative instruction format (same source). Legacy `.cursorrules` single-file support exists historically but was not captured from a fetched page in this research — **unverified here**.

## 5. Metadata

Cursor's metadata lives in per-artifact YAML frontmatter plus JSON config files:

- Rule `.mdc` frontmatter: `description`, `globs`, `alwaysApply` ([Rules](https://cursor.com/docs/rules)).
- `SKILL.md` frontmatter: `name`, `description`, `paths`, `disable-model-invocation`, `icon`, `color`, and notably a free-form `metadata` key-value map — an explicit arbitrary-metadata slot ([Agent Skills](https://cursor.com/docs/skills)).
- Subagent frontmatter: `name`, `description`, `model`, `readonly`, `is_background` ([Subagents](https://cursor.com/docs/subagents)).
- `mcp.json` supports config interpolation variables: `${env:NAME}`, `${userHome}`, `${workspaceFolder}`, `${workspaceFolderBasename}`, `${pathSeparator}` ([MCP](https://cursor.com/docs/context/mcp)).

## 6. Arguments

No general placeholder-substitution mechanism (nothing like `$1`/`$ARGUMENTS`) was found in the fetched official docs for custom commands or skills — stated explicitly rather than assumed absent-or-present:

- Built-in slash commands take inline arguments per their signatures: `/model [filter]`, `/plan [prompt]`, `/rename <name>`, `/shell [command]`, `/mcp [list|list-tools] [identifier]` ([CLI slash commands](https://cursor.com/docs/cli/reference/slash-commands)). Explicit subagent invocation passes free text after the name (`/verifier confirm the auth flow` — [Subagents](https://cursor.com/docs/subagents)).
- Parameterization exists in the subagent `model` field's bracket syntax: `id[key=value]` pairs, e.g. `claude-opus-5[effort=high]`, `claude-opus-5[context=300k]` ([Subagents](https://cursor.com/docs/subagents)).
- For skills/commands, the user's request text serves as the argument; a formal positional-placeholder scheme, if any, is **not documented in the pages fetched**.

## 7. Tools

- **MCP** ([MCP](https://cursor.com/docs/context/mcp)): `mcpServers` object in project `.cursor/mcp.json` or global `~/.cursor/mcp.json`. STDIO fields: `type: "stdio"`, `command` (required), `args`, `env`, `envFile`. Remote fields: `url` (required), `headers`, `auth` (OAuth: `CLIENT_ID`, `CLIENT_SECRET`, `scopes`). Transports: stdio, SSE, Streamable HTTP. MCP tool calls require approval by default; enterprise admins can allowlist servers/tools via the dashboard. MCP image results use `type: "image"` + `data` + `mimeType`.
- **Built-in tool classes** — inferred from the CLI permission syntax, which gates them by name: `Shell(...)` (terminal), `Read(...)` / `Write(...)` (filesystem), `WebFetch(...)` (web), `Mcp(server:tool)` ([CLI permissions](https://cursor.com/docs/cli/reference/permissions)). This is evidence-by-permission-surface, not an official enumerated tool list.
- The built-in `Browser` subagent drives a browser "via MCP tools" ([Subagents](https://cursor.com/docs/subagents)).

## 8. Permissions

Two overlapping official mechanisms plus enterprise controls:

- **`permissions.json`** ([permissions.json reference](https://cursor.com/docs/reference/permissions)): optional `~/.cursor/permissions.json` (global) and `<workspace>/.cursor/permissions.json` (per-repo); arrays from both are concatenated. Fields: `mcpAllowlist` (string[], `server:tool` patterns, case-insensitive, wildcards `github:*`, `*:search`, `list_*`), `terminalAllowlist` (string[], case-sensitive prefix semantics — `git` matches all git subcommands, `git status` exact; `npm:install*` base`:`args-glob form), and `autoRun` (`allow_instructions` / `block_instructions` — natural-language steering for the Auto-review mode classifier). JSONC supported; files re-read on change. Priority: team admin dashboard controls > permissions.json > IDE settings UI; a key defined in permissions.json replaces the corresponding IDE allowlist entirely.
- **CLI permissions** ([CLI permissions](https://cursor.com/docs/cli/reference/permissions)): `permissions.allow` / `permissions.deny` arrays in global `~/.cursor/cli-config.json` or project `.cursor/cli.json`, entries typed by tool class: `Shell(commandBase)` (e.g. `Shell(git)`, `Shell(curl:*)`), `Read(pathOrGlob)`, `Write(pathOrGlob)`, `WebFetch(domainOrPattern)` (`*`, `*.example.com`, exact host), `Mcp(server:tool)` (e.g. `Mcp(datadog:*)`). Deny rules take precedence over allow rules; glob wildcards `**`, `*`, `?`.
- **Defaults and enterprise**: terminal commands need approval by default, relaxed via Run Modes / allowlists ([Agent Security](https://cursor.com/docs/agent/security) — located via search, summary-level); enterprises can protect the `.cursor` directory from agent modification and manage org-wide allowlists ([LLM Safety and Controls](https://cursor.com/docs/enterprise/llm-safety-and-controls) — located via search, summary-level). Cursor 2.5 added "Sandbox Access Controls" and subagent permission semantics such as `readonly` frontmatter ([Changelog 2.5](https://cursor.com/changelog/2-5) — secondary, title-level evidence; the `readonly` field itself is from the fetched [Subagents](https://cursor.com/docs/subagents) doc).

## Summary table

| Dimension | Cursor representation | Primary source |
|---|---|---|
| Skills | `SKILL.md` folders in `.cursor/skills` / `.agents/skills` (+ `.claude`/`.codex` compat, user-level `~/…`); frontmatter `name`, `description`, `paths`, `disable-model-invocation`, `icon`, `color`, `metadata`; auto or `/skill-name`; monorepo auto-scoping | cursor.com/docs/skills |
| Commands | 33 built-in slash commands; custom `.cursor/commands/[command].md` — being merged into skills via `/migrate-to-skills` | cursor.com/docs/cli/reference/slash-commands, changelog/1-6 |
| Agents | Subagent markdown + frontmatter (`name`, `description`, `model`, `readonly`, `is_background`) in `.cursor/agents/` (+ compat dirs); built-ins Explore/Bash/Browser; parallel, nested, cloud, resumable | cursor.com/docs/subagents |
| Rules/instructions | `.cursor/rules/*.mdc` (frontmatter `description`, `globs`, `alwaysApply`; 4 application types); User Rules; Team Rules (dashboard); remote import; plain `AGENTS.md` alternative | cursor.com/docs/rules |
| Metadata | YAML frontmatter per artifact; skills carry a free-form `metadata` map; `mcp.json` interpolation variables | cursor.com/docs/skills, /docs/context/mcp |
| Arguments | Inline args on built-in commands; free text to subagents/skills; `model` bracket params `id[key=value]`; no documented `$1`-style placeholders | cursor.com/docs/cli/reference/slash-commands, /docs/subagents |
| Tools | `mcpServers` in `.cursor/mcp.json` / `~/.cursor/mcp.json` (stdio/SSE/Streamable HTTP); built-in Shell/Read/Write/WebFetch classes evidenced by permission syntax | cursor.com/docs/context/mcp, /docs/cli/reference/permissions |
| Permissions | `permissions.json` (`mcpAllowlist`, `terminalAllowlist`, `autoRun`); CLI `permissions.allow`/`deny` with `Shell()/Read()/Write()/WebFetch()/Mcp()` patterns, deny-wins; admin > file > IDE precedence; enterprise dashboard controls | cursor.com/docs/reference/permissions, /docs/cli/reference/permissions |
