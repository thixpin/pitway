---
description: "PitWay: Run approved command checks, or record a manual/review result"
---

# verify

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

See `../protocol-driver.md`. Run `pitway verify --help` for flags.
