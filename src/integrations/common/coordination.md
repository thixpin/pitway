# Shared-Worktree Coordination

Under the sequential default, a dispatched worker writes into the same
on-disk working tree you are sitting in, concurrently with whatever you
do while it runs. A git status/diff snapshot taken *before* or *during*
dispatch is stale the moment the worker starts writing (M004/T003
finding); any decision made against it — what's dirty, what's expected,
whether it's safe to proceed — is working from data that was already
wrong when it was read.

**Which role does this (M043).** Taking the fresh snapshot, classifying
dirty paths, and every gating decision below belong to the session
dispatching workers — the *Orchestrator* role (`protocol-orchestrator.md`)
when the roles are split, the single driver session otherwise. The Main
Agent relies on the Orchestrator's report, never on its own earlier
snapshot.

## The rule

**Always take a fresh snapshot after a dispatched subagent completes —
never before, never during, and never reuse one taken earlier in the
sequence.** Any driver logic gating on "is the tree clean / what's dirty"
must re-derive that answer after the step it gates, never carry a value
computed earlier in the turn. Use the read-only git-safety primitives
rather than a raw `git status`:

- `checkWorkingTreeClean` (`src/git/safety.ts`) — clean/dirty plus every
  dirty path; never stages, stashes, or resets.
- `classifyDirtyPaths` (`src/git/safety.ts`) — sorts each dirty path into
  expected (the task's write scope, a pending journal entry, an ordinary
  pending state write) versus unexpected; the same classification
  `pitway task-update` runs before it commits anything.

Both are read-only, so re-calling them costs nothing versus trusting an
earlier result.

## Parallel mode moves the hazard, it does not remove it

Under `execution.strategy: parallel_worktrees`, workers write only in
their own worktrees, so the main tree stays clean while they run — and
the stale-snapshot rule moves to the **integrate boundary**: every
`task-integrate` changes the main tree (an applied, uncommitted diff) and
every completion commit changes HEAD. Re-derive tree status with the same
primitives after *each* integrate/completion step, and never carry a
snapshot taken before a dispatch batch across any integrate. A task
worktree's committed `.pitway/` copy is stale read-only transport (empty
per-worktree journal) and the state guard refuses mutating commands
there — see `protocol-driver.md` "Parallel dispatch".
