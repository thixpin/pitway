---
description: PitWay: Bounded small-fix workflow against an already-completed milestone
argument-hint: <create|approve|run|commit|cancel|promote|status> [change-id]
---

# quick-change

Use for a small, bounded fix against an already-completed milestone that
fits in one atomic commit — never while any milestone is `in_progress`
(that's a task or the ripple-fix policy instead), and never to reopen,
rewrite, or amend the source milestone or any of its existing commits.

Four steps, always in this order:

- `quick-change create --objective <text> --scope <path>... --verify
  <command>` — requires `active_milestone: null` and a clean working tree.
  Declares the exact file census the change may touch.
- `quick-change approve <change-id>` — hashes and locks the declared
  scope/verify command; running it is itself the approval.
- `quick-change run <change-id>` — executes the approved verify command
  after the implementation edit; every attempt, pass or fail, is recorded.
- `quick-change commit <change-id>` — lands one commit carrying a
  `PitWay-Change: <change-id>` trailer, only once the latest run passed.

`quick-change cancel <change-id>` abandons a still-pending (draft or
approved) change with no git operation. `quick-change promote <change-id>`
terminally converts a draft or approved change into a milestone draft
candidate instead — a promoted change can never later be committed as a
quick-change.

`pitway resume` is the authoritative recovery view for a pending
quick-change; `quick-change status [<change-id>]` is a convenience read
only, never a substitute for it.

See `../protocol-driver.md`. Run `pitway quick-change --help` for flags.
