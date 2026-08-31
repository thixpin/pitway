---
schema_version: 1
id: M048
title: Structured Failure Evidence
status: in_progress
requirement: null
confirmed_at: 2026-08-31T04:30:14Z
verification_approved_hash: sha256:1e5baa49b608a0c277bde5aa2174de10e491436be72dd7a42dfe9592907ea374
base_branch: main
base_revision: 0b26ac867788c26776f5442c8eaed121bdece026
acceptance_criteria:
  - id: AC001
    text: "The two behaviorally equivalent private buildEvidence copies -- run.ts's
      takes an emptyFallback argument threaded into both trimTail calls,
      tasks/verify.ts's relies on trimTail's default '(no output)' -- and
      parseTestCounts move into one shared Core module
      (src/core/verification/failure-evidence.ts) as buildEvidence(combined,
      failed, emptyFallback?) (undefined -> trimTail's own default) and
      parseTestCounts; EVIDENCE_BUDGET (200) moves with them. run.ts and
      src/core/tasks/verify.ts consume the shared module. Every recorded
      evidence string is byte-identical before and after the move at both call
      sites, regression-tested by unit fixtures AND by the existing integration
      suites that pin call-site evidence (tests/integration/verify.test.ts,
      task-verify.test.ts, verification-repair.test.ts). The two M017 comments
      are updated in the same task: tasks/verify.ts's 'independent call sites
      with no shared evidence-building module' rationale is reversed to name the
      shared module; run.ts's 'matches trimTail's own default cap' note now
      points at the shared EVIDENCE_BUDGET."
  - id: AC002
    text: "A pure extractFailureDetail(combined) in the shared module returns {
      failures?, passCount?, failCount? } for a failed command's combined
      output. `failures` is built from two independently filled buckets over the
      trimmed non-empty lines, in original order: a NAME bucket (lines matching
      summarizeFailure's exported VITEST_FAILURE_LINE, i.e. `FAIL ` or the
      U+00D7 `×` / U+2717 `✗` markers -- never ASCII x) capped at 12 entries,
      and an ERROR bucket (lines matching an extractor-only /^\\w*Error:/
      matcher, so AssertionError:, Error:, TypeError:, ReferenceError:,
      RangeError: all qualify) capped at 3 entries. Name dedupe: a marker line
      is normalized by stripping its leading marker and a trailing duration
      token (/\\s+\\d+(\\.\\d+)?ms$/); it is dropped when any `FAIL ` line's
      text ends with that normalized name (the FAIL form wins); marker lines
      survive only when no FAIL line names them (a run that dies before vitest's
      Failed Tests section). When neither bucket matches any line, the same
      GENERIC_FAILURE_LINE fallback summarizeFailure uses fills a single bucket
      capped at 12. Every entry is trimmed and capped at 200 chars; `failures` =
      surviving name entries then error entries, each in original order. Counts
      come from parseTestCounts. Nothing matched -> the field is absent, never
      an empty list, never fabricated. summarizeFailure and its regexes are
      exported but never changed. Guarantee: given a replayed CT006/B042-shaped
      vitest output (7 failing tests, × lines + FAIL blocks + AssertionError
      lines), the structured record retains all 7 failing test names exactly
      once each and at least the first AssertionError line."
  - id: AC003
    text: Recording is additive. verification-results.yaml command-recorded FAILED
      entries may carry `fail_count`, `pass_count` (int >= 0) and `failures`
      (non-empty array of non-empty strings) -- snake_case beside
      duration_ms/termination_reason. VerifyCheckOutcome and VerifyCheckRunView
      (run.ts) gain the same three optional snake_case fields so `verify --json`
      mirrors the persisted entry; they are populated only on a FAILED command
      check, on both the full-run and --check rerun paths. The
      task_verify_evidence journal record may carry `failures` (camelCase file
      convention; passCount/failCount already exist), populated only on a failed
      attempt. Developer-recorded manual/review entries and passing entries
      never carry the new fields; every existing verification-results, journal,
      tasks, and usage file parses unchanged; schema_version stays 1.
  - id: AC004
    text: "CLI rendering is additive: under a failed command check in `verify` (full
      run and --check rerun) and under a failed `task-verify` attempt, indented
      lines show a count line listing only the counts present (`failed:
      <fail_count> (passed: <pass_count>)`, or just the one that exists -- never
      a fabricated 0) and one `- <entry>` line per `failures` entry; --json
      carries the new fields when present. For passing runs, for entries
      recorded without the fields, and for all historical data, human and --json
      output are byte-identical to today."
  - id: AC005
    text: verify.md and task-verify.md (common + claude tiers, lockstep bodies;
      neither command has an alias file -- verified) document the structured
      failure fields, the extractor-only Error matcher, and when the fields are
      absent.
  - id: AC006
    text: "Compatibility and gate: the 200-char `evidence` string itself is
      byte-identical everywhere (the structured fields live beside it, never
      inside it); summarizeFailure's matchers are unchanged; no human gate
      changes; typecheck and the full suite pass."
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npx vitest run tests/unit/failure-evidence.test.ts
      tests/unit/failure-summary.test.ts tests/integration/verify.test.ts
      tests/integration/task-verify.test.ts
      tests/integration/verification-repair.test.ts
  - id: CT002
    criterion: AC002
    type: command
    command: npx vitest run tests/unit/failure-evidence.test.ts
      tests/unit/failure-summary.test.ts
  - id: CT003
    criterion: AC003
    type: command
    command: npx vitest run tests/unit/schemas.test.ts tests/unit/task-verify.test.ts
  - id: CT004
    criterion: AC004
    type: command
    command: npx vitest run tests/integration/verify.test.ts
      tests/integration/task-verify.test.ts
  - id: CT005
    criterion: AC005
    type: command
    command: npx vitest run tests/unit/claude-assets.test.ts
      tests/unit/codex-assets.test.ts tests/unit/opencode-assets.test.ts
  - id: CT006
    criterion: AC006
    type: command
    command: npm run typecheck && npm test
    timeout_ms: 900000
