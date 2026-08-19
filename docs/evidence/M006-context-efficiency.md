# M006 Context-Efficiency Evidence

Compiled 2026-08-19, after T001–T003. Recorded per M006/AC005: this milestone claims credit
only for what PitWay's own assets and process control measurably affect — the driver dispatch
mechanism, the bundle it hands to a worker, the assets it installs, and the reports it caps. It
claims nothing about what the harness independently injects on top of that (system prompt, tool
definitions, skills, project memory) — that is disclosed as out of PitWay's control, not
estimated or guessed at.

## Model/config caveat (read this before the numbers below)

AC005 requires that a token comparison "names the model/config held constant across the two
measurements it compares." **This document cannot make that claim for the M004/M005-vs-M006
comparison below.** The M004/T005 baseline was measured 2026-08-18, in a different session, and
nothing in the M005 report or this repository's history records which model/harness version
produced it. This M006 measurement (2026-08-19) is from the current session's actual model. The
two may or may not be the same model/config — this is not verifiable from the available record,
so the before/after comparison in this document is presented as directional evidence only, not
as a controlled, model-held-constant experiment. Any future re-measurement should record the
exact model/version alongside the figures specifically so this caveat can eventually be
resolved.

## Controllable and measured

These are factors PitWay's own code and assets directly determine, measured from this
milestone's actual execution (T001–T003), not estimated.

### 1. Installed asset size

