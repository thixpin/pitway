# M007/AC007 — Recovery Path for Defects in Already-Completed PitWay Tooling

Compiled 2026-08-19, as part of T006. A repeatable procedure, not a one-off exception, demonstrated
against four worked examples.

## The procedure

1. **Diagnose.** Confirm the defect is in already-completed, already-verified tooling — not
   ordinary in-scope work for the currently active task. Reproduce it directly (never assume);
   identify the root cause by reading the actual failing code, not by guessing.
2. **Route.** Decide whether the fix stays within the current milestone's approved scope, or must
   be deferred to a new task/milestone:
   - **Stays in scope** when: the fix is small, directly required to unblock the currently active
     task (or the milestone's own verification), does not expand contract or verification scope,
     and can be RED-then-GREEN verified in bounded time. Lands per M007/AC004's ripple-fix policy
     (folded into the discovering task's commit if it meets that policy's conditions, or a
     standalone commit if not).
   - **Deferred** when: the fix requires new Core mechanism beyond the current contract's approved
     ACs, touches unrelated subsystems at meaningful risk, or cannot be verified without expanding
     scope. Recorded as a documented finding for a later milestone (per M007/AC008's completed-
     task-revision path if the defect is in a specific already-completed *task's deliverable*, or
     a new task/milestone generally).
3. **Fix and verify.** RED-then-GREEN, not assumed: reproduce the failure with the exact predicted
   symptom, apply the fix, confirm the same check now passes. Regression coverage added before the
   fix is trusted for real use.
4. **Record.** The fix and its evidence are recorded — a standalone commit's own message and,
   where the defect was found during a running milestone, the discovering task's own result
   evidence and/or the milestone's report.

## Four worked examples

1. **M005/T007 — task-amend bootstrap repair.** `task-amend`'s idempotency model treated "one
   pending amendment per target" as invariant, refusing a second genuinely different amendment
   while the first was still uncheckpointed. Diagnosed directly (T007 hit it live, needing a
   second scope widening before the first had checkpointed). Routed: stayed in scope (a bounded
   Core fix, no contract expansion). Fixed in `src/core/tasks/amend.ts` (content-derived operation
   identity), 9 new regression tests added before the repaired command was used for real. Recorded
   as a one-time, developer-approved bootstrap recovery in `reports/M005.md` §6.
2. **M006/T001 — write_scope completion-staging fix (`81c99a2`).** `completeTask` never read
   `task.write_scope`, only `relevant_files` — a pre-existing M005 gap, invisible until M006/T001
   became the first task drafted entirely with `write_scope`. Diagnosed by direct inspection of
   `update.ts`. Routed: stayed in scope as a standalone hotfix (small, bounded, no contract
   expansion) — landed as its own commit under M006's own ripple-fix handling at the time
   (predating this milestone's AC004 decision, so it used the standalone-commit pattern rather
   than folding into T001's commit). RED-then-GREEN proven via `git stash`/restore. 3 regression
   tests added to `tests/integration/task-update.test.ts`.
3. **M006/T003 — baseline-managed-assets fix (`1e07014`).** `computeExpectedBaselinePaths` never
   knew about `init`-managed non-`.pitway/` files — a pre-existing M002/M004 mechanism that
   collided with M006/AC003's new `init` behavior, deterministic (5 files, 79 tests failing).
   Diagnosed by direct inspection of `baseline.ts`. Routed: stayed in scope, standalone commit
   (same reasoning as #2). RED-then-GREEN proven twice (a second independent instance of the same
   bug was caught mid-verification in `self-hosting-readiness.test.ts`).
4. **M006's recursion-guard test-isolation fix (`81a420a`).** A defect in T002's own
   already-completed test suite — `verify.test.ts`'s recursion-guard tests assumed a clean ambient
   `PITWAY_VERIFY_GUARD`, discovered only later during the milestone's own end-to-end dogfood of
   `pitway verify M006`. Same shape as #2/#3 (already-completed deliverable, defect surfaced by
   later work exercising it differently) despite being *within* the same milestone that produced
   it, not a prior one — establishing that "already-completed" means the deliverable's own commit
   already landed, not that it must belong to a prior milestone. Diagnosed by exact reproduction
   (`PITWAY_VERIFY_GUARD` pre-set to match the live failure condition). Routed: stayed in scope,
   standalone commit, `vi.stubEnv` isolation fix, verified in a specified 5-step order before
   commit.

## New-repository-managed-file-category guidance (from M006/T003's incident)

M006/T003's incident revealed a narrower, distinct failure mode: **when a task introduces a new
category of repository-managed file** (not just new source code — e.g. `init` starting to write
files outside `.pitway/`), contract-drafting or task-scoping must explicitly check that new
category against **every existing git-safety/dirty-path allowlist the codebase already has**
(`computeExpectedBaselinePaths`, `classifyDirtyPaths`, `assertDirtySubset`), not only against the
declared `write_scope` of the tasks being drafted. The contract for M006 was drafted before AC003's
`init` behavior existed to interact with `baseline.ts`, so no task was ever scoped to check that
interaction — this is a task-graph impact-analysis gap, not a code defect, and the fix is a
drafting-time discipline, not a runtime mechanism: before confirming a contract that introduces a
new file category, explicitly enumerate and check it against the git-safety allowlists above.
