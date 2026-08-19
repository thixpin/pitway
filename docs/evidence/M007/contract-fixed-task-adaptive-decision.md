# M007/AC002 — Contract-Fixed, Task-Adaptive Execution Model: Decision

Compiled 2026-08-19, as part of T002. Evaluates M005 report §11.1's proposed rule against real
evidence from M005's own execution and this milestone's own fresh experience.

## The proposed rule (M005 report §11.1, verbatim)

> The contract (objective, ACs, verification, scope, non-goals, protected paths, approved hash)
> remains fixed without developer re-approval. Tasks may be added, split, merged, cancelled,
> reordered, refined, or have write scope adjusted automatically only when the change maps
> directly to an existing contract AC, remains inside milestone scope, does not weaken
> verification, adds no unapproved command/protected-path access/new public behavior, and is
> journaled with its reason and exact diff. Anything crossing those conditions remains a developer
> decision gate.

## Evidence

**M005/T001** — the driver's own dispatch prompt incorrectly authorized a sub-agent to write
`src/state/schemas.ts`, outside T001's declared `relevant_files`. Caught by `assertDirtySubset`
before commit, not by any task-definition-flexibility mechanism. This is a **dispatch-validation**
gap, not a task-definition-rigidity gap — and it was already independently fixed: M006/AC004's
`checkWriteScope` (mechanical write-scope validation before dispatch) is exactly M005 report
§11.2's proposed fix for this incident class, already shipped.

**M005/T003, T004** — small ripple fixes (a broken call site, a stale test) discovered mid-task,
landed as standalone out-of-band commits (`bc1a0bf`, `90bd7ca`) because no in-scope path existed
to fix them without a separate commit. This is **ripple-fix-policy** territory (M007/AC004, a
separate decision), not evidence that task *definitions* themselves needed to flex.

**M005/T007** — the actual clean case for this AC: a full read-only census revealed the true
blast radius of slugged directories only after implementation began, requiring two scope
widenings (11 files, then 21 total) via `task-amend` (M005/AC005, then brand new). Both were
individually developer-approved in conversation before running. `task-amend`'s own design
("running the command is the approval") already means every such adjustment requires explicit
developer sign-off — it does not, and did not, run automatically.

**M007/T001 (this milestone, fresh)** — two contract-level amendments were needed mid-task this
session (AC013/CT015's conflict-preflight requirement, AC001's interruption-outcome wording) —
both mapped to a real, live-discovered gap, stayed in scope, didn't weaken verification, and were
journaled with reason and diff. Both were presented for explicit approval (diff + recomputed hash
shown) before `milestone-confirm --amend` or `task-amend` ever ran. This is the exact shape of
adjustment M005 report §11.1 anticipated — and the existing mechanism (present the diff and hash,
wait for explicit approval, then run) handled it correctly, at the cost of real conversational
back-and-forth latency, not a missing capability.

## Recommendation

**Adopt** — but not the literal "automatically... without developer re-approval" clause. The
evidence does not support removing the approval gate: every real M005 and M007 case this evidence
draws on was, in fact, developer-approved before landing, and CLAUDE.md's own standing rule
("Human gate: milestone-confirm runs only after explicit developer approval") applies with equal
force to task-amend by design, not by accident. What the evidence *does* support: the filtering
criteria themselves (maps to an existing AC, stays in scope, doesn't weaken verification, journaled
with reason and diff) are a good, usable test for **which tool** the driver should reach for when
live execution reality diverges from what was drafted — `task-amend`/`milestone-confirm --amend`
for a narrowly-scoped adjustment meeting all four criteria, versus stopping for a full contract
re-draft when any one of them is violated. This requires **no new Core mechanism** — `task-amend`
(M005/AC005) and `milestone-confirm --amend` already exist and already worked correctly for every
real case examined here, both in M005 and fresh this milestone. The adoption is a **documented
practice**, not a code change: the driver should propose a narrowly-scoped amendment (via the
existing commands) rather than treating every drafting gap as a full contract redo, while every
single invocation still requires explicit developer approval in conversation before it runs — no
exception, no automatic path.

**Decision:** Adopt (documented practice only, per the driver's recommendation). Use the
filtering criteria (maps to an existing AC, stays in scope, does not weaken verification, journaled
with reason and diff) as documented guidance for choosing `task-amend` versus a full contract
amendment when live execution reality diverges from what was drafted. Every amendment — of either
kind — still requires explicit developer approval in conversation before it runs; no automatic-
approval Core mechanism is added, and none of `task-amend`'s or `milestone-confirm --amend`'s
existing approval-gated behavior changes.
