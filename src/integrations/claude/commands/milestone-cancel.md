# milestone-cancel

Use to permanently abandon a draft milestone — genuine abandonment, not a
routine correction. Only works while the milestone is still `draft`; the
directory and `contract.md` are preserved (status becomes `cancelled`) and
the id is never reused. No git operation occurs.

If the draft just has a mistake in it, use `milestone-add --replace <id>`
instead — that corrects it in place under the same id without burning it.

**Confirmed-milestone boundary**: `milestone-cancel` never applies once a
milestone is `confirmed`/`in_progress` — the state machine has no
`confirmed`/`in_progress -> cancelled` edge (`state-machine.ts`), by design.
To abandon *remaining* work in an already-confirmed milestone: cancel the
individual not-yet-started tasks (`task-update <id> cancelled`, valid from
`planned`/`waiting`/`ready`) and complete the milestone with whatever
required tasks are actually done. Never `git reset`/rewrite history to undo
a confirmed milestone or a completed task — that is exactly the class of
destructive action PitWay's git-safety rules exist to prevent. Adding
corrective or follow-on work the other direction — mid-flight, without a
new milestone — is `task-add`'s job; see `commands/task-add.md`.

See `../protocol-driver.md`. Run `pitway milestone-cancel --help` for flags.
