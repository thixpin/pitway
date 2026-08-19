# write-ms-artifacts

Writes a drafted contract and task plan out as plain files to an explicit
destination — the step between drafting a milestone's contract/tasks with
the developer and handing them to `milestone-add`, useful when you want the
draft on disk (for review, for diffing) before it's registered. `--overwrite`
is required to replace files already at the destination; without it the
command refuses rather than clobbering something that might not be yours to
overwrite.

See `../protocol-driver.md`. Run `pitway write-ms-artifacts --help` for
flags.
