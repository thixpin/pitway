---
schema_version: 1
id: M039
title: Split core/tasks/update.ts by Responsibility
status: in_progress
requirement: null
confirmed_at: 2026-08-28T09:05:01Z
verification_approved_hash: sha256:fd7d5f53c11c70f4260acf9187f55a98e1deee317e9ee2f4cb56dbd05299b9b9
base_branch: main
base_revision: 107c4dabc3a361506d5b9550a6a298ab8b3340d6
acceptance_criteria:
  - id: AC001
    text: src/core/tasks/update.ts keeps only the task-transition orchestration
      (updateTask, completeTask, the in_progress clean-start check, persistTask,
      findTask, resolveActiveMilestone, expectedMilestoneBranch) and is under
      400 lines. Evidence resolution/validation/fingerprinting
      (isExecutionPassing, validateTaskVerifyEvidence,
      resolveTaskVerifyEvidence, hasVerifiedEvidence, buildFingerprint,
      normalizeRepoRelativePath, MISSING_HASH_MARKER) live in
      src/core/tasks/evidence.ts; usage parsing/accumulation/warning
      (parseUsageInput, accumulateUsage, computeUsageWarning) in
      src/core/tasks/usage.ts; result-file parsing and field capping
      (resultSchema, TaskResult, SUMMARY_CAP, EVIDENCE_CAP, capField,
      parseResultInput, readInput) in src/core/tasks/result-input.ts; and the
      completion-commit identity lookup (findCompletionCommit, milestoneSince,
      tasksRepoPath) in src/core/tasks/completion-commit.ts. TaskUpdateError is
      defined once in src/core/tasks/update-error.ts and re-exported from
      update.ts so every existing importer keeps working unchanged.
  - id: AC002
    text: Every function body moves verbatim -- same names, signatures, error
      classes, and error message text. pitway task-update's human and --json
      output, its refusal messages, and every existing integration test's
      asserted output are byte-for-byte unchanged. No Core module imports the
      CLI layer; no new upward or circular import is introduced (update.ts no
      longer imports MISSING_HASH_MARKER from verify.ts).
  - id: AC003
    text: src/core/tasks/verify.ts imports buildFingerprint and MISSING_HASH_MARKER
      from src/core/tasks/evidence.ts instead of carrying its own byte-mirrored
      copy, so a fingerprint recorded by task-verify and one recomputed at
      completion are produced by one function. verify.ts's own
      normalizeRepoRelativePath and assertDirtySubset stay local because they
      throw TaskVerifyError (a different class) -- consolidating them would
      change error identity and is out of scope.
  - id: AC004
    text: Focused unit tests exist for the extracted pure logic without going
      through the CLI -- accumulateUsage (sum, absent-field, null sides),
      parseUsageInput (valid, malformed JSON, schema violation),
      computeUsageWarning (no dispatch, dispatched without --usage, --usage
      supplied), capField/parseResultInput (under cap, over cap with marker,
      malformed YAML, schema violation), buildFingerprint (present/missing,
      sorted order), isExecutionPassing (exit codes, termination reason,
      typecheck failure), validateTaskVerifyEvidence (each staleness branch by
      message), resolveTaskVerifyEvidence (implicit newest-passing search,
      explicit id, unknown id), and findCompletionCommit (match, mismatch
      refusal, no candidate). Existing integration coverage
      (tests/integration/task-update.test.ts, task-verify.test.ts,
      milestone-status.test.ts) passes unmodified except for import paths.
  - id: AC005
    text: Full suite and typecheck pass; no CLI output changes anywhere.
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npx vitest run tests/unit/task-evidence.test.ts
      tests/unit/task-usage.test.ts tests/unit/task-result-input.test.ts
      tests/unit/task-completion-commit.test.ts tests/unit/layering.test.ts
  - id: CT002
    criterion: AC002
    type: command
    command: npx vitest run tests/integration/task-update.test.ts
      tests/integration/task-verify.test.ts
      tests/integration/milestone-status.test.ts
      tests/integration/racing-footer-surfaces.test.ts
  - id: CT003
    criterion: AC003
    type: command
    command: npx vitest run tests/integration/task-verify.test.ts
      tests/integration/task-update.test.ts tests/unit/task-evidence.test.ts
  - id: CT004
    criterion: AC004
    type: command
    command: npx vitest run tests/unit/task-evidence.test.ts
      tests/unit/task-usage.test.ts tests/unit/task-result-input.test.ts
      tests/unit/task-completion-commit.test.ts
  - id: CT005
    criterion: AC005
    type: command
    command: npm run typecheck && npm test
    timeout_ms: 900000
---

# Contract

## Objective

Land B039, the last finding of the post-v1.1.1 architecture review.
`src/core/tasks/update.ts` (708 lines, the most-churned Core file across
the last 60 commits) mixes four responsibilities inside `completeTask`:
task-verify evidence resolution and staleness validation, `--usage`
parsing and accumulation, `--result` parsing and capping, and the
completion-commit identity lookup. Each changes for a different reason
(M030 touched evidence, M017/B019/B033 touched usage, M012 touched the
commit lookup) and each is testable in isolation, but today none has a
unit test -- they are reachable only through the CLI-level integration
suite.

The same review noted that `src/core/tasks/verify.ts` carries a
byte-mirrored copy of `buildFingerprint` ("mirrors verify.ts's
buildFingerprint exactly ... so a freshly recomputed fingerprint is
directly comparable") -- the dangerous kind of duplication, where the two
copies must never drift. Giving the fingerprint one home is the only
consolidation this milestone makes.

This is a file split, not a redesign: every function moves verbatim, and
every observable behavior -- output, refusal text, error class -- stays
byte-identical.

## Scope

- **T001 -- Split update.ts.** Extract the four responsibility modules
  (`evidence.ts`, `usage.ts`, `result-input.ts`, `completion-commit.ts`)
  plus `update-error.ts` for the shared `TaskUpdateError`; `update.ts`
  re-exports `TaskUpdateError` and imports the rest. `MISSING_HASH_MARKER`
  moves to `evidence.ts` (removing update.ts's import from verify.ts);
  `verify.ts` re-exports it during T001 so nothing else changes yet.
  Update the two `hasVerifiedEvidence` importers. Add the four unit test
  files listed in AC004, written RED first against the new module paths.
- **T002 -- One fingerprint.** `verify.ts` drops its local
  `buildFingerprint` and `MISSING_HASH_MARKER` definitions in favor of
  `evidence.ts`'s; `task-verify` output and journal records unchanged.
- **T003 -- Full gate.** `npm run typecheck && npm test`.

T002 depends on T001; T003 on T002.

## Non-Goals

- Changing any behavior of task-update, task-verify, or milestone-status --
  output, refusal messages, error classes, journal record shapes, and
  tasks.yaml writes are all frozen.
- Consolidating `verify.ts`'s `normalizeRepoRelativePath` /
  `assertDirtySubset` with update.ts's: they throw different error classes
  by design, so sharing them would change error identity.
- Touching `src/core/verification/repair.ts`'s own local
  `normalizeRepoRelativePath` convention.
- Any change to the task state machine, dependency resolution, commit
  trailers, or git safety rules.
- Version bump, CHANGELOG, or release preparation.

## Change Log

- 2026-08-28: Draft created from backlog item B039 (post-v1.1.1
  architecture review finding 5).
