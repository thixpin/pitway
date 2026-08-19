# M007/AC004 — Small Ripple-Fix Policy: Decision

Compiled 2026-08-19, as part of T004. Evaluates whether a worker may fix a small, directly-related
bug discovered mid-task within the current contract's existing ACs/verification, without a
standalone out-of-band commit or repeated developer approval.

## Evidence: all 7 standalone hotfixes, M005 and M006

| Milestone | Commit | Discovered during | Pattern |
|---|---|---|---|
| M005 | `bc1a0bf` | T003 | `relevant_files` optional broke `completeTask`'s array spread, outside T003's scope |
| M005 | `90bd7ca` | T004 | `verify.test.ts`'s amend-reapproval test used the old hand-edit flow |
| M005 | `69e16ca` | T007 | Amend materialization silently skipped body-only changes |
| M005 | `0b0438b` | T007 | Pending amendments between tasks had no path to ever commit |
| M006 | `81c99a2` | T001 | `completeTask` never read `write_scope`, only `relevant_files` |
| M006 | `1e07014` | T003 | `computeExpectedBaselinePaths` never knew about `init`-managed non-`.pitway/` files |
| M006 | `81a420a` | (live dogfood, post-T006) | `verify.test.ts`'s own recursion-guard tests assumed a clean ambient env var |

Every one of these 7 followed the identical shape: discovered mid-task (or mid-dogfood), diagnosed
by the driver, presented to the developer for explicit approval, RED-then-GREEN verified, landed as
a **standalone commit outside the discovering task's own commit**, no `PitWay-Milestone`/
`PitWay-Task` trailer. None expanded contract or verification scope. Every one required a full
developer approval round-trip before landing — none were ever folded silently into the discovering
task's own commit.

## Cost/benefit of the current standalone-commit pattern

**Benefits:** each hotfix is independently diagnosable, independently revertible, and clearly
flagged (no trailer) as an out-of-scope exception rather than silently absorbed into a task commit
whose trailer claims it only did that task's own declared work. Commit purity is preserved — a
task's own commit diff maps exactly to its own contract AC.

**Cost:** 7 separate commits, 7 separate approval round-trips, across 2 completed milestones (plus
this milestone's own conflict-preflight/AC001 amendments following a similar shape). Real
conversational latency, not a correctness cost — none of the 7 were ever found to be wrong, rushed,
or under-verified because of the standalone-commit ceremony.

## Recommendation

**Adopt, modified** — same shape as AC002's decision. Reject the "without repeated developer
approval" clause: every one of the 7 real cases this evidence draws on was, correctly, developer-
approved before landing, and nothing in this evidence shows that step causing harm or being safe to
skip. **Adopt** the "no standalone out-of-band commit" mechanism instead: when a ripple fix is
small, discovered mid-task, stays within the current contract's existing ACs/verification, and
never expands scope, it may be **folded into the discovering task's own completion commit** (one
commit, the task's own `PitWay-Milestone`/`PitWay-Task` trailers, with the ripple fix explicitly
named and evidenced in the task's `result.evidence` field) rather than landing as a separate
standalone commit — reducing commit-count ceremony without touching the approval gate. This
requires no new Core mechanism: `task-update`'s existing `--result` evidence field already supports
recording exactly this kind of disclosure, and the completion-staging boundary (`write_scope ??
relevant_files`, M006's own `81c99a2` fix) already permits a task's commit to include files outside
its literal write_scope only when explicitly reasoned about — this policy formalizes when that's
appropriate, it doesn't require new enforcement code. Explicit condition, preserved: if the ripple
fix's scope, risk, or verification need would expand beyond the current task's own contract
boundary, it remains a standalone commit and a full developer decision gate, exactly as today —
this policy narrows *where a small in-scope fix lands*, it does not touch when a fix requires
escalation.

**Decision:** Adopt the recommended policy, with one important refinement the developer added:
an approved ripple fix folds into the discovering task's own completion commit **only when it is
directly causal to that task's own work, bounded in scope, and tested** — and its file(s) must
first be added to the task's declared `write_scope` through an **explicitly approved task
amendment (`task-amend`), before any edit is made**, not merely noted in `result.evidence` after
the fact. This is not optional ceremony: without it, `checkWriteScope`/`assertDirtySubset` would
refuse the completion commit anyway, since the ripple-fix file would not be in the task's declared
write_scope — the existing write-boundary enforcement (M006/AC004's `checkWriteScope`, M006's own
`81c99a2` completion-staging fix) already requires this, so the policy must go through it, not
around it. The fix is then recorded explicitly in `result.evidence`. **Independent or broad
defects — anything not directly causal to the current task's own work, or exceeding "small and
bounded" — must become separate corrective work** (a standalone commit, exactly as today, or a new
task/milestone per AC007/AC008), never silently absorbed into an unrelated task's commit.
