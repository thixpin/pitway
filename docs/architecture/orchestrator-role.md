# Architecture Decision Record — The Orchestrator Role

**Milestone:** M040 (Orchestrator Role Architecture)
**Status:** Decided — each decision below was presented to the developer in
conversation and explicitly approved on 2026-08-28 before being recorded.
**Source requirement:** `drafts/pitway-orchestrated-worker-requirement.md`
(reframed by M040/T001); usage attribution split into
`drafts/pitway-usage-attribution-requirement.md`.

## Context

The original requirement asked for a "dedicated Orchestrator Agent" to sit
between the human-facing Main Agent and the workers. PitWay's binding
constraints (AGENTS.md) exclude that reading: PitWay is "not a multi-agent
framework … or orchestration service"; drivers ship as **text assets
only**; Core never imports AI-provider code. The only architecture
consistent with those constraints is:

> **The Orchestrator is a driver-protocol role, not a PitWay runtime
> component.** It is a set of rules a driver session follows, shipped as a
> common text asset (`src/integrations/common/protocol-orchestrator.md`)
> beside `protocol-driver.md` (Main Agent rules) and `protocol-worker.md`
> (worker rules), installed through the existing two-tier resolver with no
> change to Core.

Today `protocol-driver.md` fuses two roles into one session: it talks to
the developer *and* dispatches workers. This record splits that role on
paper and decides the four questions the split raises. It implements
nothing beyond shipping the protocol document (M040/T003).

The three roles:

| Role | Rules | Talks to | Runs `pitway`? |
|---|---|---|---|
| Main Agent | `protocol-driver.md` | the developer | gate and scope commands (Decision 1) |
| Orchestrator | `protocol-orchestrator.md` | the Main Agent | execution commands (Decision 1) |
| Worker | `protocol-worker.md` | the Orchestrator (report only) | never |

One session may play Main Agent and Orchestrator together (today's default,
still fully supported) or two sessions may play one each. Every role reads
and mutates workflow state **only through `pitway` commands, never
`.pitway/` directly** — the one rule everything else follows.

---

## Decision 1 — CLI responsibility partition

**Decided (approved 2026-08-28, with `verification-repair approve` moved
to the Main Agent):**

Principle: a command that is a **developer gate, a scope change, or
creates/abandons planned work** belongs to the Main Agent; a command that
**executes within already-confirmed scope** belongs to the Orchestrator;
**read-only** commands are either role's; **workers run nothing**.

| Command | Owning role | Class (see gate table) |
|---|---|---|
| `init` | Main Agent | — |
| `milestone-add` / `ms-add` | Main Agent | scope |
| `milestone-confirm` / `ms-confirm` (incl. `--amend`) | Main Agent | **gate** |
| `milestone-complete` / `ms-complete` | Main Agent | **gate** |
| `milestone-merge` / `ms-merge` | Main Agent | **gate** |
| `milestone-cancel` / `ms-cancel` | Main Agent | scope |
| `task-add` | Main Agent | scope |
| `task-amend` | Main Agent | scope |
| `quick-change create` / `approve` / `run` / `commit` / `cancel` / `promote` | Main Agent | `commit` is a **gate**; the rest scope. A quick-change exists only when no milestone is active, so no Orchestrator is in play. |
| `milestone-review decide` / `ms-review decide` | Main Agent | **gate** |
| `verification-repair approve` | Main Agent | **gate** (approve-before-edit) |
| `auto-run enable` / `disable` | Main Agent | authorization |
| `write-ms-artifacts` | Main Agent | drafting |
| `task-update` | Orchestrator | execution |
| `task-verify` | Orchestrator | execution |
| `task-dispatch` / `task-integrate` / `task-discard` | Orchestrator | execution (parallel mode) |
| `verify` (runs, `--check … --pass/--fail` records) | Orchestrator | execution; a recorded `review`/`manual` result carries the developer's verdict relayed by the Main Agent |
| `verification-repair propose` / `commit` / `cancel` | Orchestrator | execution |
| `usage-add` | Orchestrator | execution |
| `backlog add` / `promote` / `archive` | Orchestrator | execution (capture, never scope growth) |
| `milestone-review start` / `brief` / `record` / `report` | Orchestrator | execution |
| `resume`, `milestone-status`, `milestone-current`, `milestone-list`, `task-status`, `backlog list` / `show`, `quick-change status`, `auto-run status`, `verify --status`, `help` | either | read-only |
| *(everything)* | Worker | **never** |

