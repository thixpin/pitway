---
description: "PitWay: Run an in_progress task's approved verification command and persist evidence"
---

# task-verify

Runs an `in_progress` task's own approved `command`/`tdd` verification
command (plus an optional `--typecheck <command>`) and persists a
**verification record** — a full `task_verify_evidence` journal entry
covering the run's exit code, pass/fail counts, and a fingerprint of the
task's declared `write_scope`/`relevant_files`. Each record is named by an
**evidence id** (e.g. `tve-a1b2c3`). This is the formal replacement for an
ad hoc independent rerun-and-eyeball of the verification command — see
`../protocol-driver.md`. It does not replace your own diff/write_scope
review, which still happens first, every time.

Must run while the task is still `in_progress` — before `pitway task-update
<id> review`, not after (`review`'s own `tasks.yaml` rewrite never
invalidates a recorded evidence record).

`pitway task-update <id> completed` then resolves one record — implicitly,
the newest one for this task, or explicitly via `--evidence <id>` — and
validates it (task identity, run success, attempt match, command match,
write_scope match, fingerprint match) before completing. On success, its
captured evidence unconditionally becomes the **persisted result
evidence** — the final, capped string that lands in `task.result.evidence`
— replacing whatever `--result`'s file carried for that field.

**Once any evidence record exists for a task, plain `--result`/`--message`
completion can no longer bypass it.** The only way forward is a fresh,
passing `task-verify` run producing a newer valid record. This is not a
documented escape hatch; there isn't one.

See `../protocol-driver.md` and `../dispatch.md`. Run `pitway task-verify
--help` for flags.
