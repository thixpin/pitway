# M007/AC010 — Right-Sized Dispatch Mode: Decision

Compiled 2026-08-19, as part of T009. Evaluates inline driver execution vs. sub-agent dispatch
using M006's retrospective split, AC001's fresh matched pair, and this milestone's own execution
pattern so far.

## Evidence

**M006 (retrospective):** T004 (context-efficiency evidence, docs-only, 1-file write_scope) ran
inline, explicitly reasoned as such before work began. T001, T002, T003, T005 (real Core/CLI code,
multi-file write_scope, `verification.strategy: tdd`) were all sub-agent-dispatched, each
independently re-verified by the driver after.

**M007/T001 (fresh, real, measured):** a genuinely matched pair — a single-file read-and-summarize
task, one dispatched to a sub-agent (31,890 tokens, 1 tool use, 6,901ms), one done inline (zero
dispatch overhead, cost unmeasurable in isolation). For a task this small, the sub-agent's cost was
almost entirely fixed dispatch overhead, not task-complexity-driven.

**M007's own execution so far (fresh, this session):** every task from T001 through T008 — 8 of 8
— was ultimately executed inline by the driver, including one (`T001`) that was originally
sub-agent-dispatched and had to be corrected mid-flight (a fixed-worker-rule contradiction), and
one (`T007`) with `verification.strategy: tdd` and real test code, not just documentation. All 8
completed correctly, verified, with no scope violations. This is the strongest evidence available:
not a retrospective pattern, but this milestone's actual, lived execution choice, made task-by-task
without a formalized rule, converging on inline by default.

## The rule

`verification.strategy: manual` combined with a small write_scope (a qualitative "few files, no
multi-subsystem code change" judgment, not a hard count) favors **inline** execution.
`verification.strategy: tdd` combined with a multi-file, cross-subsystem write_scope (e.g. M007's
own T010, touching `schemas.ts` and `context-bundle.ts` across two layers, with new schema fields)
favors **sub-agent dispatch** — real code changes benefiting from an independent, isolated
implementation pass the driver then re-verifies, not written and self-reviewed by the same agent
in the same turn. `verification.strategy: tdd` alone does not force dispatch, as T007 (real test
code, but a single, well-understood, already-modeled pattern) shows — the deciding factor is
whether the work benefits from independent-agent isolation, not merely whether it produces test
code. **A contract-mandated sub-agent dispatch, if a future contract ever explicitly declares one
(e.g. for independent-review integrity), is never silently overridden by this rule** — the rule
only fills in when the contract itself is silent on dispatch mode.

## Recommendation

**Adopt**, formalized into `protocol-driver.md` and `dispatch.md` as guidance for the driver to
state its dispatch-mode choice and reason before starting each task — not a hard gate, since the
driver ultimately exercises judgment, but a documented default that matches what this milestone's
own real execution already converged on without a formal rule. This is a real behavior change to
shipped, installed protocol assets, not merely internal documentation — flagged as a mandatory
developer-gate decision, not decided autonomously, precisely because it changes what future
driver sessions are instructed to do.

**Decision:** Adopt, with developer refinements to the rule as formalized (superseding the
driver's own initial "manual+small-scope vs. tdd+multi-file" framing above): inline is the default
for documentation, review/manual work, localized fixes, and small-scope tasks; `tdd` strategy
alone is never a reason to dispatch; dispatch to a sub-agent only when it provides a material
isolation or concurrency benefit — an independently bounded multi-file implementation,
cross-subsystem work, disjoint parallel-ready scope, or a context-heavy investigation — weighed
against the ~32K-token observed startup overhead so dispatch is never chosen when that overhead is
disproportionate to the task; contract-mandated dispatch is never overridden; and the driver
chooses autonomously, recording the selected mode and a brief rationale, without asking per task
unless the choice is materially ambiguous. Formalized in `src/integrations/claude/
protocol-driver.md` and `src/integrations/claude/dispatch.md` within this same task.
