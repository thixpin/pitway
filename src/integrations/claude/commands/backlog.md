---
description: PitWay: Capture out-of-scope work discovered mid-task, without expanding current scope
argument-hint: <add|list|show|promote|archive> [id]
---

# backlog

**Role:** Orchestrator (add, promote, archive) · either (list, show)

```sh
pitway backlog add --title <text> --reason <text> [--milestone <id>] [--task <id>] [--json]
pitway backlog list [--status pending|promoted|archived] [--milestone <id>] [--task <id>] [--json]
pitway backlog show <id> [--json]
pitway backlog promote <id> --task <id> [--milestone <id>] [--json]
pitway backlog archive <id> --reason <text> [--json]
```

Use when you discover work that is genuinely out of scope for the current
task or milestone and want to continue without expanding it — capture it,
keep going, deal with it later. `backlog add` works with **no active
milestone** — it records `source.milestone: null` in that case, no
milestone required. `backlog promote` still requires an active/resolvable
milestone, since it targets a task, which is inherently milestone-scoped;
only `add`'s milestone coupling was removed.

- `backlog add --title <text> --reason <text> [--milestone <id>] [--task
  <id>]` — records a `pending` item. `--milestone`/`--task` here are
  **source annotation only** (defaults to the active milestone — or `null`
  when none is active — and no task, when omitted) — they never control
  where the mutation's journal entry attaches (when a milestone is active,
  that is always the active milestone, unconditionally, with no override:
  `.pitway/backlog.yaml` is a shared file, not owned by any one milestone's
  directory, so letting a flag redirect attachment could misattribute a
  pending entry to a milestone that will never checkpoint it). With no
  active milestone, behavior is otherwise unchanged.
- `backlog list [--status pending|promoted|archived]` and `backlog show
  <id>` — read-only.
- `backlog promote <id> --task <task-id> [--milestone <id>]` — a pure
  terminal transition linking an **already-existing** task back to its
  backlog origin. `--task`/`--milestone` here mean the promotion target
  only (milestone defaults to the active one). This command never runs
  `task-add`/`milestone-add` itself — create the real task or milestone
  first, through the normal human-confirmed pipeline, then promote the
  backlog item to close the loop.
- `backlog archive <id> --reason <text>` — a pure terminal transition, no
  `--milestone`/`--task` (archiving names no other work).

Both `promoted` and `archived` are terminal — `pending` is the only status
either transition starts from.

`.pitway/backlog.yaml` is the authoritative backlog state, committed
alongside whatever commit the workflow next produces — never a dedicated
commit of its own, and never left dirty in a way that breaks a task's own
clean-tree check.

See `../protocol-driver.md`'s "Choosing a correction mechanism" section for
when to reach for `backlog` instead of `task-add` or a quick-change. Run
`pitway backlog --help` for flags.
