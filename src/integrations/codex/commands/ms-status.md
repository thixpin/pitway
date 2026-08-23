---
description: "PitWay: Show a milestone's status, contract, progress, and tasks"
---

# milestone-status

```sh
pitway milestone-status <id> [--report] [--json]
```

Use this to orient on one milestone: its contract, progress, and the
status of every task in it. Reach for it when the developer asks "where
are we on M00X" or before deciding what to dispatch next within a
milestone you already know the id of — `resume` is the broader "what's
going on in this repo at all" equivalent when you don't.

When relaying `pitway milestone-status` or `pitway resume` output to the
developer, reproduce the rendered table and racing footer as-is —
annotations may surround the verbatim block, but never prose summaries
that replace the table or footer. Once a milestone is confirmed, end routine progress updates with the footer line (see `../protocol-driver.md` Progress reporting).

See `../protocol-driver.md`. Run `pitway milestone-status --help` for
flags.