Rationale: this keeps every B021 human gate and every scope-changing
mutation with the session that talks to the developer, and gives the
Orchestrator exactly the surface the existing dispatch sequence
(`dispatch.md` steps 1–8) already uses.

Rejected alternative — *mutating vs read-only*, i.e. the Orchestrator runs
every mutation: `task-amend`, `task-add`, and `milestone-review decide`
would then sit with the Orchestrator and hollow out the approval boundary.

Rejected alternative — *`verification-repair` entirely with the
Orchestrator* (as first proposed): its `approve` step records a developer
approval, which is a gate by definition; moved.

---

## Decision 2 — Orchestrator identity

**Decided (approved 2026-08-28): persistent per milestone, flushed at the
milestone's terminal state, never carried into the next milestone.**

One Orchestrator session (or resumable identity) runs a milestone from its
first `ready` task to `completed`/`cancelled`. After that its working
context is disposable. A restarted Orchestrator — crash, harness limit, or
deliberate reset — re-orients from `pitway resume` alone.

Rationale:
- Avoids re-briefing the Orchestrator per task — the same cost
  `dispatch.md`'s "Sequential subagent dispatch" exists to cut (~32K tokens
  per fresh start, M007/T001).
- Safe by construction: PitWay never depends on the Orchestrator's context.
  Every recovery input is in `.pitway/` + the journal (fresh-session and
  interrupted-dispatch recovery are dogfooded — `docs/evidence/M016-*`).
- Matches the requirement's §4 verbatim.

