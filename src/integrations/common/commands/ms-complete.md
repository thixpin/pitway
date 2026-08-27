---
description: "PitWay: Complete an in_progress milestone once every task and check has passed"
---

# milestone-complete

```sh
pitway milestone-complete <id> [--json]
```

The terminal step: run it once every task is `completed` and every
verification check has passed. It's what actually closes the milestone out
— don't treat a milestone as done, or tell the developer it's done, until
this has run successfully.

Its human-mode output ends with: `Run 'pitway milestone-merge <id>' only
with separate, explicit developer approval -- it is never run
automatically.` Under `branch_strategy: milestone`, that is the actual next
step — but never run `milestone-merge` on the strength of this completion
alone; wait for the developer to separately ask for it, exactly as stated.
(`--json` output does not carry this sentence.)

See `../protocol-driver.md`.
