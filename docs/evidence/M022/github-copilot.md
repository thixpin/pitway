# GitHub Copilot — Agent Driver Format Evidence (M022/T003)

- **Tool**: GitHub Copilot — specifically its agentic surfaces: Copilot CLI, Copilot coding/cloud agent, and the customization files shared with agent mode in IDEs.
- **Research date**: 2026-08-22
- **Method**: web research against official GitHub documentation (docs.github.com) and the GitHub changelog (github.blog). Pages were fetched and summarized on the research date; Copilot surfaces evolve quickly and several features (e.g. prompt files) are documented as public preview.
- **Sources consulted** (all fetched during this task):
  - https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions
  - https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions
  - https://docs.github.com/en/copilot/concepts/agents/about-agent-skills
  - https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-skills
  - https://github.blog/changelog/2025-12-18-github-copilot-now-supports-agent-skills/
  - https://docs.github.com/en/copilot/reference/custom-agents-configuration
  - https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli
  - https://docs.github.com/en/copilot/tutorials/customization-library/prompt-files/your-first-prompt-file
  - https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-copilot-cli
  - https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/allowing-tools
  - https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/configure-copilot-cli
  - https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers
  - https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/extend-coding-agent-with-mcp

## 1. Skills

Copilot supports **Agent Skills** — "folders of instructions, scripts, and resources that Copilot can load when relevant to improve its performance in specialized tasks." GitHub documents the Agent Skills specification as an open standard used by a range of AI systems (announced 2025-12-18: https://github.blog/changelog/2025-12-18-github-copilot-now-supports-agent-skills/).

- **Format**: a directory per skill containing a `SKILL.md` file (Markdown with YAML frontmatter) plus optional supplementary files/scripts. Required frontmatter: `name` ("must be lowercase, using hyphens for spaces") and `description` ("what the skill does, and when Copilot should use it"). Optional: `license`, and `allowed-tools` (tools, e.g. `shell`, that Copilot may use without confirmation while the skill runs). (https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-skills)
- **Locations**: project skills in `.github/skills`, `.claude/skills`, or `.agents/skills`; personal skills in `~/.copilot/skills` or `~/.agents/skills`. Note the explicit cross-tool compatibility: Copilot reads Claude Code's `.claude/skills` directory and the `.agents/skills` convention. (https://docs.github.com/en/copilot/concepts/agents/about-agent-skills)
- **Discovery/invocation**: Copilot decides when to use a skill from the prompt and the skill's `description`; when chosen, `SKILL.md` is injected into the agent's context. In the CLI a skill can also be invoked explicitly with `/SKILL-NAME`. `gh skill` in GitHub CLI discovers/installs skills from repositories. (same two sources)
- **Surfaces**: skills work with "Copilot cloud agent, Copilot code review, the GitHub Copilot CLI, the GitHub Copilot app, and agent mode in Visual Studio Code and JetBrains IDEs." (https://docs.github.com/en/copilot/concepts/agents/about-agent-skills)

## 2. Commands

Copilot's reusable-command surface is **prompt files** plus built-in slash commands:

- **Prompt files**: Markdown files named `*.prompt.md` stored in `.github/prompts`, invoked as slash commands in Copilot Chat (e.g. `explain-code.prompt.md` → `/explain-code`). Documented frontmatter in the tutorial example includes `agent` and `description`; the docs list `mode`, `model`, `tools`, `description` as frontmatter fields and mark prompt files as public preview, "subject to change". Prompt files are documented as available in VS Code, Visual Studio, and JetBrains IDEs (not the CLI). (https://docs.github.com/en/copilot/tutorials/customization-library/prompt-files/your-first-prompt-file, https://docs.github.com/en/copilot/concepts/prompting/response-customization)
- **CLI slash commands**: the Copilot CLI ships built-in interactive commands, e.g. `/sandbox enable`, `/compact`, `/context`, `/mcp`, `/model`, `/allow-all`, `/yolo`, `/feedback`, `/agent`, plus `/SKILL-NAME` for explicit skill invocation. User-defined slash commands in the CLI are not documented as a distinct mechanism separate from skills and prompt files. (https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-copilot-cli)

## 3. Agents

Copilot has first-class **custom agents**, defined as Markdown "agent profiles" with YAML frontmatter:

- **Frontmatter fields** (reference: https://docs.github.com/en/copilot/reference/custom-agents-configuration): `name` (optional display name), `description` (required), `target` (`vscode` or `github-copilot`), `tools` (tool names the agent can use), `model`, `disable-model-invocation` (bool — prevents the cloud agent auto-delegating to it), `user-invocable` (bool), `mcp-servers` (additional MCP servers/tools for this agent), `metadata` (free-form name/value annotations). The file name (minus `.md` or `.agent.md`) is used for deduplication.
- **Locations**: repository level `.github/agents/`; for the CLI additionally user level `~/.copilot/agents/` (home directory wins on name conflict); organization level in the `/agents` directory of the org's `.github` or `.github-private` repository. CLI file naming: `NAME.agent.md`. (https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli, custom-agents search results at https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-custom-agents)
- **Invocation** (CLI): `/agent` picker in interactive mode, natural-language delegation ("Use the security-auditor agent on..."), automatic inference, or `copilot --agent NAME --prompt "..."`. (create-custom-agents-for-cli, above)
- **Surfaces**: Copilot cloud agent on GitHub.com, the Copilot CLI, JetBrains/Eclipse/Xcode (public preview), and VS Code with caveats. (https://docs.github.com/en/copilot/reference/custom-agents-configuration)
- Separately, the **Copilot coding agent** (cloud agent) is itself the autonomous-agent product these profiles customize; the CLI also has "built-in specialized agents that automatically delegate common tasks." (https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-copilot-cli)

## 4. Rules / instructions

Copilot has a layered custom-instructions system (https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions):

- **Repository-wide**: `.github/copilot-instructions.md`.
- **Path-specific**: `NAME.instructions.md` files under `.github/instructions/` (and subdirectories), with frontmatter `applyTo` (glob) and optional `excludeAgent` (`code-review` or `cloud-agent`).
- **Agent instructions**: `AGENTS.md` files anywhere in the repository (nearest one takes precedence), or a single root `CLAUDE.md` or `GEMINI.md` as alternatives — explicit read-compatibility with other tools' rule files.
- **Precedence**: "Personal instructions take the highest priority. Repository instructions come next, and then organization instructions are prioritized last." Repository-wide and path-specific instructions that both apply are combined.
- **CLI specifics** (https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions): additionally reads user-level `$HOME/.copilot/copilot-instructions.md` and `$HOME/.copilot/instructions/**/*.instructions.md`, `.claude/CLAUDE.md`, and directories listed in the `COPILOT_CUSTOM_INSTRUCTIONS_DIRS` environment variable. Discovery scans repository root, cwd, intermediate directories, and directories in the path of files being worked on. The CLI "combines their instructions" and "does not define a general precedence order between these files."

## 5. Metadata

Metadata is carried as YAML frontmatter per artifact type, not as a single unified schema:

- Instructions files: `applyTo`, `excludeAgent` (https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions).
- Skills: `name`, `description`, `license`, `allowed-tools` in `SKILL.md` (https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-skills).
- Custom agents: `name`, `description`, `target`, `tools`, `model`, `disable-model-invocation`, `user-invocable`, `mcp-servers`, plus an explicit free-form `metadata` name/value field for annotating agents "with useful data" (https://docs.github.com/en/copilot/reference/custom-agents-configuration).
- Prompt files: `agent`/`mode`, `model`, `tools`, `description` (public preview; https://docs.github.com/en/copilot/tutorials/customization-library/prompt-files/your-first-prompt-file).

## 6. Arguments

- **Prompt files** support typed input variables with the syntax `${input:variable_name:prompt_text}` (e.g. `${input:code:Paste your code here}`), prompting the user for values at invocation. (https://docs.github.com/en/copilot/tutorials/customization-library/prompt-files/your-first-prompt-file)
- **Custom agents** take no documented parameter syntax of their own; the CLI passes work via `--prompt` alongside `--agent` (https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli).
- **Skills** have no documented argument syntax; `/SKILL-NAME` references a skill inside a prompt rather than parameterizing it (https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-skills).
- No generic `$ARGUMENTS`/`{{args}}`-style placeholder (as in Claude Code or Gemini CLI custom commands) was found in the official Copilot docs consulted.

## 7. Tools

- **Built-in tool kinds** (CLI permission system enumerates them): `shell`, `write`, `read`, `web_fetch`, `web_search`, and MCP tools; the docs indicate additional kinds exist. (https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/allowing-tools)
- **MCP (CLI)**: servers configured in `~/.copilot/mcp-config.json` (location movable via `COPILOT_HOME`), managed with `/mcp` commands in interactive mode (`/mcp show`, `/mcp edit SERVER-NAME`, `/mcp delete`, `/mcp disable`) or `copilot mcp` subcommands. (https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers)
- **MCP (coding agent)**: configured by repository admins as JSON in repository Settings > Copilot > MCP servers, shape `{"mcpServers": {"SERVER_NAME": {"type": "local|stdio|http|sse", "command": ..., "args": [...], "tools": [...]}}}`; the `tools` field is mandatory (array of names or `"*"`). Secrets must be named with the `COPILOT_MCP_` prefix to be visible (`$COPILOT_MCP_API_KEY`). The GitHub MCP server and Playwright MCP server are enabled by default. (https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/extend-coding-agent-with-mcp)
- **Per-artifact tool scoping**: custom agents scope tools via the `tools` and `mcp-servers` frontmatter fields; skills via `allowed-tools`. (sources in sections 1 and 3)

## 8. Permissions

Copilot CLI has an explicit, pattern-based tool-permission system (https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/allowing-tools):

- Patterns use `Kind(argument)` syntax: `--allow-tool='shell(git commit)'`, `--deny-tool='shell(rm)'`, `--allow-tool='MyMCP(create_issue)'`; omitting the argument matches the whole kind.
- Flags: `--allow-tool`, `--deny-tool`, `--available-tools` / `--excluded-tools` (restrict what the model even sees), `--allow-all-tools` / `--allow-all` / `--yolo`. **Deny rules always take precedence over allow rules**, even under `--allow-all` or saved approvals.
- Interactive approvals persist to `~/.copilot/permissions-config.json`; URL approvals go to `~/.copilot/settings.json`. In-session slash commands: `/allow-all`, `/yolo`, `/reset-allowed-tools`.
- Additional CLI controls: `--allow-all-paths`, `--disallow-temp-dir`, `--allow-url=DOMAIN` / `--deny-url=DOMAIN`, and trusted directories recorded in `~/.copilot/config.json` (`trustedFolders`), relocatable via `COPILOT_HOME`. (https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/configure-copilot-cli)
- Coding agent side: the GitHub MCP server runs with "a specially scoped token that only has read-only access to the current repository" by default, and MCP secrets are gated by the `COPILOT_MCP_` naming convention. (https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/extend-coding-agent-with-mcp)

## Summary table

| Dimension | Copilot representation | Key source |
|---|---|---|
| Skills | Agent Skills open standard: `SKILL.md` (frontmatter `name`, `description`, `license`, `allowed-tools`) in `.github/skills` / `.claude/skills` / `.agents/skills` / `~/.copilot/skills` / `~/.agents/skills` | docs.github.com/en/copilot/concepts/agents/about-agent-skills |
| Commands | Prompt files `.github/prompts/*.prompt.md` → slash commands (IDE surfaces, preview); built-in CLI slash commands | docs.github.com/en/copilot/tutorials/customization-library/prompt-files/your-first-prompt-file |
| Agents | Agent profiles `.github/agents/*.agent.md` (+ `~/.copilot/agents/`, org `.github` repo); frontmatter incl. `tools`, `model`, `mcp-servers`; CLI `--agent`, cloud agent auto-delegation | docs.github.com/en/copilot/reference/custom-agents-configuration |
| Rules/instructions | `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md` (`applyTo`), `AGENTS.md` (nearest wins), `CLAUDE.md`/`GEMINI.md` fallbacks, user-level `~/.copilot/` variants | docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions |
| Metadata | Per-artifact YAML frontmatter; custom agents include a free-form `metadata` map | docs.github.com/en/copilot/reference/custom-agents-configuration |
| Arguments | Prompt-file `${input:name:prompt}` variables; no generic args placeholder found for skills/agents | docs.github.com/en/copilot/tutorials/customization-library/prompt-files/your-first-prompt-file |
| Tools | Built-in kinds (`shell`, `write`, `read`, `web_fetch`, `web_search`) + MCP via `~/.copilot/mcp-config.json` (CLI) or repo settings JSON (coding agent, `tools` field mandatory) | docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers |
| Permissions | `Kind(argument)` allow/deny patterns, deny-wins; `permissions-config.json`; URL/path controls; trusted folders; read-only default token for coding agent | docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/allowing-tools |