`src/integrations/claude/` (installed into a managed repo's `.claude/` by `init`, M006/AC003):
**18 files, 20,304 bytes total.** This is the entire controllable "always present" footprint a
driver's context inherits from PitWay's own installed assets, independent of any specific task.

### 2. Bundle size, and a real duplication finding

Raw `task-status <id> --context --json` bundle sizes, as actually generated during T001–T004's
dispatch this milestone:

| Task | Bundle size (bytes) |
|---|---|
| T001 | 28,413 |
| T002 | 30,456 |
| T003 | 31,438 |
| T004 | 26,832 |

**Finding, confirmed by direct code inspection, not inference:** `src/core/tasks/
context-bundle.ts`'s `buildTaskContextBundle` sets `contractExcerpt.acceptanceCriteria:
contract.acceptance_criteria` — the **entire** contract's AC array, unfiltered. Measured on
T001's actual bundle: `contractExcerpt` alone is 25,169 of the bundle's 28,239 characters —
**89% of the bundle**, carrying all 10 of M006's ACs, when T001 itself maps to exactly one
(AC001). This directly contradicts IMPLEMENTATION_PLAN.md §8's stated design ("relevant contract
excerpt (objective + mapped ACs only)") — the code was never actually built to filter by mapped
AC; it passes the whole array through.

This is a **controllable, fixable** inefficiency, not an inherited one: `buildTaskContextBundle`
should filter `contractExcerpt.acceptanceCriteria` to only the AC ids the task's own
`acceptance_criteria` field maps to (or, since `tasks.yaml`'s `acceptance_criteria` is currently
free-text checklist strings rather than AC-id references, whatever mapping mechanism a future
task establishes). During T001–T003's actual dispatch this milestone, the driver did not pass
the raw bundle verbatim — it manually hand-trimmed `contractExcerpt` down to only the relevant
AC text before dispatching each sub-agent. That manual workaround is itself evidence of the gap:
`dispatch.md` (M006/AC004) says the bundle should be passed **verbatim**, and the driver could
not actually do that without inflating every dispatch by up to 25KB of irrelevant AC text. Not
fixed in this milestone (out of T004's own write_scope) — recorded here as a concrete,
measured, high-value target for a follow-up task.

### 3. Duplicated text (repeated contract text across dispatches)

Directly caused by finding #2: every one of T001–T004's raw bundles repeats the same ~25KB
`contractExcerpt` block, none of it unique to the task receiving it. Across 4 dispatches, that
is roughly 100KB of byte-identical text generated and (before the driver's manual trimming)
would have been sent to 4 separate sub-agents. This is the single largest duplicated-text
source identified this milestone; no other repeated-content pattern of comparable size was
found in the dispatch path.

### 4. Repository-read count

Not machine-measured this milestone (no instrumentation exists yet to count a sub-agent's own
file reads). Qualitatively, from the three sub-agents' own final reports: T001 and T002 each
read only the files named in their `writeScope` plus explicitly-cited read-only reference
material the driver supplied inline in the dispatch prompt (T001: none beyond its own new
files; T002: T001's three new modules, read for exact signatures, as instructed). T003 similarly
read only its declared `writeScope` plus two explicitly-cited existing files (`init.ts`,
`update.ts`) it was told it would be modifying. No sub-agent report indicated exploratory
reading beyond what the dispatch prompt named. This is process-discipline evidence (the fixed
wrapper text worked as intended), not a byte-precise count — recorded as a limitation, not
inflated into a claim this document cannot support.

### 5. Output/report size

M006/AC006 (delivered in T003) caps `task-update --result`'s `summary` at 300 characters and
`evidence` at 1000 characters, with a visible `[truncated] ` marker and tail-preserving
truncation reusing T001's shared `trimTail` helper. This is dogfooded, working, and already
measured on itself: T003's own completion result (a genuinely long structured summary) was
truncated to exactly this cap on write, confirmed by reading the persisted `tasks.yaml` entry
after completion. Before this milestone, `task-update --result` had no cap at all — every prior
milestone's task results (M001–M005) could grow arbitrarily large. This is a real, working,
controllable reduction, not aspirational.

### 6. Full-suite invocation count

Approximate, reconstructed from this session's own record, not machine-logged — stated as
approximate rather than false-precise. Two categories:

- **Expected**: one full-suite (`npm test`) run per task completion, per the established
  verification discipline (independent driver re-run before every `task-update ... completed`).
  For T001–T003 that is a minimum of 3.
- **Actual, inflated by two disclosed incidents**: T002's abandoned-background-process incident
  (§ recorded separately in `.git/pitway/m006-report-notes.md`) required roughly 4 additional
  full-suite runs to diagnose (flakiness isolation: solo file reruns, normal-concurrency reruns,
  one serialized rerun) before completion. T003's baseline-git-safety hotfix (same notes file)
  required roughly 5 additional full-suite runs across its RED/GREEN verification, the
  self-hosting-readiness follow-on fix, and the final bounded-twice confirmation. Total for
  T001–T003: **approximately 12 full-suite runs against an expected minimum of 3** — a 4x
  inflation, entirely attributable to two genuine, disclosed defects this milestone found and
  fixed (M005's `write_scope` completion-staging gap, and the `.claude/`-assets baseline-safety
  gap), not to routine task execution. This is not a criticism of the verification discipline
  itself — both incidents were caught, diagnosed, and fixed correctly because that discipline
  ran every time — but it is real, measured overhead worth recording honestly rather than
  omitting.

## Inherited and not promised (explicitly not claimed)

Per M006/AC004's honesty boundary and AC005's own scope: PitWay does not control, cannot
measure, and does not claim credit for reducing:

- The harness's own system prompt.
- Tool definitions and their schemas.
- Loaded skills.
- Project/session memory.
- Any conversation history a dispatched sub-agent's own harness happens to retain.

None of the token figures in this document include or estimate these. Where the M004/T005
baseline investigation (2026-08-18) checked some of these categories and ruled them out as
contributors to that session's own growth (Remote Control, MCP tool loading, Skills, and Memory
were checked and ruled out then, per M005 report.md §8) — that finding is about a different
session and is not re-verified here.

## Before/after comparison against the M004/M005 baseline

Source: M005 report.md §8, itself sourced from the M004/T005 dispatch investigation
(2026-08-18).

**Baseline (M004/M005):** main-loop dispatch/planning ≈12K tokens; sub-agent startup ≈30K
tokens; worker growth ≈22K→52K tokens over a run; main-loop growth +51.2K tokens per dispatch.
Per-task measured totals across M005's T001–T008 (T009 unmeasured, driver-executed):
85,451 / 61,693 / 98,541 / 217,487 / 127,652 / 65,969 / 175,697 / 61,278 — **sum 893,768 across
8 measured tasks, average ≈111,721/task**, covering 8 of M005's 9 ACs (T009's AC009 was
driver-executed, unmeasured).

**M006 (T001–T003, this measurement):** 88,692 / 177,449 / 185,575 — **sum 451,716 across 3
measured tasks, average ≈150,572/task**, covering 7 of M006's 10 ACs (T001→AC001 partial,
T002→AC001+AC002, T003→AC003/AC004/AC006/AC007/AC008 — five ACs in one dispatch, by explicit
developer design to avoid a separate sub-agent dispatch and commit per single-file guidance
edit).

**Raw per-task comparison: M006 is higher** (≈150.6K/task vs ≈111.7K/task) — stated plainly,
not minimized. **Per-AC-of-contract-delivered comparison: M006 is lower** (451,716 tokens ÷ 7
ACs ≈ 64,531/AC, vs 893,768 ÷ 8 ACs ≈ 111,721/AC) — because M006's task graph deliberately
bundles more ACs per dispatch (T003 alone delivers 5), trading task-level granularity for fewer
total dispatches. Both framings are reported because neither alone is honest: the per-task
number is real and worse; the per-AC number is real and better, and reflects a genuine
milestone-level design decision (this session's own task-graph revision, "fold guidance-only
work into fewer tasks... each split would still need its own sub-agent dispatch and commit"),
not a measurement artifact.

## What this milestone can and cannot claim credit for

**Can claim:** a working, dogfooded result-field cap (finding #5); a precisely measured,
previously-unknown bundle-duplication defect with an exact fix target (finding #2); an honest,
non-inflated accounting of verification overhead including two real incidents (finding #6);
fewer total dispatches per AC delivered, by task-graph design.

**Cannot claim:** a reduction in raw per-task token cost (it went up, for the reasons stated);
a model/config-controlled comparison against the M004/M005 baseline (the caveat above); any
credit for harness-level context this milestone does not touch; a machine-measured
repository-read count (only qualitative sub-agent self-report).

## Carried forward

The bundle-filtering defect (finding #2) is the highest-value concrete follow-up this document
identifies — fixing `buildTaskContextBundle` to filter `contractExcerpt.acceptanceCriteria` to
only a task's mapped AC(s) would remove the largest measured source of duplicated text in the
dispatch path (up to ~25KB per dispatch on this milestone's own contract). Not implemented here
(outside T004's write_scope); recorded in `.git/pitway/m006-report-notes.md` for the M006
report and as a candidate item for M007 or a later milestone.
