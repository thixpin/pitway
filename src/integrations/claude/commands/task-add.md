---
description: PitWay: Insert one new task into a confirmed or in_progress milestone
argument-hint: <milestone-id>
---

# task-add

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

See `../protocol-driver.md`. Run `pitway task-add --help` for flags.
