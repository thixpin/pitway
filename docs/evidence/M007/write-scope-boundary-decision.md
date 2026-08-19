# M007/AC003 — Write-Scope Boundary Shape: Decision

Compiled 2026-08-19, as part of T003. Compares the current exhaustive positive `write_scope` file
list against a glob/directory-scoped alternative plus an explicit protected-path denylist, using
real amendment-frequency and scope-widening data across M005, M006, and M007-so-far.

## Baseline: write_scope size and amendment frequency under the current model

| Milestone | Tasks | Largest write_scope | Scope-widening amendments |
|---|---|---|---|
| M005 | 9 | T007: 21 files (started at 11) | 1 task (T007), 2 amendments |
| M006 | 6 | T003: 25 files | 0 |
| M007 (T001–T003 so far) | — | T001: 3 files | 0 (T001's contract/AC amendments were contract-level, not write_scope widenings) |

**24 tasks completed across M005+M006, exactly 1 (4.2%) ever needed a `write_scope` amendment**,
and that one case (M005/T007) needed it because a full read-only census only revealed the true
blast radius of slugged directories *after* implementation began — an inherent unknowability at
drafting time, not a symptom of the file-list format itself. A glob (e.g. `src/**/*.ts` scoped to
the affected modules) would not have avoided the need to *discover* which files were affected;
it might have avoided declaring each one individually once discovered, but the discovery — not
the declaration — was the actual cost.

## Comparison

**Exhaustive positive file list (current):**
- Every writable path is explicit and auditable — a reviewer can see the complete write boundary
  without executing anything or reasoning about glob-matching semantics.
- `checkWriteScope` (M006/AC004) compares a structured list against a structured list — no pattern
  matching, no ambiguity about whether a given path is in scope.
- Empirically low friction: 4.2% of tasks across two completed milestones ever needed widening.
- Real cost when widening is needed: one `task-amend` round-trip per genuinely new file discovered
  — cheap given `task-amend` already exists and is already developer-approval-gated.

**Glob/directory-scoped write_scope + protected-path denylist (proposed alternative):**
- Could reduce the number of *discrete entries* declared for a task like M006/T003 (25 files, all
  under `src/integrations/claude/`) — a single glob might replace 25 lines.
- Weakens auditability: a glob's actual matched-file-set can silently grow as new files are added
  to the matched directory, with no journaled event marking that growth — the declared boundary
  and the actual boundary can drift apart without either the contract or the task record reflecting
  it.
- Adds a second mechanism to reason about (allow-glob minus deny-list) in place of one simple
  positive list, increasing the cognitive and implementation cost of `checkWriteScope` itself.
- Does not address M005/T007's actual cost (discovery latency), since a glob still requires
  knowing which directory/pattern to declare — the census still has to happen first.

## Recommendation

**Reject.** The data does not show a real problem this milestone needs to solve: scope-widening
amendments occurred in 1 of 24 completed tasks (4.2%) across M005 and M006, and that one case was
driven by discovery latency a glob would not have prevented. The proposed alternative's real cost
(weakened auditability, a second mechanism to reason about, drift between declared and actual
write boundary) is not justified by a ceremony-reduction benefit that the evidence shows is
already small. The exhaustive positive list remains the simplest mechanism that fully satisfies
the requirement — changing it now would be optimizing for a cost that, on this repository's own
history, has not materialized as a real burden.

**Decision:** Reject, as recommended. Exact-file `write_scope` stays unchanged — no
glob/directory-scoped write_scope, no protected-path denylist. The 1/24 (4.2%) amendment rate
across M005+M006 is recorded as the baseline; revisit only if later milestones show materially
higher recurring friction, not on this evidence alone.
