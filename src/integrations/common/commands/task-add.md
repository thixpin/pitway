---
description: "PitWay: Insert one new task into a confirmed or in_progress milestone"
---

# task-add

**Role:** Main Agent

```sh
pitway task-add <milestone-id> --file <path> --change-log <text> [--json]
```

Use to insert one new task into a `confirmed` or `in_progress` milestone —
corrective or follow-on work discovered mid-flight that belongs alongside
the existing task graph, not a new milestone. Requires `--file` (one task
definition — the next sequential `Tnnn` id, a `name`, and every other
`taskSchema` field except execution-only ones, which are derived) and
`--change-log` (why); running the command is itself the approval. Refuses
on `draft` (use `milestone-add --replace`), `review` (resolve verification
first), `completed`, or `cancelled`, and on any `depends_on` id that is
unknown or cancelled.

**Dispatch rule**: the addition is a pending journal amendment until the
next checkpoint commit. Inline `task-update <new-id> in_progress` works
immediately; `task-dispatch` on any task refuses until a checkpoint (e.g. a
sibling task's completion commit) folds the pending entry.

Task file format: `../draft-formats.md`.

See `../protocol-driver.md`. Scope entries (`write_scope`, `context_files`, `relevant_files`) must name
files, never directories -- Core matches dirty paths exactly, so a directory
entry can never be satisfied at execution; the command refuses it by name
(M045). Files that do not exist yet are fine.

Run `pitway task-add --help` for flags.
