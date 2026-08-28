---
description: PitWay: Confirm a draft milestone, or record an amended verification plan
argument-hint: <id>
---

# milestone-confirm

**Role:** Main Agent

```sh
pitway milestone-confirm <id> [--amend] [--file <path>] [--json]
```

The human gate. Run this only after the full contract has been presented
in this conversation and the developer has explicitly approved it — never
on your own judgment that the contract "looks fine." Confirming moves the
milestone from `draft` to `confirmed` and is what allows task work to
begin.

**MUST (every driver, B021):** never invoke this command without that
explicit in-conversation developer approval. "Keep going", auto-run
authorization, a subagent's report, or a prior session's approval never
substitute. Stop, present the contract, wait for the yes.

`--amend` records a pending amendment to an already-confirmed milestone's
contract (a scope change discovered mid-execution, an append-only Change
Log entry). It carries the exact same approval requirement: propose the
change, get explicit developer approval in conversation, then run it —
never as a way to route around a blocker without that approval.

Contract/amendment and task file formats: `../draft-formats.md`.

See `../protocol-driver.md` for the decision-gate rule this command
enforces. Run `pitway milestone-confirm --help` for flags.
