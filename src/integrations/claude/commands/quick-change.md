---
description: PitWay: Bounded small-fix workflow, usable whenever no milestone is active
argument-hint: <create|approve|run|commit|cancel|promote|status> [change-id]
---

# quick-change

```sh
pitway quick-change create --objective <text> [--scope <path> ...] --verify <command> [--tdd-exempt <reason>] [--closes <backlog-id>] [--json]
pitway quick-change approve <change-id> [--json]
pitway quick-change run <change-id> [--json]
pitway quick-change commit <change-id> [--json]
pitway quick-change cancel <change-id> [--json]
pitway quick-change promote <change-id> [--json]
pitway quick-change status [change-id] [--json]
```

Use for a small, bounded fix that fits in one atomic commit, whenever
`active_milestone` is `null` — it cannot run while any milestone is
active, in any status (draft, confirmed, in_progress, or review); a bug
discovered inside an active milestone must use the existing
milestone/task/ripple-fix workflow instead, never quick-change. Never to
reopen, rewrite, or amend a prior milestone or any of its existing
commits.

**Bounded means bounded.** If investigation surfaces a schema/API change,
a new or changed dependency, a security-sensitive change beyond the
immediate defect, a migration, multi-subsystem impact, or anything
otherwise architectural, stop and run `quick-change promote <change-id>`
instead of continuing — propose converting the work into a Milestone.

For a defect fix, follow this full sequence, always in order (`bug-fix`
skill + TDD discipline B020 + human-approval gate B021):

1. **Investigate and reproduce.** Use the `bug-fix` skill: confirm the bug
   with a concrete failing case first. If the root cause isn't yet known,
   use `debugging` to establish one before continuing — never guess.
2. **Confirm the root cause.** State it in one sentence, and check that
   the fix you're about to make targets it, not the symptom.
3. **`quick-change create --objective <text> --scope <path>... --verify
   <command> [--tdd-exempt <reason>] [--closes <backlog-id>]`** — requires
   `active_milestone: null` and a clean working tree. `--objective` should
   name the bug and the confirmed root cause; `--scope` declares the exact
   file census the fix may touch — an allow-list ceiling `commit` enforces,
   not a requirement that every declared path be modified. Prefer extending
   an existing adjacent test as `--verify`; only add a new one when nothing
   already covers this path. `--closes <backlog-id>` links this change to a
   pending backlog item it resolves — `create` validates the id exists and
   is `pending` (refuses with a clear error otherwise). Optional; a change
   with no `--closes` hashes identically to one predating the flag.
4. **`quick-change approve <change-id>`** — hashes and locks the declared
   scope/verify command (and any `--tdd-exempt` reason).
5. **Reproduce / RED.** Write the regression test before the fix whenever
   the bug is testable — it must fail on the current code for the same
   reason the bug occurs. Confirm RED via `quick-change run <change-id>`
   (expect `fail`). For doc-only / genuinely test-free changes where no
   meaningful failing test can exist, pass `--tdd-exempt "<reason>"` at
   `create` instead — the only sanctioned bypass; never fabricate a
   synthetic failing test to satisfy the gate.
6. **Fix minimally.** The smallest change that removes the root cause —
   no drive-by refactoring in the same commit.
7. **GREEN + related verification.** Confirm GREEN via `quick-change run
   <change-id>` (expect `pass`), then also run the smallest relevant
   surrounding tests to catch collateral damage, and check for sibling
   call sites sharing the same defect.
8. **Manual browser verification, when the fix touches frontend-visible
   behavior.** Exercise the actual change in the browser before requesting
   approval — in addition to, not instead of, the automated `--verify`
   command; there is no separate PitWay state for this, just a step you
   take and report before step 9.
9. **Human approval, before `commit`.** Present the diff (or a summary of
   it) and the run history, and wait for the developer's explicit yes in
   this conversation — same MUST rule as `milestone-confirm`
   (`../protocol-driver.md` "Decision authority and gates", B021). The
   original bug report or fix request authorized the investigation, not
   the commit.
10. **`quick-change commit <change-id>`** — lands one commit carrying a
    `PitWay-Change: <change-id>` trailer, only once the latest run passed
    **and**, unless `--tdd-exempt` was declared, at least one prior `fail`
    exists in the run history (enforced RED→GREEN). A single `pass` with
    no prior `fail` is refused. When the change was created with `--closes
    <backlog-id>`, the linked backlog item is archived in this **same**
    atomic commit as the fix — one commit, never a separate one, and the
    trailer stays `PitWay-Change: <change-id>` only. The archive is
    checked against the item's current status first, so a crash/retry
    between a successful archive and the landed commit is a safe no-op,
    never a hard failure.

A quick-change that is not a defect fix (a docs-only tweak, a version
bump) skips steps 1-2 and 5's reproduction, typically declaring
`--tdd-exempt` at step 3 instead.

`quick-change cancel <change-id>` abandons a still-pending (draft or
approved) change with no git operation. `quick-change promote <change-id>`
terminally converts a draft or approved change into a milestone draft
candidate instead — a promoted change can never later be committed as a
quick-change. Both carry a `--closes` id as provenance only — **neither
ever archives the linked backlog item**; it stays `pending`, exactly as if
`--closes` had never been passed. Only `commit` archives it.

`pitway resume` is the authoritative recovery view for a pending
quick-change; `quick-change status [<change-id>]` is a convenience read
only, never a substitute for it.

See `../protocol-driver.md`. Run `pitway quick-change --help` or `pitway quick-change <subcommand> --help` for flags and details.
