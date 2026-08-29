---
description: "PitWay: Show a milestone's status, contract, progress, and tasks"
---

# milestone-status

**Role:** either (read-only)

```sh
pitway milestone-status [id] [--json]
```

Show a milestone's status, contract, progress, and tasks.
Without [id], show the active milestone or No active milestone.
With [id], show that milestone regardless of status.
The full status report is the default output. And show as human-readable and nice UI.
Read-only; never mutate state, dispatch tasks, or perform recovery.
When relaying the output, preserve the rendered table and racing footer as-is.
When any usage or reading is recorded, the token breakdown also lists one
line per role bucket (main / orchestrator / worker / auxiliary): measured
segments plus a missing count, and a *count* of recorded readings — readings
are never summed, and no line ever shows a milestone total or a percentage
(M047; `docs/evidence/M042/synthesis.md`, section 9).

See `../protocol-driver.md`. Run `pitway milestone-status --help` for
flags.
