---
description: PitWay: Show a milestone's status, contract, progress, and tasks
argument-hint: "[id]"
---

# milestone-status

```sh
pitway milestone-status [id] [--json]
```

Show a milestone's status, contract, progress, and tasks.
Without [id], show the active milestone or No active milestone.
With [id], show that milestone regardless of status.
The full status report is the default output. And show as human-readable and nice UI.
Read-only; never mutate state, dispatch tasks, or perform recovery.
When relaying the output, preserve the rendered table and racing footer as-is.

See `../protocol-driver.md`. Run `pitway milestone-status --help` for
flags.
