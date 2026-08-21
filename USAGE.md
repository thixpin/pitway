# Using PitWay

This is a hands-on usage reference for the `pitway` CLI. For the high-level
pitch and architecture, see [README.md](./README.md); for the exact,
authoritative flag list, `pitway <command> --help` always wins over this
document.

PitWay is a workflow-state controller, not an agent. Everything below works
whether you're driving `pitway` by hand or an AI coding agent is driving it
on your behalf (that's what the installed Claude Code slash commands are
for — see [Claude Code Integration](#claude-code-integration)).

## Installation

```bash
npm install -g pitway
```

Requires Node.js ≥ 20 and a Git repository (`git init` first if you don't
have one yet — PitWay refuses to run outside a Git work tree).

## Getting Started

From the root of your Git repository:

```bash
pitway init
```

This creates `.pitway/` (a `config.yaml` and `state.yaml` — both empty of
milestones until you add one) and, by default, installs the Claude Code
integration into `.claude/` (opt out with `pitway init --no-claude`). It's
safe to re-run: byte-identical files are left alone, and a genuine conflict
with something you've hand-edited refuses loudly rather than overwriting it.

Every command below also accepts `--json` for machine-readable output.

## The Workflow at a Glance

```
Requirement → Milestone → Contract → Human Approval → Task Graph
  → [TDD ⇄ Task Verification → Task Commit]* → Final Full Test → Milestone Complete
```

A **milestone** is one unit of planned work with a **contract** (objective,
acceptance criteria, verification checks) and a **task graph** (the concrete
steps). Nothing gets implemented until a human confirms the contract — that
confirmation is the one mandatory approval gate in the whole lifecycle.

## Walkthrough: Your First Milestone

### 1. Draft a contract and task graph

These are plain files you (or your AI driver) write — PitWay validates them,
it doesn't generate their content. A contract is Markdown with YAML
frontmatter:

```markdown
---
schema_version: 1
id: M999
title: Greeter module
status: draft
requirement: null
confirmed_at: null
verification_approved_hash: null
acceptance_criteria:
  - id: AC001
    text: greet() returns a friendly string.
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npm test
---

# Contract

## Objective

Add a small greeter module.

## Change Log

- Initial milestone contract.
```

(The `id` you write is a placeholder — `milestone-add` assigns the real
next sequential id, e.g. `M001`.) A task graph is plain YAML:

```yaml
schema_version: 1
tasks:
  - id: T001
    name: Implement greeter
    objective: Implement the greet() function.
    status: planned
    depends_on: []
    acceptance_criteria:
      - greet() returns a friendly string
    context_files:
      - greeter.js
    write_scope:
      - greeter.js
    verification:
      strategy: command
      detail: npm test
    result: null
    usage: null
```

`write_scope` is mechanically enforced: a task's completion commit refuses
if it touches anything outside its declared paths.

### 2. Draft the milestone

```bash
pitway milestone-add --contract contract.md --tasks tasks.yaml
```

This creates the milestone in `draft` status. Nothing is committed yet, and
nothing can be implemented yet.

### 3. Review, then confirm

Read the drafted contract (`.pitway/milestones/<id>/contract.md`) — this is
the one point where a human is expected to actually look at what's about to
happen. Once you're satisfied:

```bash
pitway milestone-confirm M001
```

This freezes the contract, hash-approves its verification commands, and
creates the milestone's baseline Git commit. Ready tasks (dependency-free
ones) promote automatically.

### 4. Work a task

```bash
pitway task-update T001 in_progress
# ... write greeter.js ...
pitway task-verify T001          # runs the task's own approved command, records formal evidence
pitway task-update T001 review
pitway task-update T001 completed --result result.yaml --message message.txt
```

`result.yaml` is `{summary: ..., evidence: ...}`; `message.txt` is the
commit message body PitWay appends `PitWay-Milestone`/`PitWay-Task` trailers
to. Completion is one atomic commit containing your code changes and the
matching `.pitway/` state update — the working tree must be clean except for
the task's own declared `write_scope` at every transition.

### 5. Verify and complete the milestone

```bash
pitway verify M001              # runs every approved `command`-type check
pitway milestone-complete M001  # requires every task done + every check passing
```

`milestone-complete` is the other mandatory gate — it refuses until
everything is actually green.

## Inspecting State

```bash
pitway resume                    # what's going on in this repo, and what's next
pitway milestone-status <id>     # one milestone's contract, progress, task table, and racing footer
pitway milestone-status <id> --report   # the full structured Progress Report
pitway task-status <id>          # one task's status
pitway task-status <id> --context       # the minimal execution bundle a worker needs
```

`milestone-status`'s default output includes a progress bar and a per-task
table (id, status, progress, execution mode — inline or worktree):

```
🏁 Milestone M001 — Greeter module

Status: completed
Progress: 1/1 required tasks completed
Baseline: 2e339e5...
Tokens: N/A

| Task | Status      | Progress | Execution |
|------|-------------|----------|-----------|
| T001 | ✓ Completed | 100%     | inline    |

🏁 [████████████████████] 100% · ✅ 1/1 · Complete
```

## Mid-Milestone Corrections

Once a milestone is `confirmed`/`in_progress`, its task graph isn't frozen
forever:

```bash
# Insert a new task discovered mid-flight (no new milestone needed):
pitway task-add M001 --file new-task.yaml --change-log "Why this task exists."

# Amend an existing task's objective/scope/verification:
pitway task-amend T002 --file changes.yaml --change-log "Why this changed."
```

Cancelling a milestone (`pitway milestone-cancel <id>`) only ever applies to
a still-`draft` milestone — it's genuine abandonment, not a way to undo
confirmed work. To abandon remaining work in an active milestone, cancel its
not-yet-started tasks (`pitway task-update <id> cancelled`) and complete
with whatever's actually done.

## Fixing an Already-Completed Milestone

`quick-change` is the bounded, small-fix path against a milestone that's
already `completed` — never a way to reopen or rewrite it:

```bash
pitway quick-change create --objective "..." --scope path/to/file --verify "npm test"
pitway quick-change approve <change-id>   # hashes and locks scope + verify command
# ... make the edit ...
pitway quick-change run <change-id>       # executes the approved verify command
pitway quick-change commit <change-id>    # one commit, PitWay-Change trailer
```

`pitway resume` is the authoritative recovery view if a quick-change is left
mid-flight.

## Opt-in Policies

Both live in `.pitway/config.yaml`, both off by default:

```yaml
git:
  branch_strategy: milestone     # each milestone gets its own dedicated branch
execution:
  strategy: parallel_worktrees   # independent, disjoint-scope tasks can dispatch concurrently
```

See [README.md's Opt-in Policies section](./README.md#opt-in-policies) for
what each does when enabled.

## Claude Code Integration

`pitway init` installs PitWay's commands as real Claude Code slash commands
under `.claude/commands/*.md`, each carrying `description`/`argument-hint`
frontmatter so they show up properly in Claude Code's `/` picker (e.g.
`/task-add`, `/milestone-status`). Alongside them, `.claude/protocol-driver.md`
and its companion documents are what actually teach an AI driver session how
and when to call each command — the slash-command files themselves are thin
pointers into that protocol, not a second copy of it.

## Command Reference

Full flags for any command: `pitway <command> --help`. Grouped by what
they're for:

| Area | Commands |
| --- | --- |
| Setup | `init` |
| Orientation | `resume`, `milestone-list`, `milestone-status`, `task-status` |
| Drafting | `milestone-add`, `write-ms-artifacts` |
| Human gates | `milestone-confirm`, `milestone-complete` |
| Task execution | `task-update`, `task-verify` |
| Mid-flight correction | `task-add`, `task-amend` |
| Parallel execution | `task-dispatch`, `task-integrate`, `task-discard` |
| Verification | `verify`, `verification-repair` |
| Milestone review | `milestone-review` |
| Post-completion fixes | `quick-change` |
| Housekeeping | `milestone-cancel`, `usage-add`, `auto-run` |

## Getting Help

Every command's errors are meant to be actionable on their own — a refusal
names what's wrong (e.g. an unrelated dirty file, a missing `--result`, a
hash mismatch) rather than a raw stack trace. If a command refuses and you
don't understand why, `pitway resume` is usually the fastest way to see
what state PitWay thinks you're in.
