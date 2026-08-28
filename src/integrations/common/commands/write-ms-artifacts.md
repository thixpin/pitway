---
description: "PitWay: Write a drafted contract and task plan to an explicit destination"
---

# write-ms-artifacts

**Role:** Main Agent

```sh
pitway write-ms-artifacts --contract <path> --tasks <path> --destination <dir> [--overwrite] [--json]
```

Writes a drafted contract and task plan out as plain files to an explicit
destination — the step between drafting a milestone's contract/tasks with
the developer and handing them to `milestone-add`, useful when you want the
draft on disk (for review, for diffing) before it's registered. `--overwrite`
is required to replace files already at the destination; without it the
command refuses rather than clobbering something that might not be yours to
overwrite.

Draft contract/tasks file formats: `../draft-formats.md`.

See `../protocol-driver.md`. Run `pitway write-ms-artifacts --help` for
flags.
