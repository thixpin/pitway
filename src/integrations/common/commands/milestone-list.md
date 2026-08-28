---
description: "PitWay: List every milestone with a concise one-line status"
---

# milestone-list

**Role:** either (read-only)

```sh
pitway milestone-list [--json]
```

A one-line-per-milestone overview across the whole project. Use it when the
developer asks something spanning multiple milestones ("what have we
shipped so far", "what's still draft") rather than the detail of one —
`milestone-status <id>` is the drill-down once you know which one matters.

See `../protocol-driver.md`.
