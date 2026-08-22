---
description: PitWay: Bounded, approve-before-edit correction after every task is done
argument-hint: <approve|commit|cancel> <milestone> [vr-id]
---

# verification-repair

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
  outside the repo, or a check that isn't a known command-type check. At
  most one repair may be pending per milestone.
- `verification-repair commit <milestone> <vr-id>` — run only after the
  edits are made. Reruns every approved check; refuses the whole commit
  (repair stays pending) if any fails or if the dirty tree holds anything
  outside the approved scope.

`verification-repair cancel <milestone> <vr-id>` abandons a still-pending
repair.

See `../protocol-driver.md`. Run `pitway verification-repair --help` or `pitway verification-repair <subcommand> --help` for flags and details.
