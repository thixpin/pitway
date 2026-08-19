# M007/AC008 — Completed-Task-Revision Path

Compiled 2026-08-19, as part of T007. A supported path — using only already-shipped commands
(`milestone-add`, `milestone-confirm`, `task-update`, `verify`, `milestone-complete`), zero new
Core/CLI code — to deliver corrective work for a previously-completed task's deliverable later
found incomplete.

## Why no command supports reopening the original

Confirmed by direct inspection (M005 report.md §11.7, re-confirmed here): no command transitions
a task out of `completed` (terminal by design in the task state machine); no command appends a new
task to an already-confirmed milestone's task graph; `task-amend` rewrites only a task's
*definition* fields, never its persisted deliverable/result; and no command rewrites or amends an
existing completion commit. Reopening the original milestone or task is therefore never attempted
under this convention — not because it is forbidden by policy alone, but because no supported
command path exists for it at all.

## The convention

Corrective work for a task whose deliverable is later found incomplete lands as an **ordinary
task within a new (or next-drafted) milestone** — never by reopening the original. The new task's
objective explicitly names the original milestone/task id and what was found incomplete; its
completed `result.summary`/`result.evidence` (task-update's existing structured fields) explicitly
reference the original as what this corrective work revises. It never transitions any task out of
`completed` and never rewrites or amends an existing completion commit's history — corrective work
always lands as new, separately verified, separately committed work under its own
`PitWay-Milestone`/`PitWay-Task` trailers.

## Proof: a real, tested mechanism, not documentation alone

`tests/integration/completed-task-revision-path.test.ts` exercises the real lifecycle order (never
task completion before milestone confirmation) end to end: `milestone-add` A → `milestone-confirm`
A → execute and complete A's one task (its deliverable deliberately incomplete) → `verify`/
`milestone-complete` A → only then `milestone-add` B → `milestone-confirm` B → execute and
complete B's one corrective task, whose objective and completed result reference A's milestone/
task id → `verify`/`milestone-complete` B. The test asserts: A's completed task and commit SHA are
unchanged throughout every step of B's lifecycle (`git rev-parse` on A's commit SHA still resolves
to the same SHA; A's own commit is confirmed to remain a real ancestor of the final HEAD via `git
merge-base --is-ancestor`, proving it was never rewritten, not merely that its content looks
unchanged); no task ever leaves `completed`; B's corrective work is separately verified
(`verify --check CT001 --pass`) and separately committed under its own `PitWay-Milestone: M002`
trailer, distinct from A's `PitWay-Milestone: M001` (milestone ids are auto-assigned by
`milestone-add` in sequence — a real behavior discovered while building this test, not
developer-chosen). Zero new Core/CLI production code was added —
the test uses only `milestone-add`, `milestone-confirm`, `task-update`, `verify`, and
`milestone-complete`, all already shipped before this task.
