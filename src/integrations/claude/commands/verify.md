---
description: PitWay: Run approved command checks, or record a manual/review result
argument-hint: [id]
---

# verify

**Role:** Orchestrator (runs, --check records) · either (--status)

```sh
pitway verify [id] [--status] [--json]
pitway verify [id] --check <ctid> [--json]
pitway verify [id] --check <ctid> --pass|--fail --evidence <text> [--json]
```

Runs the milestone's approved `command` checks and records the results;
`--check <id> --pass|--fail --evidence <text>` records a `manual`/`review`
check a human (or you, on the human's behalf, for a `review`-type check)
had to actually evaluate. Only ever runs the commands approved at
`milestone-confirm` time (`verification_approved_hash`) — never an
agent-authored command that wasn't part of that approval.

Use it once every task in a milestone is done, to check the milestone's
acceptance criteria as a whole before `milestone-complete`.

When a `command` check fails, its `verification-results.yaml` entry (and
the matching `--json` result) may additionally carry `fail_count`,
`pass_count`, and `failures` — a structured record of what failed, kept
beside the 200-char `evidence` string, never inside it. The counts come
from the runner's own `Tests  N failed | M passed` summary line; `failures`
lists the failing test names (vitest's `FAIL ` / `×` lines, capped at 12)
followed by the first error lines (any `<Word>Error:` line — `Error:`,
`AssertionError:`, `TypeError:`, `ReferenceError:`, ... — capped at 3).
That wider error matcher belongs to the structured extractor only; the
`evidence` string's own `failures:` summary is unchanged. The human output
renders them as indented lines under the failed check, on a full run and on
a `--check <ctid>` rerun alike: a count line listing only the counts present
(`failed: 7 (passed: 3)`, or just `failed: 7` when the runner reported no
passed count — never a fabricated 0), then one `- <entry>` line per
failure. The fields are absent — and nothing extra renders — for passing
checks, for developer-recorded `manual`/`review` results, for a failing
command whose output matched none of the patterns, and for every entry
recorded before this feature existed.

See `../protocol-driver.md`. Run `pitway verify --help` for flags.
