---
description: PitWay: Accumulate measured planning or qa token usage onto a milestone
argument-hint: <id>
---

# usage-add

**Role:** Orchestrator

```sh
pitway usage-add <id> --category planning|qa --usage <json> [--json]
pitway usage-add <id> --reading <json> [--json]
```

Records measured token usage — never estimated — onto a milestone's
`usage.yaml`, tagged `planning` or `qa` to keep it separate from per-task
usage recorded through `task-update --usage`. Only call this with a real,
runtime-reported figure; if a step's usage wasn't reported, leave it out
rather than guessing a number.

`--reading <json>` (M047) appends one measured usage **reading** by role
bucket instead — for figures the runtime reports about a session rather
than about one task, such as an Orchestrator session's own readings. Shape:
`{"bucket": "main|orchestrator|worker|auxiliary", "count": <int>,
"semantics": "per-turn|undetermined"}` plus optional `dimensions`
(`input`, `output`, `reasoning`, `cache_read`, `cache_write`), `model`,
`provider`, `instance_id`, and `raw` (the provider envelope verbatim).
Readings are stored as readings — two calls are two entries, never a sum —
and `--reading` cannot be combined with `--category`. Never record a total,
a percentage, a figure split across tasks, or anything taken from Codex's
command-output `original_token_count`; those are refused or simply have no
field (`docs/evidence/M042/synthesis.md`, section 9).

See `../protocol-driver.md`. Run `pitway usage-add --help` for flags.
