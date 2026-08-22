---
description: PitWay: Manage auto-run authorization for automatic task continuation
argument-hint: <enable|disable|status> [milestone-id]
---

# auto-run

```sh
pitway auto-run enable [milestone-id] [--json]
pitway auto-run disable [milestone-id] [--json]
pitway auto-run status [milestone-id] [--json]
```

Manages auto-run *authorization* only — it never dispatches, executes, or
transitions a task itself. Authorization is a milestone-scoped fact, derived
purely from `enable`/`disable` records and the milestone's own journal
history; nothing here runs a task loop.

`enable [milestone-id]` requires the milestone be `in_progress` and records
its current `verification_approved_hash`; re-running it while still
authorized against that same hash is a safe no-op. `disable [milestone-id]`
and `status [milestone-id]` both work for a milestone in any status.

You call `enable` only when the developer selects **Auto-run** at the task
continuation prompt, and `status` before every auto-continued step —
necessary but never sufficient on its own. See `../interactive-ux.md` for
the full decision UX and the live checks that sit alongside `status`, and
`../protocol-driver.md` for how this fits the rest of the driver protocol.
Run `pitway auto-run --help` or `pitway auto-run <subcommand> --help` for flags and details.