---

# Contract

## Objective

Preserve what actually failed. Today a failed check's only durable record
is one 200-character, tail-capped evidence string; M017's summarizeFailure
squeezes a summary into 40% of that. The B042 investigation (2026-08-31)
paid the full price of this design: the CT006 failure evidence hid 6 of 7
failing tests and the assertion text behind the cap, and recovering the
root cause required transcript archaeology plus a live load reproduction.
This milestone records the failing test names, the first error/assertion
lines, and the pass/fail counts as structured, additive fields BESIDE the
existing evidence string -- in both the milestone verification results and
the task-verify journal evidence -- so the next flake investigation starts
from the names and the assertion, not from a truncated tail. This is the
M007 structured-failure-evidence candidate (flagged 2026-08-19), delivered
against the concrete B042 loss.

## Scope / tasks

- T001 Shared failure-evidence module: unify the two buildEvidence copies
  behind an optional emptyFallback parameter + move parseTestCounts
  (AC001), byte-identical regression tests at unit and call-site level.
- T002 Structured extraction with the CT006-replay guarantee (AC002):
  pinned bucket/dedupe rules, extractor-only Error matcher, TDD with a
  replayed 7-failure fixture that forces dedupe.
- T003 Record the structured fields in verification-results (and the
  run.ts views that feed `verify --json`) and in the task_verify_evidence
  journal record (AC003), TDD.
- T004 Render in verify/task-verify CLI output + docs (AC004, AC005).
- T005 Full gate (AC006, declares verification.timeout_ms).

T001 first; T002 depends on T001; T003 on T002; T004 on T003; T005 on all.

## Dependencies

- M017's failure-summary matchers and evidence budget are the fixed
  starting point; its per-call-site duplication comment is deliberately
  reversed here (that was scope-boundedness, not architecture). Its
  regexes are exported for reuse, never edited.
- B042 (closed 2026-08-31, qc-e976789a) is the motivating evidence; its
  CT006 failure shape is the replay fixture's model.
- M046's journal-schemas split and M045's task-level timeout_ms are merged.

## Non-Goals

- Persisting full raw command output (a gitignored/.git-side sidecar keyed
  by evidence id is a separate follow-up candidate -- not designed here).
- Raising or restructuring the 200-char `evidence` string or its budget;
  it stays byte-identical.
- Changing summarizeFailure's own matchers or output: the wider Error
  matcher is extractor-only and never feeds the evidence string.
- Runner-specific parsers beyond the existing vitest patterns + generic
  fallback chain; no new per-framework knowledge.
- Rewriting, reclassifying, or backfilling any historical evidence.
- A schema_version bump; version bump, CHANGELOG, or release work.

## Change Log

- 2026-08-31: Drafted from the M007 structured-failure-evidence candidate
  after B042 demonstrated the concrete cost of the evidence cap.
- 2026-08-31: Redrafted (milestone-add --replace) after developer-role
  review rev-00c6765ec678 (revision_requested): AC001 corrected -- the two
  buildEvidence copies differ by an emptyFallback parameter, not
  byte-identical; the shared function takes it optionally. AC002 pins the
  T002 bucket rules (U+00D7 marker, dedupe key, FAIL-wins, generic-fallback
  cap) and adopts an extractor-only /^\w*Error:/ matcher so TypeError /
  ReferenceError / RangeError failures keep their error text. AC003 widens
  run.ts's views so T004 renders only (closes the T003/T004 write_scope
  seam). CT001/T001 and CT002/T002 gain the call-site integration suites
  and failure-summary.test.ts respectively.
