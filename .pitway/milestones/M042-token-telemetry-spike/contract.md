---
schema_version: 1
id: M042
title: Token Telemetry Spike
status: completed
requirement: null
confirmed_at: 2026-08-28T17:20:34Z
verification_approved_hash: sha256:183249411a1f0b70bc00617f4992d15a62487c73e9a0d82c5fd6dec98d8da46d
base_branch: main
base_revision: 116bbe25f93d25918c72c6a80f40f7ceb4746555
acceptance_criteria:
  - id: AC001
    text: For each supported driver (claude, opencode, codex) a durable evidence
      record under docs/evidence/M042/ states, from real observed runs on THAT
      driver and never from documentation alone, exactly what usage the runtime
      reports to the driving session. For each of five session shapes -- (a)
      inline task in the main session, (b) a dispatched worker, (c) the same
      worker resumed for a second task, (d) a dispatched reviewer, (e) any
      auxiliary session the harness creates -- the record gives the exact
      surface where usage appeared (tool-result field, envelope key, log line,
      status line, or nowhere), the raw sample verbatim and unedited, the fields
      present (input / output / total / cache-read / cache-write / model /
      provider / session-or-run id), and a semantics probe -- two consecutive
      readings of the same session showing whether the figure is cumulative,
      per-turn, or per-segment, or "undeterminable". A shape with no reported
      usage is recorded as "nothing reported"; a UI-only display is
      "unavailable", not a sample.
  - id: AC002
    text: The record maps every observation onto the M009 feasibility record's own
      experiments E0-E6 by name -- E0 the token dimensions, E1 the three-way
      session partition (main / subagent / auxiliary), E2 derived-value
      labeling, E3 per-instance attribution stability, E4 multi-session
      accumulation bounds, E5 OpenTelemetry cost/benefit, E6 re-confirmation of
      the four rejected approaches -- plus whether a Main-vs-Orchestrator split
      is directly measurable when the two roles run as separate sessions. Each
      driver record NAMES the token dimensions it actually observed from the
      reporting shape (M009 deliberately does not name the four); every value is
      labeled measured, PitWay-derived, or unavailable; and the synthesis gives
      each E0-E6 join, per driver, an explicit verdict of validated exactly /
      not validated / not exercisable, stating whether one common set of four
      dimensions exists across drivers. Per M009, anything short of every
      exercisable join validated exactly means the M009 limitation stands.
  - id: AC003
    text: The synthesis states, per M040 Decision 3 bucket (Main, Orchestrator,
      Worker, Auxiliary) and per driver, what the runtime actually reported --
      quoting the sample -- and marks a bucket populatable only where a reported
      figure attaches to that session shape without arithmetic. Any bucket that
      would require subtraction, splitting, or attribution across sessions is
      marked unavailable, never derived. Orchestrator is populatable only where
      a separate session's figure was reported directly. Each M009 conclusion is
      explicitly confirmed or revised with evidence; where confirmed, the record
      says so rather than restating it.
  - id: AC004
    text: No schema, Core, CLI, State, Git, or asset change of any kind; the
      repository diff against main, excluding docs/evidence/M042/ and PitWay's
      own .pitway/ state, is empty. Every experiment runs in a throwaway
      repository or a git worktree initialised with pitway init, never against
      this repository's .pitway/. Full suite passes unchanged.
  - id: AC005
    text: M041's two Orchestrator-session figures
      (docs/evidence/M041/split-role-dogfood.md section 6 -- 72,821 and 94,451
      tokens) are treated as input evidence with undetermined semantics --
      reported readings, not established additive segments. The claude record
      determines their semantics via the semantics probe, and the synthesis
      restates M041 section 6 consistently with that finding. No per-task
      attribution is derived from them, and no figure anywhere in the milestone
      is estimated, summed across sessions, parsed from a transcript, or scraped
      from a TUI.
