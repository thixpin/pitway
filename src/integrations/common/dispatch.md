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

**Which role does this (M043).** Every step of the sequence below — the
inline-vs-dispatch choice, `task-update`, gathering the bundle,
dispatching, the diff review, `task-verify`, and the completing
`task-update` — is *Orchestrator* work (`protocol-orchestrator.md`). The
*Main Agent* (`protocol-driver.md`) never runs these steps itself when the
roles are split; it receives the Orchestrator's report and relays any human
decision to the developer. The worker never runs any of them.

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
   **When the task was dispatched to a worker/subagent (step 4) and that
   dispatch's own tool result reports runtime usage** (a token-count
   figure the harness attaches to the dispatch result), extract it and
   pass it as `--usage '{"total_tokens": N, ...}'` on this same call — a
   MUST, not optional (`protocol-driver.md` "Dispatch discipline"). Inline
   execution has no such figure
   to extract; leave `--usage` unset there — `usage` correctly stays
   `null`. Never estimate, derive, or fabricate a number when none was
   reported.

**The same MUST rule applies to a dispatched reviewer's findings** (M021):
when a dispatched reviewer subagent's own tool result reports runtime
usage, extract it and pass it as `--usage '{"total_tokens": N, ...}'` on
the `milestone-review record <id> --role <role> --file <path>` call that
records those findings (`protocol-driver.md` "Milestone review") — never
estimate, derive, or fabricate a figure when none was reported; omitting
`--usage` correctly leaves that role's recorded usage `null`.

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
(advisory-only by design: PitWay proves what it declares ships, never that
a worker's reads obey the list).

## Write scope is enforced, on both ends

- Before dispatch (or any time): `checkWriteScope(writePaths, task)` in
  `src/core/tasks/write-scope-check.ts` names every path outside the
  declared `write_scope` (or legacy `relevant_files`). Write-only; it says
  nothing about reads.
- At completion: `pitway task-update <id> completed` refuses to commit if
  any dirty path lies outside that boundary, naming the offenders. A
  worker that ignored its write scope cannot complete the task.

## Sequential subagent dispatch

**Scope.** This applies only to a genuine dependency chain within a
milestone — task B `depends_on` task A, and so on. It is never used to
serialize two or more otherwise-parallel-eligible `ready` tasks with
disjoint write scopes; those stay eligible for `parallel_worktrees` or
independent dispatch exactly as today.

**What it actually saves.** Only the dispatched subagent's own
re-briefing/context-priming overhead across the chain — explicitly **not**
a reduction in the driver's own per-task work, which stays the full
existing dispatch sequence above (steps 1–8: confirm ready, task-update
in_progress, gather the bundle, dispatch, diff/write_scope review,
task-verify, task-update review, task-update completed) run once per task
exactly as today.

**Driver-agnostic behavior.** When the driving harness can resume a
previously-dispatched subagent with its own retained context, reuse that
identity for tasks 2+ in the chain, handing it only the new task's bundle
(step 3, unchanged); when the harness cannot resume a prior subagent,
dispatch a fresh worker per task exactly as the existing sequence already
does. The behavioral contract is identical either way — nothing about
correctness depends on which path a given driver takes.

**Usage attribution.** Per dispatch/resume call, never estimated or split
from an aggregate figure — the existing MUST rule (step 8 above) applies
once per task in the chain, whether that task resumed a prior subagent or
dispatched a fresh one.

**Stop the chain on failure.** A task that does not complete cleanly (diff
review or `task-verify` does not pass) stops the chain — the same
subagent is not resumed for the next task until that one reaches
`completed` through the normal recovery path (`blocked`/`failed`,
`task-amend`, or a fresh attempt).

**Visibility.** Results, evidence, status, and usage for every task in the
chain remain visible via the normal task-status/milestone-status surfaces,
since the driver itself runs every state-mutating command, exactly as for
any other dispatch.

**Context-isolation trade-off.** Reusing a resumed subagent's identity
across a chain relaxes something PitWay otherwise leaves fully bounded —
see below; this pointer does not itself restate that disclosure, so as
not to dilute it into a bare unverifiability caveat.

### Context-isolation trade-off

- **Task authorization and isolation stay fully enforced**, regardless of
  dispatch mode: `write_scope`, PitWay state access, the task lifecycle,
  verification evidence, and usage attribution stay task-specific and
  driver-controlled, exactly as today, for every task in a chain.
- **Ambient context isolation is intentionally relaxed** for a resumed
  subagent: prior tasks in the same delegated sequence may remain present
  in the subagent's own context and may influence its reasoning on a
  later task in that chain.
- **This retention is the mechanism the feature relies on**, not an
  accidental side effect — cutting re-briefing cost across the chain is
  the intended benefit of reusing a resumed identity.
- **PitWay cannot enforce or prevent that cross-task context influence**
  inside a resumed harness session, nor verify how much of it actually
  occurred — only the `write_scope` check at task-update completion
  bounds the blast radius, and only for writes, never for reasoning.

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
main tree (worker-side checks are advisory) — step 8's usage-propagation
MUST rule applies identically here: extract the dispatched worker's own
tool-result usage, not anything the worktree itself carries. Full
sequence, recovery, and `task-discard`: `protocol-driver.md` "Parallel
dispatch".
