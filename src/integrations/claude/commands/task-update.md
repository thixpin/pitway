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

See `../protocol-driver.md` and `../dispatch.md`. Run
`pitway task-update --help` for flags.
