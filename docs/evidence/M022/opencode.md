# OpenCode — Driver Format Research (M022/T001)

- **Tool**: OpenCode (open-source terminal coding agent, opencode.ai / github.com/sst/opencode)
- **Date researched**: 2026-08-22
- **Sources consulted** (all read on 2026-08-22):
  - <https://opencode.ai/docs/> (docs index)
  - <https://opencode.ai/docs/skills/>
  - <https://opencode.ai/docs/agents/>
  - <https://opencode.ai/docs/commands/>
  - <https://opencode.ai/docs/rules/>
  - <https://opencode.ai/docs/permissions/>
  - <https://opencode.ai/docs/tools/>
  - <https://opencode.ai/docs/custom-tools/>
  - <https://opencode.ai/docs/config/>

Notes on evidence quality: findings were extracted from the official OpenCode documentation pages above via web fetch. Directory names for agents/commands (plural `agents/`, `commands/`) were double-checked against the pages verbatim, since older material used singular forms. No config shape below is asserted from memory; where the docs did not state something, that is said explicitly.

---

## 1. Skills

**Representation**: OpenCode supports the Agent Skills format natively — one `SKILL.md` per skill directory with YAML frontmatter.

**Locations** (per <https://opencode.ai/docs/skills/>): project-local `.opencode/skills/<name>/SKILL.md`, plus Claude Code-compatible fallbacks `.claude/skills/<name>/SKILL.md` and `.agents/skills/<name>/SKILL.md`; global `~/.config/opencode/skills/<name>/SKILL.md`, `~/.claude/skills/<name>/SKILL.md`, `~/.agents/skills/<name>/SKILL.md`. Discovery walks up from the working directory to the git worktree root.

**Frontmatter fields**: required `name` (1–64 chars, `^[a-z0-9]+(-[a-z0-9]+)*$`) and `description` (1–1024 chars); optional `license`, `compatibility`, `metadata` (string-to-string map). This matches the portable Agent Skills spec subset; OpenCode's docs list no Claude Code-style extension fields (`context: fork`, `allowed-tools`, etc.).

**Invocation**: skills load on demand through a native `skill` tool — the agent sees available skills (name + description) and calls `skill({ name: "skill-name" })` to load the body. Skill access is gated by pattern-based `permission.skill` rules in `opencode.json` (`allow` / `deny` / `ask`, wildcards supported; `deny` hides the skill from agents). Claude Code skill compatibility can be disabled with `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS` (per <https://opencode.ai/docs/rules/>).
(Source: <https://opencode.ai/docs/skills/>.)

## 2. Commands

**Representation**: two equivalent forms (source: <https://opencode.ai/docs/commands/>):

1. **JSON**: entries under the `"command"` key in `opencode.json`, one object per command name.
2. **Markdown**: one `.md` file per command in project `.opencode/commands/` or global `~/.config/opencode/commands/` (plural, verified verbatim); the filename becomes the command name (`test.md` → `/test`). Frontmatter example from the docs:

```yaml
---
description: Run tests with coverage
agent: build
model: anthropic/claude-3-5-sonnet-20241022
---
```

**Fields**: `template` (required in JSON form — "The prompt that will be sent to the LLM when the command is executed"; in markdown form the body is the template), `description`, `agent` (which agent executes it), `model` (per-command model override), `subtask` (boolean — force execution as a subagent to avoid polluting the main context).

**Body features**: `$ARGUMENTS` / positional `$1`, `$2`, …; shell output injection with `` !`command` `` (runs in project root); file inclusion with `@filename`. Invoked in the TUI as `/command-name [arguments]`; custom commands can override built-ins like `/init`.

## 3. Agents

**Representation**: two equivalent forms (source: <https://opencode.ai/docs/agents/>):

1. **JSON**: entries under the `"agent"` key in `opencode.json`.
2. **Markdown**: files in project `.opencode/agents/` or global `~/.config/opencode/agents/` (plural, verified verbatim); the filename is the agent name and the markdown body is the agent's prompt. Verbatim frontmatter example from the docs:

```yaml
---
description: Reviews code for quality and best practices
mode: subagent
model: anthropic/claude-sonnet-4-20250514
temperature: 0.1
permission:
  edit: deny
  bash: deny
---
```

**Fields**: `description` (required), `mode` (`primary` | `subagent` | `all`), `model` (`provider/model-id`), `prompt` (custom system prompt, supports `{file:./path}`), `permission` (per-agent overrides, see §8), `temperature`, `disable`, `hidden` (hide from `@` autocomplete), `steps` (max agentic iterations), and `tools` (see §7).

**Agent model**: *primary agents* are switched with Tab in the TUI; *subagents* are invoked by the model via the `task` tool or manually by `@`-mention (`@general help me search…`). Built-ins: Build and Plan (primary), General, Explore, Scout (subagents), plus hidden system agents (Compaction, Title, Summary).

## 4. Rules / instructions

**Representation**: plain-markdown `AGENTS.md` files (source: <https://opencode.ai/docs/rules/>):

- Project: `AGENTS.md` at the project root (traversal upward from cwd).
- Global: `~/.config/opencode/AGENTS.md`.
- **Claude Code compatibility**: falls back to `CLAUDE.md` (project) / `~/.claude/CLAUDE.md` (global) when no native file exists; disable via `OPENCODE_DISABLE_CLAUDE_CODE` / `OPENCODE_DISABLE_CLAUDE_CODE_PROMPT`.
- Additional instruction files via the `"instructions"` array in `opencode.json`, supporting glob patterns (e.g. `"packages/*/AGENTS.md"`) and remote URLs: `{"instructions": ["docs/guidelines.md", "packages/*/AGENTS.md"]}`.

Precedence: local `AGENTS.md` → local `CLAUDE.md` → global `AGENTS.md` → global `CLAUDE.md`. The `/init` command scaffolds or improves `AGENTS.md` from the repo. Unlike Claude Code's `.claude/rules/`, the OpenCode rules docs describe no per-file `paths` frontmatter for path-scoped rules — scoping is done by placing the file (or a glob in `instructions`), not by frontmatter.

## 5. Metadata

**Representation**: thin, and deliberately so — OpenCode carries metadata inside each artifact's own definition rather than a separate manifest. What the docs actually name:

- Skills: `name`, `description`, `license`, `compatibility`, and a free-form string-to-string `metadata` map in SKILL.md frontmatter (source: <https://opencode.ai/docs/skills/>).
- Commands/agents: `description` fields shown in the TUI (sources: <https://opencode.ai/docs/commands/>, <https://opencode.ai/docs/agents/>).
- Config: a `"$schema"` field pointing at `https://opencode.ai/config.json` gives `opencode.json` a published JSON Schema — the closest thing to machine-validated metadata for the whole config surface (source: <https://opencode.ai/docs/config/>).

No richer catalog/versioning metadata (e.g. per-command version, author) is documented; stating that as a genuine limit rather than padding the dimension.

## 6. Arguments

**Representation**:

- **Commands**: `$ARGUMENTS` for the full argument string, positional `$1`, `$2`, `$3` (source: <https://opencode.ai/docs/commands/>). No `argument-hint`-style autocomplete field is documented for commands.
- **Custom tools**: typed argument schemas via Zod — "You can use `tool.schema`, which is just Zod, to define argument types", e.g. `args: { query: tool.schema.string().describe("SQL query to execute") }` (source: <https://opencode.ai/docs/custom-tools/>).
- **Skills**: **not applicable** — the OpenCode skills docs document invocation as `skill({ name: "skill-name" })` only, with no argument-passing or placeholder-substitution mechanism for skill bodies (contrast Claude Code's `$ARGUMENTS` in skills). (Reasoned from <https://opencode.ai/docs/skills/>, which describes name-only loading.)

## 7. Tools

**Built-in tools** (lowercase names, source: <https://opencode.ai/docs/tools/>): `bash`, `edit`, `write`, `read`, `grep`, `glob`, `lsp` (experimental), `apply_patch`, `skill`, `todowrite`, `webfetch`, `websearch`, `question`. Subagent launching is a `task` permission key (source: <https://opencode.ai/docs/permissions/>).

**Custom tools** (source: <https://opencode.ai/docs/custom-tools/>): TypeScript/JavaScript files in project `.opencode/tools/` or global `~/.config/opencode/tools/`, defined with the `tool()` helper from `@opencode-ai/plugin`:

```ts
import { tool } from "@opencode-ai/plugin"
export default tool({
  description: "Tool description",
  args: { /* zod schema */ },
  async execute(args, context) { /* logic */ },
})
```

The filename becomes the tool name (`database.ts` → `database`); named exports allow several tools per file; the `execute` context exposes `agent`, `sessionID`, `messageID`, `directory`, `worktree`. Custom tools override same-named built-ins.

**External tools**: MCP server integrations are configured under the `"mcp"` key in `opencode.json` (source: <https://opencode.ai/docs/config/>; details on <https://opencode.ai/docs/mcp-servers/>, not re-verified field-by-field here). A `"tools"` config key manages which tools the LLM can access, with wildcards for controlling multiple MCP tools (sources: <https://opencode.ai/docs/config/>, <https://opencode.ai/docs/tools/>).

## 8. Permissions

**Representation**: a `"permission"` object in `opencode.json`; every rule resolves to `"allow"` (run without approval), `"ask"` (prompt), or `"deny"` (block). Source: <https://opencode.ai/docs/permissions/>.

**Shapes** (verbatim from docs):

```json
{ "permission": { "*": "ask", "bash": "allow", "edit": "deny" } }
```

Granular per-input pattern objects, **last-matching-wins**:

```json
{
  "permission": {
    "bash":  { "*": "ask", "git *": "allow", "rm *": "deny" },
    "edit":  { "*": "deny", "src/content/docs/*.mdx": "allow" }
  }
}
```

**Permission keys**: `read`, `edit` (covers all file modifications incl. `write`/`apply_patch`), `glob`, `grep`, `bash`, `task` (launching subagents), `skill`, `lsp`, `question`, `webfetch`, `websearch`, `external_directory`, `doom_loop`. Patterns: `*` (any run), `?` (one char), `~`/`$HOME` expansion. Defaults: mostly `"allow"`, but `doom_loop` and `external_directory` default `"ask"`, and `.env` reads are denied by default (`.env.example` allowed).

**Per-agent overrides**: nested `permission` under an agent in `opencode.json` or in agent markdown frontmatter (`permission:\n  edit: deny`), merging with and taking precedence over global rules. An `--auto` flag auto-approves everything not explicitly denied. Approval prompts offer `once` / `always` (session-scoped pattern) / `reject`.

Contrast with Claude Code: OpenCode expresses permissions as a per-tool key → pattern-map object with three verdict strings; Claude Code expresses them as three rule arrays (`allow`/`ask`/`deny`) of `Tool(pattern)` strings. Semantically similar, structurally different.

---

## Summary table

| Dimension | Representation | Key location(s) | Cited from |
| --- | --- | --- | --- |
| Skills | Agent Skills `SKILL.md`, spec-subset frontmatter, loaded via `skill` tool | `.opencode/skills/`, `.claude/skills/` fallback, `~/.config/opencode/skills/` | docs/skills |
| Commands | `"command"` key in `opencode.json` or markdown files (`template`, `description`, `agent`, `model`, `subtask`) | `.opencode/commands/`, `~/.config/opencode/commands/` | docs/commands |
| Agents | `"agent"` key or markdown + frontmatter (`mode`, `model`, `permission`, `temperature`, `steps`) | `.opencode/agents/`, `~/.config/opencode/agents/` | docs/agents |
| Rules/instructions | `AGENTS.md` (+ `CLAUDE.md` fallback), `instructions` globs/URLs | project root, `~/.config/opencode/AGENTS.md` | docs/rules |
| Metadata | Frontmatter fields + free-form `metadata` map (skills); `$schema` on config | inside artifact files / `opencode.json` | docs/skills, docs/config |
| Arguments | `$ARGUMENTS`/`$1..$n` in commands; Zod `args` in custom tools; none for skills | command templates, tool files | docs/commands, docs/custom-tools |
| Tools | Lowercase built-ins; TS custom tools via `tool()`; MCP under `"mcp"` key | `.opencode/tools/`, `opencode.json` | docs/tools, docs/custom-tools, docs/config |
| Permissions | `"permission"` object: per-tool key → `allow`/`ask`/`deny` or pattern map, last-match-wins | `opencode.json`, agent frontmatter | docs/permissions |