**Context-isolation trade-off, restated for the Orchestrator** (from
`dispatch.md`'s chained-worker disclosure): ambient context retention
across tasks *is the mechanism*, not a side effect. PitWay cannot verify or
bound what the Orchestrator carries between tasks in its reasoning; only
`write_scope` (writes) and the state machines (transitions) bound its
actions.

**Recovery invariant:** a restart at any point must yield the same next
action from `pitway resume`. If the lifecycle follow-up's durable-state
audit finds a fact that lives only in Orchestrator context, that is a gap
to make durable (additively), never a reason to persist the context.

Rejected — *fresh per task*: maximal isolation, but pays full startup cost
on every task and offers nothing PitWay can verify that the persistent
mode does not (both rely on `resume`).
Rejected — *persistent across milestones*: violates §4 and would make
context, not state, the de facto continuity mechanism.

---

## Decision 3 — Usage buckets: Main / Orchestrator / Worker / Auxiliary

**Decided (approved 2026-08-28).** Buckets are defined by **which session
produced the usage**, never by inference. Binding constraint:
`docs/evidence/M009/token-accounting-feasibility.md`.

| Bucket | Definition | Measurable today (M009) |
|---|---|---|
| Main Agent | The session playing the Main Agent role. Today's `usage.yaml` planning/qa lives here. | Only what the runtime reports for that session. |
| Orchestrator | The session playing the Orchestrator role. When one session plays both roles, this bucket is **empty, not estimated**. | Orchestration overhead is *PitWay-derived and conditional* unless the roles run as separate sessions and the runtime reports per session. |
| Worker | A direct dispatch — task workers and dispatched reviewers. Today's `task.usage` (`--usage`) and review-role usage live here. | Per dispatch tool result where reported; **per-instance attribution not claimable** without stable traces. |
| Auxiliary | Any runtime session that is none of the above (background/tooling/harness sessions). | Whatever is reported; **never folded into another bucket**. |

Rules:
- A figure lands in a bucket only when measured for that session;
  unmeasured stays `null` → `N/A` with a missing count. No bucket is derived
  by subtraction from another.
- Reporting is per-bucket measured segments + missing count. **No exact
  milestone total, no percentage split.**
- Bucket membership is recorded on the usage record (Decision 4); it is not
  a session-identifier dependency — `resume` and commit trailers never read
  it.

Rejected — three buckets (the original draft): undercounts by construction
(M009's three-way partition). Rejected — per-task buckets only: loses the
Main/Orchestrator distinction the requirement exists to make.

---

## Decision 4 — Usage-schema migration requirements

**Decided (approved 2026-08-28). Requirements for a later milestone; M040
changes no schema.**

1. **Additive and optional only.** New fields on `taskUsageSchema`,
   `usageSchema` (planning/qa) and review-role usage: `bucket`
   (`Main | Orchestrator | Worker | Auxiliary`); and, only where the Token
   Telemetry Spike shows them *measured* for a driver, `model` and
   `driver`. `schema_version` stays `1`; every existing `tasks.yaml`,
   `usage.yaml`, `reviews.yaml` parses unchanged.
2. **Existing usage keeps its meaning; mapping by execution mode, never
   inference.** `task.usage` → Worker when the task was dispatched (journal
   dispatch evidence), otherwise Main (inline); planning/qa → Main;
   review-role usage → Worker. No historical value is rewritten.
3. **Null stays null.** No estimation; a PitWay-derived figure, if ever
   shown, is labeled `derived` in human and `--json` output and never
   summed into a measured total.
4. **Raw provider usage preserved verbatim** where reported (an opaque
   `raw` object beside the normalized fields); absent stays absent.
5. **Identifiers are evidence-only** — the M029 `--driver`/`--model`
   precedent: on the PitWay record, never in commit trailers, never read by
   `resume` or any recovery path.
6. **Display convention unchanged.** `milestone-status` may add per-bucket
   lines, each as measured segments + missing count; existing output
   byte-identical when no bucketed usage exists.
7. **Sequencing.** No field is added until the spike's synthesis names it
   measured for at least one driver; fields marked unavailable are not
   added "for later".

Rejected — `schema_version: 2` with a migration step: unnecessary for
purely additive optional fields and forces a one-way upgrade. Rejected —
storing derived figures in the same field as measured ones: unauditable.

---

## Gate classification

Two classes, and the distinction is load-bearing:

- **Protocol-enforced** — instruction-pinned in the installed protocol
  docs; a violation is *detected in review or audit*, never prevented at
  runtime (B021's honest limit). PitWay can prove the wording ships, not
  that a session obeys it.
- **Runtime-enforced** — Core code refuses the operation.

| Gate / guarantee | Class | Where enforced |
|---|---|---|
| Developer approval before `milestone-confirm` | protocol | B021 (`protocol-driver.md` "Decision authority and gates") |
| Developer approval before `milestone-confirm --amend` | protocol | same |
| Developer approval before `milestone-complete` | protocol | same |
| `milestone-complete` refuses unless every task is completed and every check passed | **runtime** | `src/core/milestones/complete.ts` (`MilestoneCompleteError`, all-checks/all-tasks gate) |
| Developer approval before `milestone-merge` | protocol | `protocol-driver.md`, `milestone-complete` output |
| `milestone-merge` refuses on non-completed milestone, dirty tree, or wrong target | **runtime** | `src/core/milestones/merge.ts` (`MilestoneMergeError`) |
| Developer approval before `quick-change commit` | protocol | B021 |
| `quick-change commit` refuses without RED→GREEN run history (unless `--tdd-exempt`) | **runtime** | `src/core/quick-change/commit.ts` (B020) |
| Developer approval before `verification-repair approve` | protocol | `verification-repair.md` |
| Scope change only via `task-amend` / `task-add` / `--amend` with approval | protocol | `protocol-driver.md` "Scope changes" |
| `task-amend` limited to amendable fields | **runtime** | `src/core/tasks/amend.ts` (`AMENDABLE_FIELDS`) |
| Task and milestone state transitions | **runtime** | `src/core/tasks/state-machine.ts`, `src/core/milestones/state-machine.ts` |
| `write_scope` at completion (unrelated dirt refused) | **runtime** | `src/core/tasks/update.ts` `assertDirtySubset`; `checkWriteScope` in `write-scope-check.ts` |
| Clean tree at task start | **runtime** | `src/core/tasks/update.ts` (in_progress branch) via `classifyDirtyPaths` |
| Commit lands on the milestone branch | **runtime** | `src/git/branch.ts` `assertOnMilestoneBranch` |
| Verification commands approved by hash | **runtime** | `src/core/verification/run.ts` (`verification_approved_hash` check) |
| Parallel dispatch eligibility | **runtime** | `src/core/tasks/dispatch.ts` via `checkParallelEligibility` |
| Dispatched task's only exits are integrate/discard | **runtime** | `src/core/tasks/update.ts` live-dispatch refusal; `integrate.ts` / `discard.ts` |
| Auto-run authorization & invalidation | **runtime** | `src/core/journal/auto-run.ts` `isAutoRunAuthorized` |
| **Main Agent vs Orchestrator command partition (Decision 1)** | **protocol** | `protocol-orchestrator.md` / `protocol-driver.md`; no Core role check exists |
| Orchestrator surfaces human decisions instead of deciding | protocol | `protocol-orchestrator.md` |
| Worker never calls `pitway` or touches `.pitway/` | protocol | `protocol-worker.md` |
| Worker `write_scope` | **runtime** (writes only) | completion refusal above; reads are advisory (`context_files`) |

Nothing in this table claims runtime enforcement that Core does not
perform. Runtime role checks (refusing a gate command from a session that
declares itself Orchestrator) are deliberately **not** introduced here —
see the follow-up plan.

---

## Preserved architecture (unchanged by this decision)

| Property | Mechanism | Pointer |
|---|---|---|
| Worker context isolation | The provably-minimal task bundle; capped structured reports | `src/core/tasks/context-bundle.ts`; `report-format.md`; `pitway task-status <id> --context` |
| Durable state and resume/recovery | `.pitway/` files + append-only journal; `pitway resume` as the authoritative recovery view | `src/state/journal.ts`, `src/core/views/resume.ts`; evidence `docs/evidence/M016-*` |
| Parallel-worktree execution | dispatch/integrate/discard lifecycle, pairwise eligibility, residue reporting | `src/core/tasks/dispatch.ts`, `integrate.ts`, `discard.ts`, `parallel-eligibility.ts` |
| Driver-independent assets | Two-tier resolver: `common/` canonical, `<driver>/` whole-file overrides | `src/state/driver-assets.ts` |
| Measured-only usage | `usage: null` → `N/A`; never estimated | `src/core/tasks/usage.ts`, `src/core/metrics/aggregate.ts` |

**Isolation limit, restated:** PitWay bounds only the *supplied bundle*. It
does not bound a worker's — or an Orchestrator's — total harness context
(system prompt, tools, skills, inherited conversation), and never
represents either as isolated beyond the bundle itself (`dispatch.md`,
"What bounded means").

---

## Follow-up plan (after M040 completes; none implemented here)

Drafted under `drafts/orchestrator/` (provisional ids, not registered):

| Follow-up | Prerequisite | What it does |
|---|---|---|
| **Orchestrator Protocol Adoption & Split-Role Dogfood** (M041) | M040; Decision 2 fixes the identity mode exercised | Role annotations on every command doc; a partition-consistency test derived from this record; one real milestone run with Main and Orchestrator as separate sessions, evidence recorded — the first test of whether protocol-enforcement of the boundary is sufficient |
| **Orchestrator Lifecycle & Context Handling** (M042) | M040 Decision 2; M041 evidence as input | Durable-state audit for flush; restart-from-`resume`-alone test; finalize flush/restart rules; close any audit gap additively and only via approved amendment |
| **Token Telemetry Spike** (M043) | M040 Decision 3 vocabulary | Per driver, from real runs: what the runtime reports and to whom, mapped onto M009's dimensions and these buckets; confirms or revises M009; evidence only |
| **Usage-Schema Migration for Role Buckets** (M044) | **M043** (hard), Decisions 3–4 | The additive fields of Decision 4, only those the spike marked measured; measured + missing display; never totals or percentages |
| **Driver Documentation Alignment** (M045) | M040; M041 optional | README/USAGE role sections, root-instruction block update with migration test, role cross-references in supporting protocol docs |
| *Runtime role checks* (optional, unnumbered) | M041 evidence showing protocol enforcement insufficient | Would move the Decision 1 boundary from protocol- to runtime-enforced; not planned unless the evidence demands it |

Sequence: M040 → (M041 ‖ M043 ‖ M045) → M042 → M044.
