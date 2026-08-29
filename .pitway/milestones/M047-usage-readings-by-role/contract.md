---
schema_version: 1
id: M047
title: Usage Readings by Role
status: completed
requirement: null
confirmed_at: 2026-08-29T16:51:47Z
verification_approved_hash: sha256:9f87d3a6ec1473e85c78902b57f733708279523a23202fd61c9ee5decc796bc7
base_branch: main
base_revision: e65c7b0a8a79dc95f8ddb4de5b8f80b01c78539d
acceptance_criteria:
  - id: AC001
    text: "usage.yaml gains an additive-optional, append-only `readings` list. Each
      reading carries exactly what the M042 synthesis (section 9) allows:
      `bucket` (main | orchestrator | worker | auxiliary), `count` (one opaque
      non-negative integer, stored as a READING, never accumulated into any
      total), `semantics` (per-turn | undetermined), `recorded_at`, and
      optionally `dimensions` {input, output, reasoning, cache_read,
      cache_write}, `model`, `provider`, `instance_id` (evidence-only), and
      `raw` (the provider envelope verbatim, string or object). schema_version
      stays 1; every existing usage.yaml, tasks.yaml, and reviews.yaml parses
      unchanged; task.usage, planning/qa, and review-role usage keep their
      meaning and their existing accumulate-across-retries rule."
  - id: AC002
    text: "`pitway usage-add <milestone> --reading <json>` appends one reading
      through the same journal-backed usage_recording path the existing
      --category flag uses (Orchestrator-owned under M040 Decision 1); the two
      flags are mutually exclusive; the reading is validated against AC001's
      schema and refused with a clear message when bucket, count, or semantics
      is missing, when count is not a non-negative integer, or when any key
      outside the schema is supplied. No figure is ever derived, summed, or
      split by this command. Existing --category behavior is byte-identical."
  - id: AC003
    text: "M040 Decision 4's mapping of EXISTING usage onto buckets is computed,
      never stored: task.usage maps to worker when the task has a
      worktree_integrate journal record and to main otherwise; usage.yaml
      planning/qa map to main; review-role usage maps to worker.
      milestone-status's token breakdown gains additive per-bucket lines, each
      in the existing measured-segments-plus-missing convention, plus `readings:
      <n> (measured readings, not summed)` per bucket that has any; the lines
      are absent, and --json byte-identical, when no reading exists and no usage
      is present. No line ever shows an exact milestone total or a percentage,
      and no PitWay-derived figure appears anywhere."
  - id: AC004
    text: "Command and protocol docs are updated: usage-add.md (common + claude)
      documents --reading and the section 9 must-not list; milestone-status.md
      and its ms-status alias (common + claude, byte-identical) document the
      per-bucket lines; dispatch.md's usage-propagation MUST gains one sentence
      directing an Orchestrator session's own runtime readings to `usage-add
      --reading` (never to a task's --usage, which stays per dispatched worker).
      No existing rule reworded."
  - id: AC005
    text: "Constraint compliance is tested, not asserted: unit tests reject a
      reading with a total/percentage field, reject an unknown bucket or
      semantics, accept every optional field null/absent, and prove two readings
      are stored as two entries with no sum anywhere in usage.yaml or in
      milestone-status --json; integration tests cover usage-add --reading, the
      byte-identity of milestone-status when nothing is recorded, and the
      Decision 4 mapping for a dispatched vs inline task."
  - id: AC006
    text: Full suite and typecheck pass; no change to any human gate or to M040
      Decisions 1-4; M009's limitation statement stands unchanged.
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npx vitest run tests/unit/schemas.test.ts tests/unit/task-usage.test.ts
  - id: CT002
    criterion: AC002
    type: command
    command: npx vitest run tests/integration/usage-add.test.ts
  - id: CT003
    criterion: AC003
    type: command
    command: npx vitest run tests/unit/views-milestone-status.test.ts
      tests/integration/milestone-status.test.ts
  - id: CT004
    criterion: AC004
    type: command
    command: npx vitest run tests/unit/claude-assets.test.ts
      tests/unit/codex-assets.test.ts tests/unit/opencode-assets.test.ts
  - id: CT005
    criterion: AC005
    type: command
    command: npx vitest run tests/unit/schemas.test.ts
      tests/integration/usage-add.test.ts
      tests/integration/milestone-status.test.ts
  - id: CT006
    criterion: AC006
    type: command
    command: npm run typecheck && npm test
    timeout_ms: 900000
---

# Contract

## Objective

Give measured usage a durable, honest home by role -- and nothing more
than the M042 Token Telemetry Spike showed is measurable. Today an
Orchestrator session's runtime readings (M041 section 6: five readings of
an undetermined-semantics figure) have no PitWay field at all, and every
inline task shows `N/A`. This milestone adds a per-reading record keyed by
M040 Decision 3's buckets, a command to append one, and per-bucket display
in `milestone-status` -- all additive, all measured-only, with M009's
limitation intact: readings are stored as readings and never summed, no
milestone total or percentage is ever computed, and nothing is populated
by inference or from Codex's command-output counter.

## Scope / tasks

- T001 Schema: additive `readings` list on usage.yaml (AC001), unit tests.
- T002 `usage-add --reading <json>` (AC002), integration tests.
- T003 Decision 4 mapping + per-bucket lines in milestone-status (AC003),
  unit + integration tests including --json byte-identity.
- T004 Docs: usage-add.md, milestone-status.md + ms-status alias,
  dispatch.md (AC004).
- T005 Full gate (declares verification.timeout_ms).

T001 first; T002 and T003 depend on T001 and are independent of each
other; T004 depends on T002 and T003; T005 on all.

## Dependencies

- M040 Decisions 3-4 (bucket vocabulary, migration requirements) and the
  M042 synthesis section 9 (may-add / must-not-add lists) are the fixed
  inputs; docs/evidence/M009/token-accounting-feasibility.md is the
  binding constraint.
- M045 (file-level scopes, task-level timeout_ms) and M046 (no manifest
  hashes) are merged.

## Non-Goals (the section 9 must-not list, verbatim in spirit)

- Any session, milestone, or bucket total; any percentage or
  Main/Orchestrator ratio; any PitWay-derived figure (overhead, inline
  cost) displayed or stored.
- Populating a Main Agent figure on Claude or Codex, or an Auxiliary
  figure anywhere, by inference -- readings are only ever what the runtime
  reported for that session.
- Any field populated from Codex's `original_token_count`.
- Any per-task split of a multi-task reading; changing task.usage's
  existing accumulate-across-retries rule; changing --usage on task-update.
- Automatic capture: this milestone adds the record and the command; the
  driver protocol decides when a session records a reading (dispatch.md's
  one added sentence), never Core.
- A schema_version bump; rewriting or reclassifying any historical usage.
- Version bump, CHANGELOG, or release work.

## Change Log

- 2026-08-28: Follow-up draft created from the M040 architecture review
  (provisional label M044).
- 2026-08-29: Re-scoped against docs/evidence/M042/synthesis.md section 9
  after the Token Telemetry Spike and registered as M047 -- the next
  sequential id after M046.
