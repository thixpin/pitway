---
description: PitWay: Bounded small-fix workflow against an already-completed milestone
argument-hint: <create|approve|run|commit|cancel|promote|status> [change-id]
---

# quick-change

```sh
pitway quick-change create --objective <text> [--scope <path> ...] --verify <command> [--tdd-exempt <reason>] [--json]
pitway quick-change approve <change-id> [--json]
pitway quick-change run <change-id> [--json]
pitway quick-change commit <change-id> [--json]
pitway quick-change cancel <change-id> [--json]
pitway quick-change promote <change-id> [--json]
pitway quick-change status [change-id] [--json]
```

Use for a small, bounded fix against an already-completed milestone that
fits in one atomic commit — never while any milestone is `in_progress`
(that's a task or the ripple-fix policy instead), and never to reopen,
rewrite, or amend the source milestone or any of its existing commits.

Four steps, always in this order (TDD discipline, B020):

- `quick-change create --objective <text> --scope <path>... --verify
  <command> [--tdd-exempt <reason>]` — requires `active_milestone: null`
  and a clean working tree. Declares the exact file census the change may
  touch. For behavior-changing changes, follow RED→GREEN: write a failing
  test first, confirm RED via `run`, then implement and confirm GREEN.
  For doc-only / test-free changes, pass `--tdd-exempt "<reason>"` with an
  explicit justification; the exemption is hashed/locked at approve time.
- `quick-change approve <change-id>` — hashes and locks the declared
  scope/verify command (and any `--tdd-exempt` reason); running it is
  itself the approval.
- `quick-change run <change-id>` — executes the approved verify command
  after the implementation edit; every attempt, pass or fail, is recorded.
  For TDD, run once before the fix (expect `fail` / RED) and again after
  (expect `pass` / GREEN).
- `quick-change commit <change-id>` — lands one commit carrying a
  `PitWay-Change: <change-id>` trailer, only once the latest run passed
  **and**, unless `--tdd-exempt` was declared, at least one prior `fail`
  exists in the run history (enforced RED→GREEN). A single `pass` with no
  prior `fail` is refused.

`quick-change cancel <change-id>` abandons a still-pending (draft or
approved) change with no git operation. `quick-change promote <change-id>`
terminally converts a draft or approved change into a milestone draft
candidate instead — a promoted change can never later be committed as a
quick-change.

`pitway resume` is the authoritative recovery view for a pending
quick-change; `quick-change status [<change-id>]` is a convenience read
only, never a substitute for it.

See `../protocol-driver.md`. Run `pitway quick-change --help` or `pitway quick-change <subcommand> --help` for flags and details.
