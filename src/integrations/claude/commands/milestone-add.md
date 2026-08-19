# milestone-add

Call this once a requirement has been broken down into a drafted contract
and a right-sized task graph, and you're ready to register the next
milestone. It creates the milestone in `draft` status — nothing is
confirmed yet, and no task work may start.

This is a planning-stage command, not a decision gate itself: the gate
comes next, at `milestone-confirm`, which requires the developer to have
actually seen and approved the contract you just registered. See
`../protocol-driver.md` for the full lifecycle and the decision-gate rule.

Run `pitway milestone-add --help` for flags.
