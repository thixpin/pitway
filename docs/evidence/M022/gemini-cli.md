# Gemini CLI — Agent Driver Format Evidence (M022/T003)

- **Tool**: Gemini CLI — Google's open-source terminal coding agent (https://github.com/google-gemini/gemini-cli).
- **Research date**: 2026-08-22
- **Method**: web research against the official documentation in the `google-gemini/gemini-cli` repository (`docs/` on `main`, navigated via `docs/sidebar.json`). Pages were fetched and summarized on the research date; the project moves fast (some features below are marked experimental in the docs).
- **Sources consulted** (all fetched during this task, from `https://raw.githubusercontent.com/google-gemini/gemini-cli/main/`):
  - docs/sidebar.json
  - docs/cli/skills.md
  - docs/cli/creating-skills.md
  - docs/cli/custom-commands.md
  - docs/core/subagents.md
  - docs/cli/gemini-md.md
  - docs/reference/configuration.md
  - docs/reference/policy-engine.md
  - docs/tools/mcp-server.md
  - docs/extensions/reference.md
  - docs/reference/tools.md

## 1. Skills

Gemini CLI implements **Agent Skills** based on the same open standard Copilot and Claude Code use: a skill is a "self-contained directory that packages instructions and assets into a discoverable capability." (https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/cli/skills.md)

- **Locations**, four tiers, lowest→highest precedence: built-in skills; extension skills; user skills (`~/.gemini/skills/` or `~/.agents/skills/`); workspace skills (`.gemini/skills/` or `.agents/skills/`). Within a tier, `.agents/skills/` takes precedence over `.gemini/skills/` — another explicit adoption of the cross-tool `.agents/` convention.
- **Format**: `SKILL.md` with YAML frontmatter; documented fields are `name` ("a unique identifier for the skill. This should match the directory name") and `description` ("CRITICAL. This is how Gemini decides when to use the skill"). Recommended layout adds optional `scripts/`, `references/`, `assets/` directories. (https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/cli/creating-skills.md)
- **Lifecycle**: discovery (names + descriptions injected into the system prompt) → activation (model calls the built-in `activate_skill` tool) → user consent prompt → injection of `SKILL.md` content and directory access.
- **Management**: `gemini skills list --all`, `gemini skills install <url> --consent`, `gemini skills uninstall <name> --scope workspace`; in-session `/skills list|link|disable|enable|reload`. (docs/cli/skills.md)

## 2. Commands

**Custom commands** are TOML files (https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/cli/custom-commands.md):

- **Locations**: global `~/.gemini/commands/`; project `<project-root>/.gemini/commands/` (project overrides global on name clash). Extensions can bundle more in a `commands/` subdirectory (docs/extensions/reference.md).
- **Fields**: required `prompt` ("the prompt that will be sent to the Gemini model when the command is executed"); optional `description`.
- **Namespacing**: subdirectory path becomes a colon-namespaced name — `~/.gemini/commands/test.toml` → `/test`; `.gemini/commands/git/commit.toml` → `/git:commit`.

## 3. Agents

Gemini CLI has **subagents** (https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/core/subagents.md):

- **Locations**: project `.gemini/agents/*.md`; user `~/.gemini/agents/*.md`; extensions can also ship agent `.md` files in an `agents/` directory (docs/extensions/reference.md).
- **Format**: Markdown with YAML frontmatter; the body is the subagent's system prompt. Required: `name` (lowercase letters/numbers/hyphens/underscores), `description` (drives delegation decisions). Optional: `kind` (`local` default, or `remote`), `tools` (array of permitted tool names, wildcards `*`, `mcp_*`, `mcp_server_*` supported), `mcpServers` (inline per-agent MCP servers), `model`, `temperature` (0.0–2.0), `max_turns` (default 30), `timeout_mins`.
- **Invocation**: automatic delegation by the main agent based on descriptions, or explicit routing with `@agent-name` at the start of a prompt.
- **Isolation**: subagents run in isolated contexts with restricted tools; omitting `tools` inherits all parent tools; recursion protection prevents subagents from calling other subagents even with `*`. The docs also cover `remote-agents` (docs/core/remote-agents per docs/sidebar.json), matching the `kind: remote` field.

