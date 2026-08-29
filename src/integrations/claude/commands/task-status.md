---
description: PitWay: Show a task's status, or its minimal execution context
argument-hint: <id>
---

# task-status

**Role:** either (read-only)

```sh
pitway task-status <id> [--context] [--json]
```

Two distinct uses, gated by `--context`:

- Without it: a quick look at one task's status, its dependencies, and its
  recorded result — useful mid-conversation without pulling the full
  dispatch bundle. With `--json` it also carries the task's declared scope
  (`relevantFiles`, or `contextFiles` + `writeScope`, whichever the task
  declares) and its `verification` (`strategy`, `detail`, `timeoutMs` when
  declared) — the fields a `task-amend` file must restate (M045).
- With `--context --json`: produces the minimal task-context bundle that
  goes to a dispatched worker — the one and only source of that bundle. See
  `../dispatch.md` for where this fits in the dispatch sequence and exactly
  what "minimal" means here.

See `../protocol-driver.md`. Run `pitway task-status --help` for flags.
