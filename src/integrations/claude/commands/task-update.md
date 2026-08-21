---
description: Transition a task's status; completion commits its files atomically
argument-hint: <id> <status>
---

# task-update

The only way a task's status ever changes, and the only way its completion
commit ever gets made. You run this — a dispatched worker never does; it
reports back to you instead (see `../protocol-worker.md`).

Typical calls: `in_progress` to start a task (requires a clean tree first —
see `../coordination.md`), `review` once a worker reports done, `completed
--result <file> --message <file>` to persist the worker's report and
commit its files atomically, `blocked`/`failed` when a worker couldn't
proceed. `--result`'s `summary`/`evidence` are capped on the way in — see
`../report-format.md`.

`--usage <json>` accumulates measured token usage onto the task — a MUST
when completing a dispatched worker's task and its tool result reported
usage (`../dispatch.md` step 8, `../protocol-driver.md` "Dispatch
discipline"); never estimated or supplied for inline work with no runtime
figure available.

See `../protocol-driver.md` and `../dispatch.md`. Run
`pitway task-update --help` for flags.
