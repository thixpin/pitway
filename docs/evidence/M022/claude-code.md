# Claude Code — Driver Format Research (M022/T001)

- **Tool**: Claude Code (Anthropic's CLI coding agent)
- **Date researched**: 2026-08-22
- **Sources consulted**:
  - Official docs: <https://code.claude.com/docs/en/skills> (read in full), <https://code.claude.com/docs/en/sub-agents>, <https://code.claude.com/docs/en/permissions>, <https://code.claude.com/docs/en/memory>, <https://code.claude.com/docs/en/mcp>
  - First-party local grounding: this repository's own shipped Claude Code assets under `src/integrations/claude/` (installed into a target repo's `.claude/` by `pitway init`, see `src/cli/commands/init.ts`)

Notes on evidence quality: the skills page was read as raw page text; the sub-agents, permissions, memory, and MCP pages were read via targeted extraction of the official pages at the URLs above. Claims below are confined to what those pages state. Dimensions exercised by this repository's own assets carry repo-relative citations in addition to doc URLs; dimensions not exercised locally (agents, permissions, MCP tools) are documented from official docs only, and are marked as such.

---

## 1. Skills

**Representation**: one directory per skill containing a `SKILL.md` file — YAML frontmatter between `---` markers plus a markdown body. The directory name becomes the `/name` command. Skills follow the Agent Skills open standard (<https://agentskills.io>), which Claude Code extends.
(Source: <https://code.claude.com/docs/en/skills>, "Create your first skill" and "Frontmatter reference".)

**Locations** (per the docs' "Where skills live" table):

| Level | Path |
| --- | --- |
| Enterprise | managed settings directory `.claude/skills/` |
| Personal | `~/.claude/skills/<skill-name>/SKILL.md` |
| Project | `.claude/skills/<skill-name>/SKILL.md` |
| Plugin | `<plugin>/skills/<skill-name>/SKILL.md` (namespaced `/plugin:skill`) |

Precedence on name conflict: enterprise > personal > project; a skill overrides a `.claude/commands/` file of the same name. Nested `.claude/skills/` directories in subdirectories load on demand with directory-qualified names (`apps/web:deploy`).

**Frontmatter fields** (all optional; only `description` recommended), from the official frontmatter reference: `name`, `description`, `when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`, `allowed-tools`, `disallowed-tools`, `model`, `effort`, `context` (`fork` runs the skill in a subagent), `agent` (which subagent type when `context: fork`), `background`, `hooks`, `paths` (glob-scoped activation), `shell`, `metadata`, `license`, `compatibility`. Only `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` are part of the portable Agent Skills spec; the rest are Claude Code extensions.
(Source: <https://code.claude.com/docs/en/skills>, "Frontmatter reference" and "Using skill frontmatter outside Claude Code".)

**Invocation**: user types `/skill-name`, or Claude auto-invokes when the `description` matches the conversation (unless `disable-model-invocation: true`). The description is always in context; the body loads only on invocation and then persists for the session. Skills support dynamic context injection: `` !`command` `` lines run before the content is sent, output replacing the placeholder.

**First-party example (this repo)**: PitWay ships six vendored skills at `src/integrations/claude/skills/<name>/SKILL.md` (`debugging`, `bug-fix`, `testing`, `code-quality-review`, `architecture-review`, `security-audit`), each using exactly `name` + `description` frontmatter, e.g. `src/integrations/claude/skills/debugging/SKILL.md`:

```yaml
---
name: debugging
description: Investigate failures whose root cause is still unknown — narrow the search space, instrument, and test falsifiable hypotheses. ...
---
```

Provenance is tracked in `src/integrations/claude/skills/NOTICE.md` (vendored MIT-licensed from `github.com/thixpin/claude-config`, pinned commit).

## 2. Commands

**Representation**: a markdown file per command at `.claude/commands/<name>.md`; the file name without extension is the `/name`. Officially, **custom commands have been merged into skills**: "A file at `.claude/commands/deploy.md` and a skill at `.claude/skills/deploy/SKILL.md` both create `/deploy` and work the same way." Command files support the same frontmatter as skills except `name` and `paths`, which are ignored in a command file. If a command and skill share a name, the skill wins.
(Source: <https://code.claude.com/docs/en/skills>, note in the intro and "Discovery from parent and nested directories".)

**First-party example (this repo)**: PitWay ships ~39 command files at `src/integrations/claude/commands/*.md`, each with `description` + `argument-hint` frontmatter, e.g. `src/integrations/claude/commands/task-dispatch.md`:

```yaml
---
description: PitWay: Prepare a parallel-eligible task for worktree execution
argument-hint: <id>
---
```

and `src/integrations/claude/commands/backlog.md` uses `argument-hint: <add|list|show|promote|archive> [id]`. No PitWay command uses `allowed-tools`, `model`, or `disable-model-invocation` (verified by grep over `src/integrations/claude/commands/`). MCP servers can also contribute commands: MCP prompts appear as `/mcp__servername__promptname` (source: <https://code.claude.com/docs/en/mcp>, "Use MCP prompts as commands").

## 3. Agents (subagents)

Not exercised locally — PitWay ships no `.claude/agents/` files (it uses prose protocol docs, `src/integrations/claude/protocol-worker.md` / `protocol-driver.md`, plus the generic Task/Agent tool instead). Documented from official docs only.

**Representation**: markdown file with YAML frontmatter + a markdown body that becomes the subagent's **system prompt**. Locations by priority: managed settings, `--agents` CLI flag (JSON), project `.claude/agents/`, user `~/.claude/agents/`, plugin `agents/`; directories scanned recursively.

**Frontmatter fields**: required `name`, `description`; optional `tools` (allowlist; inherits all if omitted), `disallowedTools`, `model` (`sonnet`/`opus`/`haiku`/full ID/`inherit`), `permissionMode`, `maxTurns`, `skills` (preload into context), `mcpServers`, `hooks`, `memory` (`user`/`project`/`local` persistent-memory scope), `background`, `effort`, `isolation` (`worktree`), `color`, `initialPrompt`.

**Invocation**: natural-language delegation by Claude, explicit `@agent-<name>` mention, or as the main session agent via `claude --agent <name>` / an `"agent"` key in `.claude/settings.json`. Built-ins include Explore, Plan, and general-purpose.
(Source: <https://code.claude.com/docs/en/sub-agents>.)

## 4. Rules / instructions

**Representation**: plain-markdown `CLAUDE.md` memory files, loaded at session start, in four scopes (load order broad→specific): managed policy (e.g. `/Library/Application Support/ClaudeCode/CLAUDE.md` on macOS), user `~/.claude/CLAUDE.md`, project `./CLAUDE.md` or `./.claude/CLAUDE.md`, and local `./CLAUDE.local.md` (gitignored personal). Files in parent directories load at launch; subdirectory `CLAUDE.md` files load on demand when Claude reads files there. All discovered files are concatenated, not overridden.

**Modular rules**: `.claude/rules/*.md` (project) and `~/.claude/rules/` (user), discovered recursively; a rule file may carry YAML frontmatter with a `paths` field of glob patterns so it loads only when Claude works on matching files. Rules without `paths` load at launch with `.claude/CLAUDE.md` priority.

**Imports**: `@path/to/file` syntax inside CLAUDE.md pulls other files into context (max depth 4 hops). Claude Code reads `CLAUDE.md`, **not** `AGENTS.md`; the documented bridge is `@AGENTS.md` import or a symlink.
(Source: <https://code.claude.com/docs/en/memory>.)

**First-party example (this repo)**: PitWay's own repo `CLAUDE.md` at the project root is a live example of a project-scope instruction file (architecture constraints, operational rules), and `pitway init` treats a target repo's root `CLAUDE.md` as a preserved/managed root-instructions concern (`src/cli/commands/init.ts`).

## 5. Metadata

**Representation**: metadata is carried in YAML frontmatter of the artifact files themselves — there is no separate manifest for skills/commands/agents.

- Skills: `name` (display), `description`, `when_to_use`, plus spec-level descriptive fields `license`, `compatibility` (≤500 chars), and a free-form `metadata` map — "Free-form YAML map for your own key-value data … read by your own tooling from `SKILL.md`. Claude Code doesn't act on its contents." (Source: <https://code.claude.com/docs/en/skills>, frontmatter reference.)
- Subagents: `name`, `description`, `color` (display color) (source: <https://code.claude.com/docs/en/sub-agents>).
- Plugins add a `.claude-plugin/plugin.json` manifest when a skill folder is packaged as a plugin (source: <https://code.claude.com/docs/en/skills>, note under "Where skills live").

**First-party example (this repo)**: every shipped command carries `description` metadata (surfaced in the `/` menu), e.g. `src/integrations/claude/commands/verify.md`; skills carry `name` + `description`.

## 6. Arguments

**Representation**: string substitution placeholders in skill/command bodies, plus an autocomplete hint field:

- `$ARGUMENTS` — full argument string; if absent, arguments are appended as `ARGUMENTS: <value>`.
- `$ARGUMENTS[N]` and shorthand `$N` — 0-based positional access (`$0`, `$1`, …), shell-style quoting for multi-word values.
- `$name` — named positional arguments declared via the `arguments` frontmatter field (space-separated string or YAML list; names map to positions in order).
- `argument-hint` frontmatter — autocomplete hint only, e.g. `[issue-number]`.
- Environment-style substitutions: `${CLAUDE_SESSION_ID}`, `${CLAUDE_EFFORT}`, `${CLAUDE_SKILL_DIR}`, `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`.

(Source: <https://code.claude.com/docs/en/skills>, "Available string substitutions" and "Pass arguments to skills".)

**First-party example (this repo)**: all PitWay commands declare `argument-hint` (e.g. `<id>` in `src/integrations/claude/commands/task-dispatch.md`, `[id]` in `commands/verify.md`).

## 7. Tools

Not exercised locally beyond default tool use — documented from official docs.

- **Built-in tools**: named tools such as `Read`, `Grep`, `Glob`, `Bash`, `Edit`, `Write`, `WebFetch`, `Skill`, referenced by name in `tools` allowlists, `allowed-tools` grants, and permission rules (tool names appear throughout <https://code.claude.com/docs/en/sub-agents> and <https://code.claude.com/docs/en/permissions>).
- **MCP tools**: external tools via Model Context Protocol servers, configured in project `.mcp.json`, `~/.claude.json`, or `claude mcp add` with scopes local/project/user. Callable names follow `mcp__<server>__<tool>`; plugin-bundled servers use `mcp__plugin_<plugin-name>_<server-name>__<tool-name>`. That full name is what permission rules, a skill's `allowed-tools`, a subagent's `tools` field, and hook matchers reference. (Source: <https://code.claude.com/docs/en/mcp>.)
- **Per-skill tool control**: `allowed-tools` (turn-scoped pre-approval) and `disallowed-tools` frontmatter (source: <https://code.claude.com/docs/en/skills>).
- **Per-agent tool control**: `tools` allowlist / `disallowedTools` denylist frontmatter; background subagents get a documented narrower tool set (source: <https://code.claude.com/docs/en/sub-agents>).

## 8. Permissions

Not exercised locally (PitWay ships no settings.json into targets) — documented from official docs.

**Representation**: a `permissions` object with `allow` / `ask` / `deny` rule arrays in JSON settings files: user `~/.claude/settings.json`, project `.claude/settings.json`, local `.claude/settings.local.json`, and managed settings (`managed-settings.json`) for organizations. Example from the docs:

```json
{
  "permissions": {
    "allow": ["Bash(npm run *)", "Bash(git commit *)"],
    "deny": ["Bash(git push *)"]
  }
}
```

**Rule syntax**: `Tool` or `Tool(pattern)` — e.g. `Bash(npm run build)` exact command, `Bash(npm *)` prefix wildcard with word-boundary semantics, `:*` trailing-wildcard alias (`Bash(ls:*)` ≡ `Bash(ls *)`), `Read(./.env)` / `Edit(docs/**)` gitignore-style path rules with `//` absolute and `~/` home anchors, `WebFetch(domain:example.com)` domain rules, and MCP rules like `mcp__github__get_*`. Deny > ask > allow precedence; a bare tool name in deny removes the tool from context entirely. Compound shell commands are split on operators and each subcommand must match independently.

**Permission modes**: `default` (manual), `acceptEdits`, `auto` (classifier reviews), `dontAsk`, `bypassPermissions`, `plan`; session default set via `defaultMode` in settings. Additional working directories are granted via `permissions.additionalDirectories` (file access only, not config discovery). Subagents can pin a mode with the `permissionMode` frontmatter field.
(Sources: <https://code.claude.com/docs/en/permissions>; `permissionMode` values from <https://code.claude.com/docs/en/sub-agents>.)

---

## Summary table

| Dimension | Representation | Key location(s) | Cited from |
| --- | --- | --- | --- |
| Skills | `SKILL.md` (YAML frontmatter + markdown), Agent Skills standard + CC extensions | `.claude/skills/<name>/`, `~/.claude/skills/`, plugins | docs/en/skills + `src/integrations/claude/skills/` |
| Commands | Markdown file per command; merged into skills; same frontmatter minus `name`/`paths` | `.claude/commands/<name>.md` | docs/en/skills + `src/integrations/claude/commands/` |
| Agents | Markdown + frontmatter; body = system prompt | `.claude/agents/`, `~/.claude/agents/`, `--agents` JSON | docs/en/sub-agents |
| Rules/instructions | `CLAUDE.md` scopes + `.claude/rules/*.md` with `paths` frontmatter; `@` imports | managed / `~/.claude/` / project / `CLAUDE.local.md` | docs/en/memory + repo `CLAUDE.md` |
| Metadata | Frontmatter fields (`name`, `description`, `license`, `compatibility`, free-form `metadata` map) | inside each artifact file | docs/en/skills |
| Arguments | `$ARGUMENTS`, `$N`, named `$name` via `arguments:`, `argument-hint`, `${CLAUDE_*}` vars | skill/command body + frontmatter | docs/en/skills + repo commands |
| Tools | Named built-ins; MCP tools as `mcp__server__tool`; per-skill `allowed-tools`, per-agent `tools` | `.mcp.json`, frontmatter | docs/en/mcp, docs/en/skills, docs/en/sub-agents |
| Permissions | `permissions.allow/ask/deny` rule arrays, `Tool(pattern)` syntax, permission modes | `.claude/settings.json` family, managed settings | docs/en/permissions |