verification:
  - id: CT001
    criterion: AC001
    type: review
    instruction: Read docs/evidence/M042/claude.md, opencode.md, and codex.md. For
      each, confirm every one of the five session shapes has either a raw
      verbatim sample with its exact surface, fields, and semantics probe, or an
      explicit "nothing reported" / "not exercisable (why)" -- and that the
      record came from a session on that driver, not a substitute.
  - id: CT002
    criterion: AC002
    type: review
    instruction: In docs/evidence/M042/synthesis.md confirm the drivers x E0-E6
      table exists with a validated-exactly / not-validated / not-exercisable
      verdict per cell citing the sample, the observed dimensions are named per
      driver with a cross-driver statement, the Main-vs-Orchestrator
      measurability is stated, and every value carries measured / PitWay-derived
      / unavailable.
  - id: CT003
    criterion: AC003
    type: review
    instruction: Confirm the per-bucket x per-driver table quotes a reported sample
      for every "populatable" cell, marks every arithmetic-dependent cell
      unavailable, and gives an explicit confirm/revise verdict on each M009
      conclusion.
  - id: CT004
    criterion: AC004
    type: command
    command: test -z "$(git diff --stat main -- . ':!docs/evidence/M042'
      ':!.pitway')" && npm test
    timeout_ms: 900000
  - id: CT005
    criterion: AC005
    type: review
    instruction: Confirm the claude record's semantics probe rules on the harness
      figure, the synthesis restates M041 section 6 accordingly (no "+" between
      readings unless the probe proved additivity), and no figure in
      docs/evidence/M042/ is summed, estimated, split per task, or sourced from
      a transcript or TUI.
---

# Contract

> Research milestone; produces evidence only. Prerequisite for the
> usage-schema migration follow-up (provisional draft under
> drafts/orchestrator/). Depends on M040 Decision 3 (buckets) for its
> vocabulary. M041's evidence record supplies input readings whose
> semantics this spike must determine (AC005).

## Objective

Establish, from real runs on each supported driver, what token usage the
runtime actually reports and to whom -- so any later attribution work
builds on measured facts. `docs/evidence/M009/token-accounting-feasibility.md`
is the baseline constraint and defines the spike's structure: seven
experiments E0-E6, each targeting one load-bearing join, and a Usage
Accounting milestone becomes a candidate only if every exercisable join is
validated exactly. This spike confirms or revises M009 with evidence and
never designs around a number the runtime does not report.

## Scope / tasks

- T001 Observe and record claude driver usage reporting across the five
  session shapes, including the semantics probe that rules on the M041
  readings.
- T002 Same for opencode -- executed by a session running on the opencode
  driver.
- T003 Same for codex -- executed by a session running on the codex driver.
- T004 Synthesis: drivers x E0-E6 verdicts, named dimensions, partition,
  per-instance attribution, Decision 3 buckets, derived-value labeling,
  rejected-approach re-confirmation, M041 section 6 restatement, and the
  explicit lists of fields the usage-schema migration may and may not add.

T001, T002, and T003 are independent driver investigations; T004 depends on
all three.

## Dependencies

- M040 completed and merged (Decision 3 bucket vocabulary: Main /
  Orchestrator / Worker / Auxiliary) -- satisfied.
- M041 completed and merged -- its section 6 figures are input evidence
  with undetermined semantics (AC005), not per-task attribution.
- T002 and T003 require sessions on the opencode and codex drivers
  respectively. A Claude session may only record what those driver sessions
  hand back, verbatim; it must not substitute its own observations, mark
  those tasks complete without real driver evidence, or fabricate a sample.
- Independent of the lifecycle and documentation follow-ups.

## Non-Goals

- Implementing any usage capture, schema, display, or telemetry
  integration (OpenTelemetry stays a documented trade-off, E5).
- Estimating, deriving, summing, or splitting any figure the runtime does
  not report as such; transcript parsing, TUI scraping, snapshot
  accumulation, and Agent-SDK inversion remain rejected (M009, E6).
- Promising exact milestone totals or percentage splits.
- Touching this repository's .pitway/ from any experiment, or changing
  anything outside docs/evidence/M042/.
- Any per-task attribution of Orchestrator-session usage.

## Change Log

- 2026-08-28: Follow-up draft created from the M040 architecture review.
- 2026-08-28: Registered as M042 (next sequential id after M041; the draft's provisional M043 label renumbered, title unchanged).
- 2026-08-29: Corrections C1-C8 applied before confirmation, from the review
  against M009, M040, and M041 -- E0-E6 mapping with per-join verdicts
  (C1); dimensions named from observation (C2); per-sample surface, shape,
  fields, and semantics probe (C3); buckets populatable only from a directly
  reported figure (C4); M041 section 6 readings treated as
  undetermined-semantics input, new AC005 (C5); experiments confined to
  throwaway repos, .pitway/ untouched (C6); T002/T003 must run on their own
  driver (C7); evidence-only proven by a diff check in CT004 (C8).
