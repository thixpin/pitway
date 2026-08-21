# Dispatch

How a task is handed to a worker, what PitWay guarantees once it has been,
and whether to dispatch at all — inline execution is a first-class
option, not a fallback.

## Inline vs. sub-agent dispatch (M007/AC010)

**Inline is the default** for documentation, review/manual work,
localized fixes, and small-scope tasks. `verification.strategy: tdd` alone
is never a reason to dispatch.

**Dispatch when it gives a material isolation or concurrency benefit**: an
independently bounded multi-file implementation, cross-subsystem work,
disjoint parallel-ready scope, or a context-heavy investigation better
served by a separate focused context. Weigh expected effort against the
measured sub-agent startup overhead (~32K tokens even for a trivial
single-file task, M007/T001).

**A contract-mandated dispatch is never overridden** by this rule. **You
choose autonomously**: record the mode and a brief rationale before
starting the task; don't ask the developer per task unless the choice is
materially ambiguous.

## The dispatch sequence

1. Confirm the task is `ready` (`pitway resume` / `pitway task-status
   <id>`). Never dispatch a task PitWay hasn't marked ready.
2. `pitway task-update <id> in_progress`.
3. `pitway task-status <id> --context --json` — the *only* task-specific
   material a worker receives (no milestone history, no sibling detail
   beyond each dependency's result summary already in the bundle). The
   `required_skills` gate fires here: a declared skill missing at
   `.claude/skills/<name>/SKILL.md` refuses and names it — treat that as
   blocking; never dispatch without the bundle. The gate proves only that
   PitWay's managed installation is present, not that your harness loads
   it.
4. Dispatch a worker with exactly two things: `protocol-worker.md` and the
   bundle. Nothing else.
5. Take a fresh git snapshot only *after* the worker completes
   (`coordination.md`). Review the diff and write_scope yourself against
   the worker's report before anything else.
6. While still `in_progress`, `pitway task-verify <id>` for the formal,
   journaled verification record (`commands/task-verify.md`). It replaces
   the ad hoc rerun, never the diff review in step 5.
7. `pitway task-update <id> review`.
8. `pitway task-update <id> completed --result <file> --message <file>`
   (or `blocked`/`failed` as the report warrants). You run this, never
   the worker; the task-verify record is picked up automatically.

## What "bounded" means

PitWay bounds the **supplied bundle** — provably minimal, built by
`src/core/tasks/context-bundle.ts` from the task's declared fields and
nothing else. It does **not** bound the worker's **total context**:
whatever the harness injects (system prompt, tool definitions, skills,
project memory, inherited conversation state) is outside PitWay's control
and verification. Never represent a worker as context-isolated beyond the
bundle itself.

**No runtime read-enforcement exists.** `context_files` names what a
worker is expected to read; nothing in PitWay prevents reads outside it
(advisory-only by decision, M008 — see `IMPLEMENTATION_PLAN.md` §8).

## Write scope is enforced, on both ends

- Before dispatch (or any time): `checkWriteScope(writePaths, task)` in
  `src/core/tasks/write-scope-check.ts` names every path outside the
  declared `write_scope` (or legacy `relevant_files`). Write-only; it says
  nothing about reads.
- At completion: `pitway task-update <id> completed` refuses to commit if
  any dirty path lies outside that boundary, naming the offenders. A
  worker that ignored its write scope cannot complete the task.

## Parallel dispatch (worktree mode)

Under `execution.strategy: parallel_worktrees`, `pitway task-dispatch
<id>` replaces step 2: it transitions the task and creates its temporary
worktree + scaffolding branch, refusing when the task isn't
parallel-eligible (dependency relation or write-scope overlap with any
`in_progress` task, inline ones included), the tree is dirty, or a
journal-pending amendment would hand the worker a stale contract. Step 3
is unchanged — the bundle is always gathered at the main root; add the
assigned worktree path and branch to the envelope, and the worker follows
`protocol-worker.md`'s worktree section. On report: `task-integrate <id>`
one task at a time in ascending task id, then steps 5–8 unchanged in the
main tree (worker-side checks are advisory). Full sequence, recovery, and
`task-discard`: `protocol-driver.md` "Parallel dispatch".
