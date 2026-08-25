# PitWay

> **The pit crew for agentic coding.**  
> A controlled workflow for agentic software development.

[![npm version](https://img.shields.io/npm/v/pitway.svg)](https://www.npmjs.com/package/pitway)
[![codecov](https://codecov.io/github/thixpin/pitway/branch/main/badge.svg)](https://app.codecov.io/github/thixpin/pitway)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

PitWay is an npm-distributed CLI that controls the engineering process around AI coding agents — **it is not itself an agent**.

- **Agents** drive the interaction
- **PitWay** controls workflow state, engineering boundaries, verification, and traceability

---

## Why PitWay?

AI coding agents move fast — and that's exactly the problem. Left unstructured, an agent can drift from what was asked, skip verification, or quietly touch files outside its intended scope, with no durable record of what actually happened or why.

PitWay doesn't replace the agent driving your work — it gives that work a process:

- **A confirmed plan before code.** Every milestone starts as a contract — objective, acceptance criteria, verification checks — reviewed and approved by a human before any implementation begins.
- **Boundaries an agent can't quietly cross.** `write_scope` mechanically limits what a task may touch.
- **Verification, not vibes.** Every task is checked against its own declared command before it's considered done, with a mandatory full test suite gating milestone completion.
- **A record that survives the conversation.** Git commits carry traceable `PitWay-Milestone`/`PitWay-Task` trailers — the history holds even after the AI session that produced it is gone.

The result: agents move fast, and the engineering process stays in control of where they land.

---

## How It Works

![PitWay workflow: BRS/Backlog into Milestone (Contract ⇄ Milestone Review) through the Human Approval gate to the Task Graph, TDD → Task Verification → Task Commit repeating with a Backlog exit, then Final Full Test (failure loops through milestone revision), Milestone Complete, and an opt-in Quick Change lane for small bounded fixes against a completed milestone, ending at Milestone Merge](./docs/assets/workflow.svg)

<sub>Source: [`docs/assets/workflow.mmd`](./docs/assets/workflow.mmd) (Mermaid) — rendered to SVG so it displays on npmjs.com too, which doesn't render Mermaid.</sub>

**Workflow Lifecycle:**

`Requirement` → `Milestone` (`Contract` ⇄ `Milestone Review`) → `Human Approval` → `Task Graph` → [`TDD` ⇄ `Task Verification` → `Task Commit`]* → `Final Full Test` (fail ⇒ revision loop) → `Milestone Complete` → `Milestone Merge` — plus a `Quick Change` lane for small bounded fixes against an already-completed milestone.

- **Workflow Enforcement:** Validates state transitions and enforces task write boundaries.
- **Two-Tier Verification:** Runs targeted verification for each task, followed by a mandatory full test suite before closing the milestone.
- **Durable State:** Creates traceable Git checkpoints without relying on transient AI conversation memory.

---

## Quickstart

### 1. Install & Initialize

Run once from the root of a Git repository (run `git init` first if needed):

```bash
npm install -g pitway

pitway init
```

- PitWay initializes `.pitway/` and installs the Claude Code integration by default.
- Use `pitway init --no-claude` to opt out of the Claude Code integration.
- Use `pitway init --opencode` to also install the OpenCode integration (`.opencode/` — commands, skills, and driver protocol documents).
- Use `pitway init --codex` to also install the Codex integration (`.codex/` — commands, skills, and driver protocol documents).
- `init` also creates root `AGENTS.md`/`CLAUDE.md` instruction files. PitWay's content lives inside an explicit `<!-- pitway:managed:start/end -->` block — if you already have your own `AGENTS.md` or `CLAUDE.md`, the block is appended and your content is left intact; PitWay only ever owns the marked block.

### 2. Resume Workflow

Inspect or continue the current workflow at any time:

```bash
pitway resume
```

> 📌 **Commit Traceability:** Before implementation begins, the developer reviews and confirms the milestone contract. Task commits carry `PitWay-Milestone` and `PitWay-Task` Git trailers; milestone baseline and completion commits carry the milestone trailer.

> 📊 **Progress at a Glance:** Once a milestone is confirmed, routine driver updates end with a one-line progress footer (e.g. `🏎️ 54% · ✅ 7/12 · Next: T008`). `pitway milestone-status <id>` renders a per-task table with an inline progress bar; add `--report` for the full structured progress report on demand.

### 3. Explore Commands

Run the following for the full, authoritative CLI command surface and available flags:

```bash
pitway --help
```

For a hands-on walkthrough of the whole workflow — drafting a contract, confirming a milestone, working a task through to completion — see [USAGE.md](./USAGE.md).

> 💡 **Driver Support:** Claude Code (installed by default), OpenCode (opt-in), and Codex (opt-in) driver integrations ship as text assets from a shared common layer — skills and protocol documents are defined once and resolved per driver. PitWay's Core remains provider-agnostic.

> ⚠️ **What PitWay enforces vs what relies on driver discipline.** Mechanically enforced: the state machines, `write_scope` boundaries, verification gates, commit trailers, and git-safety checks — no driver can bypass these through the CLI. Installed-instruction-only: stopping for human approval gates, driver-presented progress footers, and bounded worker reports are mandated by the installed protocol documents every driver loads, but PitWay cannot observe a live session's obedience — violations surface in review/audit, never at runtime.

---

## Commands & Integration

- **Command Reference:** Run `pitway --help` for the full, authoritative CLI command surface and available flags. The `milestone-*` commands also answer to shorter `ms-*` aliases (`pitway ms-status`, `ms-confirm`, `ms-merge`, …).
- **Usage Guide:** See [USAGE.md](./USAGE.md) for a hands-on walkthrough — installation, your first milestone end to end, inspecting state, mid-flight corrections, and a full command reference table.
- **Claude Code:** `pitway init` installs PitWay's commands as real Claude Code slash commands (`.claude/commands/*.md`, each carrying `description`/`argument-hint` metadata for the `/` picker), alongside the driver protocol documents that explain how and when to use them.
- **OpenCode:** `pitway init --opencode` installs the same command surface in OpenCode's own convention (`.opencode/commands/*.md`) plus the shared skills and protocol documents. Skills and protocol content come from the common layer — defined once, never forked per driver.
- **Codex:** `pitway init --codex` installs the same command surface in Codex's convention (`.codex/commands/*.md`) plus the shared skills and protocol documents. Skills and protocol content come from the common layer — defined once, never forked per driver.

---

## Engineering Boundaries

| Boundary Property | Behavior & Scope |
| --- | --- |
| `write_scope` | **Mechanically enforced** task boundary to prevent unintended file modifications. |
| `context_files` | Limits task-context bundles supplied by PitWay *(not an OS-level read sandbox)*. |
| **Agent Runtime** | PitWay does **not** claim control over external agent runtimes, shells, or OS tool permissions. |
| **Milestone Review** | Reviewers produce **findings only**. PitWay does **not** run reviews or verify reviewer independence. |

---

## Workflow Policies

Two repository-level policies live in `.pitway/config.yaml`. `pitway init` generates them with the recommended workflow enabled (with explanatory comments in the file):

```yaml
git:
  branch_strategy: milestone     # each milestone gets its own dedicated branch
execution:
  strategy: parallel_worktrees   # independent tasks dispatch concurrently
```

- **`git.branch_strategy: main | milestone`** — `milestone` (the generated default) gives each milestone its own dedicated branch, checked out for the milestone's full lifecycle; once completed, `pitway milestone-merge <id>` lands the branch into its base branch with full git-safety checks and idempotent re-runs. Set `main` to commit milestones directly to the current branch instead.
- **`execution.strategy: sequential | parallel_worktrees`** — `parallel_worktrees` (the generated default) lets independent, dependency-free, disjoint-`write_scope` tasks dispatch concurrently, each into its own temporary Git worktree; PitWay validates eligibility and integrates each result as a diff-apply — never a merge — so the resulting mainline history stays indistinguishable from sequential execution. Set `sequential` to run one task at a time, inline.

---

## Dogfooding & Verification

PitWay is developed and maintained using its own workflow:

- **M001–M003:** Bootstrap foundation
- **M004:** Crossed the self-hosting boundary
- **M005+:** Created, verified, and completed entirely through PitWay

All project claims are bounded strictly by evidence that survives a fresh clone: committed Git history, `.pitway/` state, and the automated test suite.

---

## Maintenance & Security

Dependency updates arrive as [Dependabot](https://docs.github.com/en/code-security/dependabot) pull requests (weekly, grouped dev-dependencies, no auto-merge — see `.github/dependabot.yml`). Dependabot security alerts are a repository setting, not something this file turns on: enable them under **Settings → Code security** if you want them.

Static analysis runs via [CodeQL](https://codeql.github.com/) on every push and pull request to `main`, plus a weekly schedule (`.github/workflows/codeql.yml`), scanning the TypeScript/JavaScript source for common vulnerability patterns. Results appear under the repository's **Security → Code scanning** tab.

See [SECURITY.md](./SECURITY.md) for how to report a vulnerability.

---

### Release History

For changes and improvements introduced in each published version, see [CHANGELOG.md](./CHANGELOG.md).

---

> **There is a way to build with agents. This is PitWay.**

## License

MIT — see [LICENSE](./LICENSE).
