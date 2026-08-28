---
description: "PitWay: Merge a completed milestone's branch into a target branch"
---

# milestone-merge

**Role:** Main Agent

```sh
pitway milestone-merge <id> [--target <branch>] [--json]
```

Run after `milestone-complete`, once a milestone is `completed`: merges the
milestone's own branch into a target branch (default: the milestone's
`base_branch`). Refuses immediately, before any git mutation, unless the
milestone's status is `completed`.

Only meaningful under `branch_strategy: milestone` — a main-strategy
milestone (`base_branch: null`) commits directly to its base branch and has
no separate branch to merge; `milestone-merge` refuses with a named error
in that case.

Run it from the milestone's own branch (the natural position right after
`milestone-complete`), or from a branch it has already been merged into —
re-running it there is a safe, idempotent no-op (`already-merged`, no
duplicate merge commit). Running it from an unrelated branch or a detached
HEAD where the milestone's completion commit isn't reachable is refused by
name.

On a merge conflict, the attempt is aborted and rolled back automatically
— it never leaves a half-merged working tree, and never auto-resolves. The
original branch is always restored on any failure.

See `../protocol-driver.md`. Run `pitway milestone-merge --help` for flags.
