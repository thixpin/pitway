---
description: "PitWay: Apply a dispatched task's worktree commit to the main tree"
---

# task-integrate

```sh
pitway task-integrate <id> [--json]
```

Integrates one dispatched task's worktree commits back into the main tree,
diff-apply-model, one task at a time: computes the combined range diff
(`--binary --no-renames`, created-from revision to scaffolding-branch
HEAD), refuses before writing anything if any changed path (deletions
included) falls outside the task's `write_scope` or touches `.pitway/` or
the worktree marker, pre-checks the apply (`git apply --check` — a failed
check leaves the main tree byte-identical, the worktree preserved, and the
task `in_progress`; PitWay never invents a merge), then applies the diff
**uncommitted**, appends a `worktree_integrate` journal record (worker SHA
as evidence-only metadata), and removes the worktree + scaffolding branch.
The branch never enters history.

Completion stays the existing path, after integration: authoritative
`task-verify <id>` in the main tree (while still `in_progress`), then
`task-update <id> review`, then `completed` for the one atomic commit.

Re-runs are idempotent across both crash windows: an already-recorded
integration finishes cleanup only; an applied-but-unrecorded diff
(reverse-apply detected) finishes the record + cleanup. In both windows the
work is already in the main tree — never `task-discard` there.

Refusals name their cause: no live dispatch, vanished worktree (→
task-discard), worker committed nothing, empty diff, dirty main tree,
scope violation (every offending path named).

See `../protocol-driver.md` (Parallel dispatch).
