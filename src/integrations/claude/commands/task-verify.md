---
description: PitWay: Run an in_progress task's approved verification command and persist evidence
argument-hint: <id>
---

# task-verify

```sh
pitway task-verify <id> [--typecheck <command>] [--timeout <ms>] [--json]
```

Runs an `in_progress` task's own approved `command`/`tdd` verification
command (plus optional `--typecheck <command>` and `--timeout <ms>` -- 1000..3600000, default 120000) and persists a
**verification record** — a full `task_verify_evidence` journal entry
covering the run's exit code, pass/fail counts, and a fingerprint of the
task's declared `write_scope`/`relevant_files`. Each record is named by an
**evidence id** (e.g. `tve-a1b2c3`). This is the formal replacement for an
ad hoc independent rerun-and-eyeball of the verification command — see
`../protocol-driver.md`. It does not replace your own diff/write_scope
review, which still happens first, every time.

Must run while the task is `in_progress` — before `pitway task-update <id>
review`, not after (`review`'s own `tasks.yaml` rewrite never invalidates a
recorded evidence record). If completion later refuses because no recorded
record resolves cleanly, `pitway task-update <id> in_progress` is a legal
recovery transition from `review` — run `task-verify` again from there to
produce a fresh record.

`pitway task-update <id> completed` then resolves one record — implicitly,
the newest one whose own run passed (searched newest-to-oldest, so a later
failing re-run never masks an earlier passing record), or explicitly via
`--evidence <id>` (strict: no such search, a failing or stale record named
explicitly still refuses) — and validates it (task identity, run success,
attempt match, command match, write_scope match, fingerprint match) before
completing. On success, its captured evidence unconditionally becomes the
**persisted result evidence** — the final, capped string that lands in
`task.result.evidence` — replacing whatever `--result`'s file carried for
that field.

**Once any evidence record exists for a task, plain `--result`/`--message`
completion can no longer bypass it.** But a task is never permanently
stuck: if no recorded record resolves cleanly at completion, recover with
`pitway task-update <id> in_progress`, then run `task-verify` again to
produce a fresh, valid record.

See `../protocol-driver.md` and `../dispatch.md`. Run `pitway task-verify
--help` for flags.
