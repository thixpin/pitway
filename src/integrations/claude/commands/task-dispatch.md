---
description: PitWay: Prepare a parallel-eligible task for worktree execution
argument-hint: <id>
---

# task-dispatch

**Role:** Orchestrator

```sh
pitway task-dispatch <id> [--json]
```

Prepares one parallel-eligible task for worktree execution under
`execution.strategy: parallel_worktrees` (refuses under `sequential`):
checks eligibility against every `in_progress` task — dispatched or inline
— (dependency-independence in both directions plus pairwise-disjoint
`write_scope`; legacy `relevant_files` tasks are never eligible), refuses
on a dirty main tree and on any journal-pending amendment (a worktree
would serve the stale pre-amendment contract — checkpoint first), then in
normative order: transitions `ready → in_progress` (attempts increment,
exactly like `task-update`), appends a `worktree_dispatch` journal record,
and creates the worktree at `.pitway-worktrees/<mId>-<tId>/` on scaffolding
branch `pitway/task/<mId>-<tId>`.

`--json` is the worker handoff envelope only — task id, absolute worktree
path, branch, created-from revision. It never embeds the context bundle:
obtain that at the main root via `task-status <id> --context` and pass it
to the worker yourself.

A dispatched task's only exits are `task-integrate` and `task-discard`;
direct `task-update` status changes refuse until the dispatch is closed.

Under `execution.strategy: parallel_worktrees`, `pitway resume` names
which `ready` tasks are parallel-eligible right now: when 2+ ready tasks
are mutually eligible (pairwise-disjoint `write_scope`, no dependency
relationship), its human-mode output additionally renders

```
🏎️ Parallel-eligible ready tasks: <id>, <id>, ...
  Consider parallel dispatch (task-dispatch <id>) for these.
```

— absent entirely (not an empty section) otherwise. `--json` carries the
same information as an additive `parallelEligible?: string[]` field,
present only under the same condition. This is advisory only: `resume`
itself never calls `task-dispatch`.

See `../protocol-driver.md` (Parallel dispatch) and `../dispatch.md`.
