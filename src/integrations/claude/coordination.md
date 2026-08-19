# Shared-Worktree Coordination

PitWay runs sequentially in MVP — no branches, no worktrees, no stashes, no
merges of its own. But a dispatched worker still writes to the same
on-disk working tree you're sitting in, concurrently with whatever you do
while it runs. That shared tree is the coordination hazard this document
exists to name.

## The finding this codifies

An M004/T003 investigation found that a git status/diff snapshot taken
*before* or *during* dispatch goes stale the moment a subagent starts
writing files: by the time the subagent finishes, the tree has moved out
from under that snapshot, and any decision made against it (what's dirty,
what's expected, whether it's safe to proceed) is working from data that
was already wrong when it was read.

## The rule

**Always take a fresh snapshot after a dispatched subagent completes —
never before, never during, and never reuse one taken earlier in the
sequence.** Use the existing git-safety primitives rather than a raw `git
status` call of your own:

- `checkWorkingTreeClean` (`src/git/safety.ts`) — read-only working-tree
  status; reports clean/dirty and every dirty path. Does not stage, stash,
  or reset anything.
- `classifyDirtyPaths` (`src/git/safety.ts`) — takes that fresh status and
  sorts each dirty path into expected (the task's own write scope, a
  pending journal entry, an ordinary pending state write) versus
  unexpected. This is the same classification `pitway task-update` itself
  runs before it will commit anything.

Both are read-only Core-layer primitives — calling them doesn't stage,
commit, or otherwise change the tree, so there is no cost to calling them
again rather than trusting an earlier result.

## Why this matters beyond one bug

A pre-dispatch snapshot going stale isn't a one-off glitch to route around
with a retry — it's a structural property of dispatching into a shared
tree. Any driver logic that gates a decision on "is the tree clean/what's
dirty" must re-derive that answer after the dispatch step it's gating, not
carry a value computed earlier in the same turn.
