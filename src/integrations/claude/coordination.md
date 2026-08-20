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

## Parallel mode moves the hazard, it does not remove it

Under `execution.strategy: parallel_worktrees` the shared-tree hazard above
inverts: dispatched workers write only in their own worktrees, so the main
tree stays clean while they run — but the stale-snapshot rule moves to the
**integrate boundary**. Every `task-integrate` changes the main tree (an
applied, uncommitted diff) and every completion commit changes HEAD:
re-derive tree status with the same read-only primitives after *each*
integrate/completion step, and never carry a snapshot taken before a
dispatch batch across any integrate.

Two further parallel-mode facts, verified rather than assumed:

- A task worktree's committed `.pitway/` copy is **stale read-only
  transport**: it shows pre-dispatch task state, and per-worktree git-path
  resolution means the journal reads as empty there. Neither you nor a
  worker may treat in-worktree reads as authoritative — the driver passes
  the bundle from the main root instead.
- The state guard enforces this mechanically: every state-mutating pitway
  command refuses inside a task worktree; only read-only commands run
  there, as a convenience, with the staleness above.
