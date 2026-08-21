# M016 — Parallel Dispatch and Recovery Dogfood Evidence (AC001/AC005)

Real dogfood evidence for this milestone's own `execution.strategy:
parallel_worktrees` and `task-discard` mechanisms, gathered against this
repository's actual working tree during M016's own execution — the first
real use of both since M014 built them.

## AC001 — the first real parallel dispatch since M014

T001 (`Harden the nested-full-suite init flake`) and T002 (`Fix
QuickChangeError identity split and requireQuickChange duplication`) are
genuinely independent: disjoint `write_scope` (T001 touches only
`tests/integration/completed-task-revision-path.test.ts`; T002 touches
`src/core/quick-change/{create,run,commit,promote}.ts` and
`tests/unit/quick-change-lifecycle.test.ts`) and no `depends_on` edge
between them.

**Dispatch (real `task-dispatch` output, quoted verbatim):**

```json
// T001
{
  "id": "T001", "milestone": "M016",
  "worktreePath": "/Users/thixpin/project/thixpin/pitway/.pitway-worktrees/M016-T001",
  "branch": "pitway/task/M016-T001",
  "createdFrom": "b6eeba3d735705dc6245697860ba95c1be704ab4",
  "dispatchId": "wtd-03559a65148e"
}
// T002 (first dispatch — later discarded and re-dispatched; see AC005 below)
{
  "id": "T002", "milestone": "M016",
  "worktreePath": "/Users/thixpin/project/thixpin/pitway/.pitway-worktrees/M016-T002",
  "branch": "pitway/task/M016-T002",
  "createdFrom": "b6eeba3d735705dc6245697860ba95c1be704ab4",
  "dispatchId": "wtd-b74128dff87a"
}
```

Both worktrees existed concurrently, both tasks reporting `in_progress`
simultaneously — confirmed live in
`docs/evidence/M016-live-resume-capture.txt`'s Capture 1. Two independent
worker subagents then did the actual implementation work, each confined to
its own worktree, each producing its own local commit on its own
scaffolding branch (`f9ff4f4...` on `pitway/task/M016-T001`,
`3b247f5b4...` on `pitway/task/M016-T002` after T002's real re-dispatch —
see AC005).

**Integration (real `task-integrate` output, quoted verbatim), one at a
time in ascending task id:**

```json
// T001
{
  "id": "T001", "milestone": "M016", "dispatchId": "wtd-03559a65148e",
  "workerSha": "f9ff4f416306ed4b09258f7fa616ff0b7f5e7df8",
  "changedPaths": ["tests/integration/completed-task-revision-path.test.ts"],
  "outcome": "integrated"
}
// T002
{
  "id": "T002", "milestone": "M016", "dispatchId": "wtd-7514f9334510",
  "workerSha": "3b247f5b4d775ed8f748f883873349f269b9a8ad",
  "changedPaths": [
    "src/core/quick-change/commit.ts", "src/core/quick-change/create.ts",
    "src/core/quick-change/promote.ts", "src/core/quick-change/run.ts",
    "tests/unit/quick-change-lifecycle.test.ts"
  ],
  "outcome": "integrated"
}
```

**Resulting mainline history — structurally indistinguishable from
sequential**, per M014's own guarantee, now proven against genuine dogfood
use rather than only a synthetic test:

```
4f82bd8 fix(quick-change): unify QuickChangeError class and requireQuickChange helper
  PitWay-Milestone: M016
  PitWay-Task: T002
0c3dbaa fix(test): harden completed-task-revision-path against load-induced timeout
  PitWay-Milestone: M016
  PitWay-Task: T001
b6eeba3 workflow: add milestone M016   (baseline)
```

- Per-task trailer commits, T001 then T002, in ascending integration order.
- Zero merge commits — each is a plain, linear commit atop the baseline.
- `git branch --list "pitway/task/*"` → empty. Zero surviving scaffolding
  branches.
- `git worktree list` → only the main checkout. Zero surviving worktrees.

## AC005 — recovery-path dogfood evidence

**Live-dispatch observation.** With both T001 and T002 genuinely
in-flight, `pitway resume` reported both as active dispatches with their
real worktree paths and branches — Capture 1 in
`docs/evidence/M016-live-resume-capture.txt`, captured by the driver at
that exact moment (design decision 6), not reconstructed after the fact.

**Sanctioned-abandonment path, exercised for real.** This milestone's own
task graph is fixed post-confirmation (no new task can be added to a
confirmed milestone — a real constraint discovered live while drafting
this evidence's original plan, which had assumed a disposable scratch task
could be added at draft time and removed afterward). Rather than skip this
AC, T002's own real, still-in-flight dispatch was used as the disposable
subject: discarded via `task-discard`, observed via `resume`, then
re-dispatched fresh to actually complete its real work.

```
🔧 Discarded T002's dispatch (wtd-b74128dff87a): worktree removed, task is
now failed (failed → ready allows re-dispatch). Discarded work is
unrecoverable through PitWay.
```

Immediately after, `resume` showed T002 as `✗ Failed`, its worktree entry
gone from the "Dispatched worktrees" section, T001 still `In Progress` and
unaffected — Capture 2 in `docs/evidence/M016-live-resume-capture.txt`.
T002 was then re-dispatched (`task-dispatch T002` → new `dispatchId
wtd-7514f9334510`, new worktree, new scaffolding branch) and completed
normally through the same real pipeline as T001 (see AC001 above).

**Scope boundary, disclosed (design decision 4):** this does not simulate
an actual process crash mid-dispatch — that is not safely reproducible
against this repository's own real working tree without risking
corrupting it. What's proven here is the live-dispatch reporting path and
the sanctioned, intentional `task-discard` abandonment path, both for
real. The narrower simulated-crash case (a worktree vanishing without a
clean `task-discard` call) stays covered only by M014's own existing
synthetic tests.
