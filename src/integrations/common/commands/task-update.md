---
description: "PitWay: Transition a task's status; completion commits its files atomically"
---

# task-update

**Role:** Orchestrator

```sh
pitway task-update <id> <status> [--result <path>] [--message <path>] [--usage <json>] [--evidence <id>] [--json]
```

The only way a task's status ever changes, and the only way its completion
commit ever gets made. You run this — a dispatched worker never does; it
reports back to you instead (see `../protocol-worker.md`).

Typical calls: `in_progress` to start a task (requires a clean tree first —
see `../coordination.md`), `review` once a worker reports done, `completed
--result <file> --message <file>` to persist the worker's report and
commit its files atomically, `blocked`/`failed` when a worker couldn't
proceed. `--result`'s `summary`/`evidence` are capped on the way in — see
`../report-format.md`.

`in_progress` is also a legal *recovery* transition from `review` — for a
task stuck there because `completed` couldn't resolve any valid
`task-verify` evidence. Unlike the fresh-start case, this tolerates the
task's own already-dirty `write_scope`/`relevant_files` paths (carried over
uncommitted from the original attempt); any other unrelated dirty path
still refuses. The same applies to `failed`/`blocked → ready → in_progress`
retries. See `../task-verify.md`.

`--usage <json>` accumulates measured token usage onto the task — a MUST
when completing a dispatched worker's task and its tool result reported
usage (`../dispatch.md` step 8, `../protocol-driver.md` "Dispatch
discipline"); never estimated or supplied for inline work with no runtime
figure available.

Result/usage payload shapes: `../draft-formats.md`.

--driver <name> / --model <id>: runtime-reported traceability stored in PitWay evidence (tasks.yaml, task-status --json); never added to Git trailers.

See `../protocol-driver.md` and `../dispatch.md`. Run
`pitway task-update --help` for flags.
