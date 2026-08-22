---
description: "PitWay: Create the next milestone from a drafted contract and task plan"
---

# milestone-add

```sh
pitway milestone-add --contract <path> --tasks <path> [--requirement <path>] [--replace <id>] [--json]
```

Call this once a requirement has been broken down into a drafted contract
and a right-sized task graph, and you're ready to register the next
milestone. It creates the milestone in `draft` status — nothing is
confirmed yet, and no task work may start.

This is a planning-stage command, not a decision gate itself: the gate
comes next, at `milestone-confirm`, which requires the developer to have
actually seen and approved the contract you just registered. See
`../protocol-driver.md` for the full lifecycle and the decision-gate rule.

`--replace <id>` corrects an existing draft in place under the same id
(mistakes in a not-yet-confirmed draft) — it never mints a new id and never
touches git. It only works while `<id>` is still `draft`; once confirmed,
use `milestone-confirm --amend` instead. To abandon a draft permanently
instead of correcting it, use `milestone-cancel`.

Run `pitway milestone-add --help` for flags.
