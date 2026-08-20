# PitWay

> **The pit crew for agentic coding.**  
> A controlled workflow for agentic software development.

[![npm version](https://img.shields.io/npm/v/pitway.svg)](https://www.npmjs.com/package/pitway)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

PitWay is an npm-distributed CLI that controls the engineering process around AI coding agents — **it is not itself an agent**.

- **Agents** drive the interaction
- **PitWay** controls workflow state, engineering boundaries, verification, and traceability

> 💡 **Driver Support:** Claude Code is the first supported driver integration, while PitWay's Core remains provider-agnostic.

---

## How It Works

```mermaid
flowchart TD

    subgraph PLAN[" "]
        direction LR
        A["📋<br/>Requirement"] --> B["🏁<br/>Milestone"]
        B --> C["📜<br/>Contract"]
        C --> R["⚖️<br/>Milestone Review"]
        R -. 🔄 .-> C
    end

    PLAN --> D{{"🚦<br/>Human Approval"}}
    D --> E["📝<br/>Task Graph"]

    subgraph EXECUTE[" "]
        direction LR
        F["🛠<br/>TDD"]
        F --> G["⏱️<br/>Task Verification"]
        G --> H["🏎️<br/>Task Commit"]
    end

    EXECUTE --> I["🧪<br/>Final Full Test"] 
    I --> J["🏆<br/>Milestone Complete"]


    G -. 🔄 .-> F
    E --> EXECUTE
    I -. 🔄 .-> EXECUTE

    style PLAN fill:none,stroke:#333,stroke-width:2px
    style EXECUTE fill:none,stroke:#333,stroke-width:2px
```

**Workflow Lifecycle:**

`Requirement` → `Milestone` → `Contract` → `Milestone Review` → `Human Approval` → `Task Graph` → [`TDD` ⇄ `Task Verification` → `Task Commit`]* → `Final Full Test` → `Milestone Complete`

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

### 2. Resume Workflow

Inspect or continue the current workflow at any time:

```bash
pitway resume
```

> 📌 **Commit Traceability:** Before implementation begins, the developer reviews and confirms the milestone contract. Task commits carry `PitWay-Milestone` and `PitWay-Task` Git trailers; milestone baseline and completion commits carry the milestone trailer.

> 📊 **Progress at a Glance:** Once a milestone is confirmed, routine driver updates end with a one-line progress footer (e.g. `🏎️ 54% · ✅ 7/12 · Next: T008`); run `pitway milestone-status <id> --report` for the full structured progress report on demand.

### 3. Explore Commands

Run the following for the full, authoritative CLI command surface and available flags:

```bash
pitway --help
```

---

## Commands & Integration

- **Command Reference:** Run `pitway --help` for the full, authoritative CLI command surface and available flags.
- **Claude Code:** For Claude Code projects, the installed `.claude/` assets document how the driver interacts with PitWay.

---

## Opt-in Policies

Two repository-level policies live in `.pitway/config.yaml`, both absent by default and both byte-identical to today's behavior until a project opts in:

- **`git.branch_strategy: main | milestone`** — `main` (the default) commits every milestone directly to the current branch, exactly as before this option existed. `milestone` gives each milestone its own dedicated branch instead, checked out for the milestone's full lifecycle.
- **`execution.strategy: sequential | parallel_worktrees`** — `sequential` (the default) runs one task at a time, inline, exactly as before this option existed. `parallel_worktrees` allows dispatching independent, dependency-free, disjoint-`write_scope` tasks concurrently, each into its own temporary Git worktree; PitWay validates eligibility and integrates each result as a diff-apply — never a merge — so the resulting mainline history stays indistinguishable from sequential execution.

---

## Engineering Boundaries

| Boundary Property | Behavior & Scope |
| --- | --- |
| `write_scope` | **Mechanically enforced** task boundary to prevent unintended file modifications. |
| `context_files` | Limits task-context bundles supplied by PitWay *(not an OS-level read sandbox)*. |
| **Agent Runtime** | PitWay does **not** claim control over external agent runtimes, shells, or OS tool permissions. |
| **Milestone Review** | Reviewers produce **findings only**. PitWay does **not** run reviews or verify reviewer independence. |

---

## Dogfooding & Verification

PitWay is developed and maintained using its own workflow:

- **M001–M003:** Bootstrap foundation
- **M004:** Crossed the self-hosting boundary
- **M005+:** Created, verified, and completed entirely through PitWay

All project claims are bounded strictly by evidence that survives a fresh clone: committed Git history, `.pitway/` state, and the automated test suite.

---

> **There is a way to build with agents. This is PitWay.**

## License

MIT — see [LICENSE](./LICENSE).
