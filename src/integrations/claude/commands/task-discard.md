---
description: PitWay: Abandon a dispatched task's worktree without integrating
argument-hint: <id>
---

# task-discard

**Role:** Orchestrator

```sh
pitway task-discard <id> --reason <text> [--json]
```

Abandons one dispatched task's worktree without integrating — the single
sanctioned exit besides `task-integrate` for a live dispatch. Requires an
explicit `--reason <text>`. Appends a `worktree_discard` journal record
(reason + discarded branch HEAD SHA when still resolvable, evidence-only),
removes the worktree and scaffolding branch (tolerating an
already-vanished worktree), and transitions the task `in_progress →
failed` through the existing state machine — whence `failed → ready`
allows a fresh dispatch, with attempts accumulating.

**Discarded work is unrecoverable through PitWay.** Never discard in an
integrate crash window (`cleanup pending`, or an applied-but-unrecorded
diff): the work is already recorded or applied in the main tree —
re-running `task-integrate <id>` finishes it. `pitway resume` names those
states read-only.

See `../protocol-driver.md` (Parallel dispatch). Run `pitway task-discard
--help` for flags.
