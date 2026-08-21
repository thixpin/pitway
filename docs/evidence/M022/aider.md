# Aider — Driver Format Evidence (M022)

- **Tool**: Aider (aider.chat) — open-source terminal AI pair-programming tool
- **Researched**: 2026-08-22 (latest numbered release visible in official release history at that date: v0.86.1)
- **Sources consulted** (all fetched live during research):
  - https://aider.chat/docs/usage/conventions.html
  - https://aider.chat/docs/usage/commands.html
  - https://aider.chat/docs/usage/modes.html
  - https://aider.chat/docs/usage/watch.html
  - https://aider.chat/docs/usage/lint-test.html
  - https://aider.chat/docs/config/aider_conf.html
  - https://aider.chat/docs/config/options.html
  - https://aider.chat/docs/config/adv-model-settings.html
  - https://aider.chat/docs/more/edit-formats.html
  - https://aider.chat/docs/scripting.html
  - https://aider.chat/HISTORY.html

Aider is architecturally simpler than the other tools surveyed in this milestone: it is a single-session terminal chat loop with git integration, not an extensible agent platform. Several dimensions below are therefore honest "not applicable" findings — that absence is itself the evidence.

## 1. Skills

**Not applicable — no skills concept is documented.** Aider's official documentation describes no packaged, reusable capability unit (no skills directory, no skill manifest, no on-demand instruction loading mechanism). The nearest analogs are:

- **Conventions files**: freeform markdown guideline files loaded into the chat as read-only context (see Rules/Instructions below). Aider maintains a community "conventions repository" for sharing them, but they are plain prose, not executable or structured capabilities. Source: https://aider.chat/docs/usage/conventions.html
- **`/load`**: "Load and execute commands from a file" — a scripted replay of in-chat commands (paired with `/save`, which saves commands to reconstruct the current session), not a skill package. Source: https://aider.chat/docs/usage/commands.html

## 2. Commands

Aider has a fixed set of **built-in in-chat slash commands**; the official docs document **no user-defined custom command mechanism** (no command files, no per-project command directory). Source: https://aider.chat/docs/usage/commands.html

Representative built-ins (full list on the source page):

- File/context management: `/add`, `/drop`, `/read-only`, `/ls`, `/reset`, `/tokens`, `/map`, `/map-refresh`
- Mode switching: `/code`, `/ask`, `/architect`, `/chat-mode`, `/context`
- Git: `/commit`, `/diff`, `/undo`, `/git` (run a git command, output excluded from chat)
- Execution: `/run` (alias `!`, run a shell command), `/test` (run a shell command and add output to chat on non-zero exit), `/lint`
- Model control: `/model`, `/models`, `/editor-model`, `/weak-model`, `/reasoning-effort`, `/think-tokens`
- Session: `/save`, `/load`, `/clear`, `/copy`, `/copy-context`, `/settings`, `/exit`/`/quit`
- Misc: `/web` (scrape a webpage to markdown), `/voice`, `/paste`, `/editor`, `/multiline-mode`, `/help`, `/report`

The commands page also documents Emacs and Vi keybinding modes for the chat input.

## 3. Agents

**Not applicable as subagents — Aider has no subagent/agent-definition concept.** Official docs describe no agent files, no delegation to isolated agent contexts, and no multi-agent orchestration.

The closest analog is **architect mode's two-model split** (a pipeline, not an agent system): "First, it sends your request to the main model which will act as an architect to propose how to solve your coding request," then a second **editor model** turns that proposal into concrete file edits (`--editor-model <model>`, or auto-selected). There are also role-specialized model slots — `--weak-model` for commit messages and history summarization — but these are model assignments within one session, not separately defined agents. Sources: https://aider.chat/docs/usage/modes.html, https://aider.chat/docs/config/options.html

## 4. Rules / Instructions

Aider's instruction mechanism is the **conventions file** — typically `CONVENTIONS.md`, though the name is a convention, not a magic filename. Key properties (source: https://aider.chat/docs/usage/conventions.html):

- Loaded explicitly, three ways: in-chat `/read CONVENTIONS.md`; launch flag `aider --read CONVENTIONS.md`; or persistently in `.aider.conf.yml`:
  ```yaml
  read: CONVENTIONS.md
  # or multiple files:
  read: [CONVENTIONS.md, anotherfile.txt]
  ```
