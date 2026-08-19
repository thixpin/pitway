# M008/AC004 — Worker Read-Boundary Enforcement: Decision

Compiled 2026-08-19, as part of T003. Resolves the question M006/AC004 deferred "to an M007
decision," which no M007 AC addressed directly, and which M007/T013 explicitly assigned to M008.
Held to the tightened bar this contract's AC004 states: worktree isolation alone is not
enforcement, and a "feasible" candidate must address both shell/tool reads and escape paths
through a real, enforced permission or sandbox boundary.

## This repository's own real dispatch history (the evidence)

Every sub-agent dispatch across M006, M007, and M008 so far has run in the **same working tree**
the driver itself operates in — no isolated worktree, no container, no sandbox (`CLAUDE.md`: "No
branches/worktrees/stashes/merges; sequential execution in MVP"). A dispatched worker is a Claude
Code sub-agent with ordinary filesystem/shell tool access to anything reachable on disk. Nothing
in PitWay's own code restricts what such a worker reads — only what it may *write*
(`checkWriteScope`, M006/AC004, plus the completion-time `assertDirtySubset` check) is
mechanically enforced, and both operate on `write_scope`, never on `context_files`.

## Why a worktree is not, and cannot become, real enforcement

An isolated worktree changes *which copy of the repository* a worker's writes land in — it does
nothing about *reads*. A worker with shell access inside any worktree can still read any file the
OS lets that process see: absolute paths outside the worktree, symlinks, environment variables,
or simply `cat`-ing a sibling directory if one is reachable. Worktree isolation was never designed
to be a security or read-visibility boundary (M004/T003's original finding was about *write*
collision from a stale snapshot, not about restricting reads) — treating it as read enforcement
would be a category error, not a weak-but-real mechanism.

## Evaluating the two real candidates the contract requires considering

**Candidate 1 — an actual OS-level sandbox (container/chroot) around the worker.** This would
genuinely satisfy the bar: a process that cannot see files outside its sandbox cannot read them,
regardless of shell tricks or escape-path attempts. But building this requires PitWay to become
the thing that spawns, sandboxes, and manages the worker process's lifecycle — directly
contradicting PitWay's own already-established architectural boundary (M006/AC003, unchanged):
*"PitWay does not programmatically spawn Claude agents anywhere in this codebase... it supplies
instructions... never an agent-spawning mechanism of its own."* PitWay does not control the
dispatch mechanism at all — the driver's own harness does — so PitWay cannot construct a sandbox
around a process it never spawns in the first place.

**Candidate 2 — a restricted tool-permission allowlist enforced by the dispatching harness.**
This would also genuinely satisfy the bar, *if* PitWay could configure and verify it. It cannot:
tool-call authorization happens entirely inside the harness (Claude Code or any other compatible
driver), a layer PitWay has no visibility into and no way to configure from a `context_files`
declaration. PitWay could *declare* a boundary in the context bundle, but it has no way to know
whether any given harness actually enforces it, or silently ignores it — claiming enforcement
here would be a claim about behavior PitWay cannot observe or verify, which is exactly the kind
of unverifiable claim `report-format.md`'s and this repository's own honesty discipline exists to
prevent.

## Decision

**Advisory-only — an explicit, permanent-until-revisited non-goal**, adopted by the developer
exactly as concluded. The boundary, stated precisely:

- **`context_files` controls what PitWay supplies in a task-context bundle; it does not restrict
  what a worker may independently read.** It is declarative-only — a statement of what the worker
  is expected to read, not a technical restriction on what it can.
- **`write_scope` remains the mechanically enforced boundary**, unchanged, checked both before
  dispatch (`checkWriteScope`) and at completion/commit (`assertDirtySubset`).
- **PitWay makes no technical read-isolation claim**, because it does not own the agent runtime,
  the shell, tool permissions, or any OS-level sandbox — none of the layers where a real
  enforcement boundary would actually have to live.
- **Revisit only if PitWay later adopts an execution harness with a genuinely enforceable
  permission boundary** — not on a fixed schedule, and not by PitWay building its own
  sandboxing/spawning mechanism, which would itself be a far larger architectural decision than
  this one.

This is not a resource or priority constraint — it is a structural consequence of what PitWay
already, deliberately, is: a workflow-state controller that never spawns or sandboxes agents
itself (M006/AC003, unchanged). No read-enforcement implementation code is added in this
milestone. This decision must be reflected exactly — the same boundary statement above — in
`README.md` (AC003/T004) and in `IMPLEMENTATION_PLAN.md`'s roadmap reconciliation (AC005/T005),
not restated differently in either place.
