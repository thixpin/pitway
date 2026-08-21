---
description: PitWay: Accumulate measured planning or qa token usage onto a milestone
argument-hint: <id>
---

# usage-add

Records measured token usage — never estimated — onto a milestone's
`usage.yaml`, tagged `planning` or `qa` to keep it separate from per-task
usage recorded through `task-update --usage`. Only call this with a real,
runtime-reported figure; if a step's usage wasn't reported, leave it out
rather than guessing a number.

See `../protocol-driver.md`. Run `pitway usage-add --help` for flags.