- Docs recommend `/read` / `--read` so the file "is marked as read-only, and cached if prompt caching is enabled."
- Content is freeform markdown guidance (e.g. "Prefer httpx over requests", "Use types everywhere possible").

**Notably, there is no auto-loaded rules file**: unlike tools with an implicit project instructions file, Aider's docs instruct the user to load conventions explicitly (or wire them into config). A related instruction channel is **watch mode** (`--watch-files`): inline "AI comments" in any source file — `# ... AI!` triggers an edit, `AI?` asks a question, a plain `AI` marker stages instructions — working with any editor/IDE. Source: https://aider.chat/docs/usage/watch.html

## 5. Metadata

Aider's metadata surface is **model metadata**, in two dedicated files (source: https://aider.chat/docs/config/adv-model-settings.html):

- **`.aider.model.settings.yml`** — a YAML list of per-model settings dictionaries; searched in home directory, git repo root, current directory, or via `--model-settings-file <filename>`. Documented fields include `name`, `edit_format`, `weak_model_name`, `use_repo_map`, `examples_as_sys_msg`, `extra_params` (passed through to `litellm.completion()`), `cache_control`, `use_system_prompt`, `use_temperature`, `streaming`, `editor_model_name`, `editor_edit_format`, `reasoning_tag`, `remove_reasoning`, `accepts_settings`. A special `aider/extra_params` model name applies `extra_params` across all models.
- **`.aider.model.metadata.json`** — registers "context window limits and costs for models that aren't known to aider", keyed by provider-qualified model names (e.g. `deepseek/deepseek-chat`), with fields such as `max_tokens`, `max_input_tokens`, `max_output_tokens`, `input_cost_per_token`, `output_cost_per_token`, `litellm_provider`, `mode`. Aider "relies on litellm's model_prices_and_context_window.json file" as its upstream metadata source.

There is **no documented task/command/agent metadata format** (no frontmatter schemas for prompts or commands) — metadata in Aider means model capability/pricing data only.

## 6. Arguments

Aider's argument surface is its **CLI options plus a layered configuration system** (sources: https://aider.chat/docs/config/options.html, https://aider.chat/docs/config/aider_conf.html):