## 4. Rules / instructions

Context/instructions live in **GEMINI.md** files, loaded hierarchically (https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/cli/gemini-md.md):

- **Tiers**: global `~/.gemini/GEMINI.md`; workspace (`GEMINI.md` in configured workspace directories and their parents); just-in-time (when tools touch a file, the CLI "automatically scans for GEMINI.md files in that directory and its ancestors up to a trusted root").
- **Composition**: `@file.md` import syntax with relative (`@./components/instructions.md`) and absolute (`@../shared/style-guide.md`) paths.
- **Renameable**: `context.fileName` in `settings.json` accepts a single filename or an array (so e.g. `AGENTS.md` can be used); default is `GEMINI.md`. Extensions ship their own context file, defaulting to `GEMINI.md`, via `contextFileName` in `gemini-extension.json` (docs/extensions/reference.md).
- **Inspection**: `/memory show` (concatenated active context) and `/memory reload`; the footer shows the count of loaded context files.

## 5. Metadata

No single unified metadata schema; each artifact type carries its own declared shape:

- Skills: `SKILL.md` frontmatter `name`, `description` (docs/cli/creating-skills.md).
- Subagents: frontmatter `name`, `description`, `kind`, `tools`, `mcpServers`, `model`, `temperature`, `max_turns`, `timeout_mins` (docs/core/subagents.md).
- Commands: TOML `prompt`, `description` (docs/cli/custom-commands.md).
- Extensions: `gemini-extension.json` manifest with `name`, `version`, `description`, `mcpServers`, `contextFileName`, `excludeTools`, `migratedTo`, `plan`, `settings`, `themes` (https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/extensions/reference.md).
- Settings: layered `settings.json` — system defaults, user `~/.gemini/settings.json`, project `.gemini/settings.json`, system overrides (exact per-OS paths in docs/reference/configuration.md).

## 6. Arguments

Custom commands have explicit argument handling (https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/cli/custom-commands.md):

- `{{args}}` in the `prompt` is replaced with everything the user typed after the command name; inside shell blocks the substitution is automatically shell-escaped.
- If `{{args}}` is absent, "the CLI will append the full command you typed to the end of the prompt, separated by two newlines."
- Dynamic injection in prompts: `!{...}` executes a shell command and injects its output; `@{...}` embeds file or directory content (supports images and PDFs, respects `.gitignore`).
- Subagents and skills take no documented positional-argument syntax; `@agent-name <prompt>` routes the remaining prompt to the subagent (docs/core/subagents.md).

## 7. Tools

- **Built-in tools** (exact registered names, https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/reference/tools.md): `run_shell_command`; file system `glob`, `grep_search`, `list_directory`, `read_file`, `read_many_files`, `replace`, `write_file`; interaction `ask_user`, `write_todos`; experimental task tracker `tracker_create_task` etc.; MCP `list_mcp_resources`, `read_mcp_resource`; `activate_skill`, `get_internal_docs`; planning `enter_plan_mode`, `exit_plan_mode`; web `google_web_search`, `web_fetch`. `/tools` lists active tools; "You must manually approve tools that modify files or execute shell commands (mutators)."
- **MCP servers** (https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/tools/mcp-server.md): configured under `mcpServers.<SERVER_NAME>` in `settings.json` with one transport key (`command` stdio / `url` SSE / `httpUrl` streaming HTTP) plus `args`, `env` (with `$VAR`/`${VAR}` expansion), `cwd`, `headers`, `timeout` (ms, default 600000), `trust` (bool, bypasses confirmations), `includeTools`, `excludeTools`. Global `mcp` object: `serverCommand`, `allowed`, `excluded`. Discovered tools get fully-qualified names `mcp_{serverName}_{toolName}`. Managed via `/mcp` (`list`, `auth`, `enable`, `disable`) and `gemini mcp add|remove|list`. Host env vars matching sensitive patterns (`*TOKEN*`, `*SECRET*`, `*PASSWORD*`, `*KEY*`, `*AUTH*`, `*CREDENTIAL*`) are redacted; only explicitly configured `env` values pass through.
- **Extensions as tool bundles**: an extension can package MCP servers, custom commands, skills, subagents, context files, hooks (`hooks/hooks.json`), policies (`policies/*.toml`), and themes; installed to `~/.gemini/extensions` via `gemini extensions install|update|link|disable|enable|config`. (docs/extensions/reference.md)

