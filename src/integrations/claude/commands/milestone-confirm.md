---
description: PitWay: Confirm a draft milestone, or record an amended verification plan
argument-hint: <id>
---

# milestone-confirm

```sh
pitway milestone-confirm <id> [--amend] [--file <path>] [--json]
```

The human gate. Run this only after the full contract has been presented
in this conversation and the developer has explicitly approved it — never
on your own judgment that the contract "looks fine." Confirming moves the
milestone from `draft` to `confirmed` and is what allows task work to
begin.

`--amend` records a pending amendment to an already-confirmed milestone's
contract (a scope change discovered mid-execution, an append-only Change
Log entry). It carries the exact same approval requirement: propose the
change, get explicit developer approval in conversation, then run it —
never as a way to route around a blocker without that approval.

See `../protocol-driver.md` for the decision-gate rule this command
enforces. Run `pitway milestone-confirm --help` for flags.