- **Precedence**: command-line flags > environment variables > config files. Every flag maps to an env var by the convention `AIDER_` + uppercase + hyphens→underscores (e.g. `--auto-commits` ↔ `AIDER_AUTO_COMMITS`); env vars can also be supplied via `.env`.
- **`.aider.conf.yml`**: searched in home directory, then git repo root, then current working directory, with later files taking precedence; `--config <filename>` loads only that file. YAML keys mirror the flag names (`model`, `file`, `read`, `auto-commits`, `lint-cmd`, `test-cmd`, `yes-always`, `watch-files`, `dry-run`, ...).
- **Key flag groups**: model selection (`--model`, `--weak-model`, `--editor-model`, `--architect`); files (`--file`, `--read`, `--aiderignore`); git (`--git`/`--no-git`, `--auto-commits`, `--dirty-commits`, `--commit`, `--attribute-author` etc.); quality (`--lint`, `--lint-cmd`, `--auto-lint`, `--test-cmd`, `--auto-test`, `--test`); modes (`--message`/`-m`, `--message-file`/`-f`, `--gui`, `--yes-always`, `--dry-run`); API keys (`--api-key PROVIDER=KEY`, `--set-env VAR=value`).
- **Scripting** (source: https://aider.chat/docs/scripting.html): `--message "..."` processes one instruction and exits (the scripting page pairs it with a `--yes` auto-confirm flag; the options reference documents `--yes-always`). There is also a Python API (`from aider.coders import Coder; Coder.create(main_model=..., fnames=[...])`, `coder.run(...)`, `InputOutput(yes=True)`), with the explicit caveat that "the python scripting API is not officially supported or documented, and could change in future releases without providing backwards compatibility."

There is **no per-command argument templating** (nothing like `$ARGUMENTS` placeholders in prompt files), because there are no user-defined command files (see Commands).

## 7. Tools

**Largely not applicable — Aider has no extensible tool-calling framework.**

- **Editing is text-format-based, not tool-call-based.** Aider defines "edit formats" the LLM emits directly in its reply text: `whole` (full updated file), `diff` (search/replace blocks "similar to the git merge conflict resolution markings"), `diff-fenced` (Gemini-oriented variant), `udiff` (simplified unified diff, used to curb GPT-4 Turbo "lazy coding"), and `editor-diff`/`editor-whole` for architect mode's editor model. These are structured text responses, not function/tool calls. Source: https://aider.chat/docs/more/edit-formats.html
- **Built-in capabilities** stand in for tools: the repository map (`/map`, `use_repo_map` model setting), shell execution via `/run` and `/test`, lint/test hooks (`--lint-cmd`, `--test-cmd`, `--auto-lint`, `--auto-test` — "Aider will try and fix any errors if the command returns a non-zero exit code"), web scraping via `/web`, and voice input via `/voice`. Sources: https://aider.chat/docs/usage/lint-test.html, https://aider.chat/docs/usage/commands.html
- **No MCP support in mainline Aider as of v0.86.1**: checked 2026-08-22, neither the official docs site nor the release history (https://aider.chat/HISTORY.html, latest numbered release v0.86.1) mentions Model Context Protocol support. Third-party claims that "recent releases add MCP client support" are uncorroborated by the official release history; the MCP integrations that do exist are third-party *wrappers* that expose Aider as an MCP server to other clients (e.g. https://mcpservers.org/servers/disler/aider-mcp-server), not Aider consuming MCP tools.

## 8. Permissions

Aider has **no permission-rule configuration language** (no allow/deny lists per tool or path). Its permission model is interactive confirmation plus a set of opt-in/opt-out flags (sources: https://aider.chat/docs/config/options.html, https://aider.chat/docs/scripting.html, https://aider.chat/docs/usage/conventions.html):

- **Confirmation prompts** gate actions in the chat (adding files, running suggested shell commands); `/ok` is documented as shorthand for approving changes. `--yes-always` gives "automatic confirmation to all prompts" (the scripting page uses `--yes` for unattended runs).
- **Shell-command suggestion control**: `--suggest-shell-commands` / `--no-suggest-shell-commands` (default true; env `AIDER_SUGGEST_SHELL_COMMANDS`), used to disable command suggestions e.g. in scripted runs.
- **Read-only scoping**: `--read` / `/read-only` mark files as reference-only so Aider will not edit them; `--file` marks editable files.
- **Exclusion**: `--aiderignore` points at an ignore file; `--subtree-only` (config `subtree-only`) restricts attention to a subtree.
- **Git guardrails**: `--no-git` disables git integration entirely; `--auto-commits`/`--no-auto-commits` and `--dirty-commits` control commit behavior; `--dry-run` previews changes without modifying files; `/undo` reverts Aider's last commit.

## Summary Table

| Dimension | Aider's representation | Verdict |
|---|---|---|
| Skills | None documented; nearest analogs: conventions files, `/save`+`/load` command replay | **Not applicable** |
| Commands | Fixed built-in slash command set (`/add`, `/run`, `/commit`, ...); no user-defined commands documented | Built-in only |
| Agents | None; closest analog is architect mode's main-model → editor-model pipeline (`--architect`, `--editor-model`) | **Not applicable** |
| Rules/Instructions | Conventions files (e.g. `CONVENTIONS.md`) loaded explicitly via `/read`, `--read`, or `read:` in `.aider.conf.yml`; no auto-loaded rules file; watch-mode `AI!`/`AI?` inline comments | Explicit-load prose files |
| Metadata | Model metadata only: `.aider.model.settings.yml` + `.aider.model.metadata.json` (litellm-backed) | Model-scoped |
| Arguments | CLI flags > `AIDER_*` env vars > `.aider.conf.yml`/`.env`; `--message` one-shot; unofficial Python API | Layered config |
| Tools | No tool-calling framework, no MCP in mainline (as of v0.86.1); text edit formats (`whole`, `diff`, `udiff`, ...) + fixed built-ins (`/run`, `/test`, `/web`, repo map) | **Mostly not applicable** |
| Permissions | Interactive confirmations + flags (`--yes-always`, `--no-suggest-shell-commands`, `--read`, `--aiderignore`, `--dry-run`, `--no-git`); no rule language | Prompt-based |
