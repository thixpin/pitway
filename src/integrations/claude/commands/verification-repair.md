---
description: PitWay: Bounded, approve-before-edit correction after every task is done
argument-hint: <approve|commit|cancel> <milestone> [vr-id]
---

# verification-repair

**Role:** Main Agent (approve) · Orchestrator (propose, commit, cancel)

```sh
pitway verification-repair approve <milestone> [--file <path> ...] [--check <id> ...] --change-log <text> [--json]
pitway verification-repair commit <milestone> <vr-id> [--json]
pitway verification-repair cancel <milestone> <vr-id> [--json]
```

Use only for the exact narrow window M008's `6f8b5e6` exception covered:
every non-cancelled task in the target milestone is `completed`, the
milestone itself is still `in_progress` (not yet `milestone-complete`d),
and a genuine correction (not new scope) needs to land against it. Never a
substitute for task-level TDD while a task is still in flight.

Two phases, always in this order:

- `verification-repair approve <milestone> --file <path>... --check <id>...
  --change-log <text>` — run this BEFORE any implementation edit. Running
  it against the exact file/check list is itself the approval; it allocates
  a durable `VR` id and rejects an empty/duplicate list, a file path
  outside the repo, or an unknown check id. Command, manual, and review
  checks are all valid scope (B040). At most one repair may be pending per
  milestone.
- `verification-repair commit <milestone> <vr-id>` — run only after the
  edits are made. Reruns every approved command check; a manual/review
  check is satisfied only by a developer verdict recorded with `verify
  <milestone> --check <id> --pass` *after* the approval (a re-record is the
  honest equivalent of a rerun). Refuses the whole commit (repair stays
  pending) if any check fails or lacks its re-record, or if the dirty tree
  holds anything outside the approved scope.

`verification-repair cancel <milestone> <vr-id>` abandons a still-pending
repair.

See `../protocol-driver.md`. Run `pitway verification-repair --help` or `pitway verification-repair <subcommand> --help` for flags and details.
