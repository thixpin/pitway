---
description: "PitWay: Amend a task's objective, scope, or verification definition"
---

# task-amend

```sh
pitway task-amend <task-id> --file <path> --change-log <text> [--json]
```

Use when a task's own definition needs to change mid-flight — its
objective, acceptance criteria, file scoping (`relevant_files` /
`context_files` / `write_scope`), or verification — without that rising to
the level of a full contract amendment. Requires `--file` (the proposed
field changes) and `--change-log` (why); running the command is itself the
approval, so only run it once the change is actually settled, not while
still exploring options with the developer.

Amendment object format: `../draft-formats.md`.

See `../protocol-driver.md`. Run `pitway task-amend --help` for flags.
