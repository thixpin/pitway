# Dispatch

This is the driver-facing detail behind `protocol-driver.md`'s "dispatch
discipline" summary: how a task actually gets handed to a worker, and what
PitWay does and does not guarantee once it has been. It also covers
**whether** to dispatch at all — inline execution is a first-class option,
not a fallback.

## Choosing inline vs. sub-agent dispatch (M007/AC010)

**Inline is the default** for documentation, review/manual work, localized
fixes, and small-scope tasks. `verification.strategy: tdd` alone is
**not** a reason to dispatch — a task can produce real test code and still
be small and well-understood enough to execute inline.

**Dispatch to a sub-agent when it provides a material isolation or
concurrency benefit**: an independently bounded multi-file implementation,
cross-subsystem work, disjoint parallel-ready scope, or a context-heavy
investigation that benefits from a separate, focused context rather than
crowding the driver's own. Weigh the task's expected effort against
observed sub-agent startup overhead (measured at roughly 32K tokens for
even a trivial single-file task, M007/T001) — avoid dispatch when that
overhead is disproportionate to the work.

**A contract-mandated sub-agent dispatch is never overridden** by this
rule — if a task or contract explicitly requires dispatch (e.g. for
independent-review integrity), that requirement stands regardless of size
or strategy.

**The driver chooses autonomously.** Record the selected mode and a brief
rationale before starting the task; do not ask the developer per task
unless the choice is materially ambiguous.

## The dispatch sequence (once you've chosen to dispatch)

1. Confirm the task is actually ready: `pitway resume` or
   `pitway task-status <id>`. Never dispatch a task PitWay hasn't marked
   `ready`.
2. Start it: `pitway task-update <id> in_progress`.
3. Pull its context bundle: `pitway task-status <id> --context --json`. This
   is the *only* task-specific material a worker should receive — no
   milestone history, no sibling task detail beyond each dependency's
   concise result summary already folded into the bundle.
4. Dispatch a worker using your own tooling (whatever subagent/sub-session
   mechanism your harness provides), handing it exactly two things: the
   fixed text in `protocol-worker.md`, and the bundle from step 3. Nothing
   else.
5. Take a fresh git snapshot only *after* the worker completes — never
   trust one taken before or during dispatch. See `coordination.md`. Review
   the diff and write_scope yourself against the worker's report before
   doing anything else.
6. While the task is still `in_progress`, run `pitway task-verify <id>` to
   produce a formal, journaled verification record — see
   `commands/task-verify.md`. This replaces an ad hoc independent
   rerun-and-eyeball of the verification command; it does not replace the
   diff review in step 5, which still happens first.
7. Move the task to review: `pitway task-update <id> review`.
8. Persist what the worker reported: `pitway task-update <id> completed
   --result <file> --message <file>` (or `blocked` / `failed`, as the
   report warrants). You run this, not the worker. No `--evidence` flag is
   needed — the task-verify record from step 6 is picked up automatically.

## What "bounded" actually means

PitWay bounds the **supplied bundle** — the task-context JSON handed to the
worker in step 4 is provably minimal, built by
`src/core/tasks/context-bundle.ts` from the task's own declared fields and
nothing else.

PitWay does **not** bound, and makes no claim to bound, the worker's
**total context**. Whatever your harness injects on top of that bundle —
system prompt, tool definitions, skills, project memory, prior conversation
state a sub-session happens to inherit — is outside PitWay's control and
outside what PitWay can verify. Do not represent a dispatched worker as
context-isolated beyond the bundle itself; it isn't, and PitWay has no way
to make it so.

Likewise, **no runtime read-enforcement exists.** A task's `context_files`
names what a worker is expected to read; nothing in PitWay's code prevents
a worker from reading a file outside that list, and no such enforcement is
built by this milestone. Whether and how to build actual read enforcement
is an explicit **M007** decision, not something this protocol pretends is
already handled.

## Write scope stays enforced, on both ends

Unlike the read side, the *write* boundary is real and mechanically
checked in two places:

- Before dispatch (or any time you want to sanity-check a planned write
  set), `checkWriteScope(writePaths, task)` in
  `src/core/tasks/write-scope-check.ts` compares a structured list of paths
  against the task's declared `write_scope` (or legacy `relevant_files`)
  and names anything outside it. It is write-only — it says nothing about
  `context_files` or any read boundary.
- At completion, `pitway task-update <id> completed` independently refuses
  to commit if the working tree carries any dirty path outside that same
  boundary. A worker that ignored its write scope simply cannot complete
  the task; the commit is refused with the offending paths named.