## 8. Permissions

Multiple layered mechanisms:

- **settings.json tool controls** (https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/reference/configuration.md): `tools.core` (allowlist restricting built-in tools), `tools.allowed` (names that bypass the confirmation dialog), `tools.exclude` (hidden from discovery), `tools.confirmationRequired` (always confirm); `general.defaultApprovalMode` with values `default`, `auto_edit`, `plan`.
- **Policy engine** (https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/reference/policy-engine.md): TOML rule files in `~/.gemini/policies/*.toml` (user) and OS-specific system directories (e.g. `/etc/gemini-cli/policies` on Linux) — plus extension/workspace tiers. Rule shape: `[[rule]]` with `toolName`, `argsPattern`, `commandPrefix`, `decision`, `priority` (0–999), `denyMessage`, `modes`, `interactive`. Decisions: `allow` (auto-execute), `deny` (blocked), `ask_user` (prompt). Final priority = tier base + (toml_priority / 1000), tiers Default(1) < Extension(2) < Workspace(3) < User(4) < Admin(5) — higher wins. The docs warn that underscores in MCP server names can break policy FQN parsing (`mcp_{server}_{tool}` split on first underscore; docs/tools/mcp-server.md).
- **Per-server / per-agent scoping**: MCP `trust`, `includeTools`, `excludeTools` per server; subagent `tools` allowlists; extension `excludeTools`. (sections 3 and 7 sources)
- **Trusted folders** exist as a dedicated mechanism (docs/cli/trusted-folders per docs/sidebar.json); details were not fetched in this pass, so no claims are made beyond its existence in the official docs tree.

## Summary table

| Dimension | Gemini CLI representation | Key source (repo docs, main) |
|---|---|---|
| Skills | Agent Skills standard: `SKILL.md` (`name`, `description`) in `~/.gemini/skills` / `.gemini/skills` / `.agents/skills`; `activate_skill` + consent; `gemini skills` / `/skills` | docs/cli/skills.md, docs/cli/creating-skills.md |
| Commands | TOML files in `~/.gemini/commands/` and `.gemini/commands/`; `prompt` + `description`; path→colon namespacing | docs/cli/custom-commands.md |
| Agents | Subagents: Markdown + frontmatter in `.gemini/agents/` / `~/.gemini/agents/`; `kind`, `tools`, `mcpServers`, `model`, `max_turns`; `@agent-name` or auto-delegation | docs/core/subagents.md |
| Rules/instructions | Hierarchical `GEMINI.md` (global/workspace/just-in-time), `@file.md` imports, renameable via `context.fileName` | docs/cli/gemini-md.md |
| Metadata | Per-artifact frontmatter/TOML + `gemini-extension.json` manifest + layered `settings.json` | docs/extensions/reference.md, docs/reference/configuration.md |
| Arguments | `{{args}}` (shell-escaped in `!{...}`), append-by-default, `!{shell}` and `@{file}` injection | docs/cli/custom-commands.md |
| Tools | Named built-ins (`run_shell_command`, `read_file`, ...) + MCP via `mcpServers` config (`mcp_{server}_{tool}` FQNs) + extension bundles | docs/reference/tools.md, docs/tools/mcp-server.md |
| Permissions | `tools.core/allowed/exclude/confirmationRequired`, `general.defaultApprovalMode`, TOML policy engine (allow/deny/ask_user, tiered priorities), per-server `trust`/include/exclude | docs/reference/configuration.md, docs/reference/policy-engine.md |
