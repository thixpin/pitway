---
schema_version: 1
id: M024
title: Global Branch Coverage Hardening
status: in_progress
requirement: null
confirmed_at: 2026-08-22T05:55:49Z
verification_approved_hash: sha256:0d3fcdbc2a2a13d482eeba9a2e8fed6a278400473e65570d6efc92680c3fc583
base_branch: main
base_revision: 5410b92f4c78aefc270a5152d49cc8f54418c2c3
acceptance_criteria:
  - id: AC001
    text: "Metric definition, per M020's own precedent: branch coverage from a real
      `npm run test:coverage` run's coverage/lcov.info BRDA records (the
      Codecov-aligned metric), plus line coverage from LF/LH. Baseline recorded
      2026-08-22 post-qc-90a293e4: OVERALL lines 3070/3218 (95.4%), branches
      1728/2002 (86.3%); 51 files below 90% on lines or branches. Verified
      manually at the gate task -- a full-suite coverage run is too
      slow/contention-prone for a command check (M019/T002, M020/AC001
      precedent)."
  - id: AC002
    text: "Milestone/review/reporting surfaces reach >=90% branch AND line coverage
      per file: src/cli/commands/milestone-{add,cancel,complete,
      confirm,list,merge,status}.ts, verify.ts, usage-add.ts,
      write-ms-artifacts.ts, resume.ts, src/cli/review-prompt.ts,
      src/core/milestones/{cancel,create,merge}.ts,
      src/core/verification/status.ts. Real behavioral tests only (the dominant
      gap class is human-render permutations and CommandDeps default fallbacks,
      exactly M020's pattern)."
  - id: AC003
    text: "Workflow-support surfaces reach >=90% branch AND line coverage per file:
      src/cli/commands/auto-run.ts, backlog.ts, quick-change.ts,
      src/core/backlog/{archive,promote,state-machine}.ts."
  - id: AC004
    text: "Task-lifecycle surfaces reach >=90% branch AND line coverage per file:
      src/cli/commands/task-{add,amend,discard,dispatch,status, update}.ts,
      src/core/tasks/{add,amend,context-bundle,critical-path,
      dependencies,discard,dispatch,integrate,update,verify,
      write-scope-check}.ts, src/git/apply.ts."
  - id: AC005
    text: "Verification/journal/git/state surfaces reach >=90% branch AND line
      coverage per file: src/core/verification/{failure-summary, repair,run}.ts,
      src/core/contracts/verification-hash.ts, src/core/journal/operations.ts,
      src/core/reviews/roles.ts, src/git/{exec,worktree}.ts,
      src/state/{contract-file,store}.ts."
  - id: AC006
    text: "src/cli/index.ts is the one disclosed exception, restating M020/AC006's
      own settled decision: its uncovered branches sit inside the real-binary
      error boundary that V8 coverage structurally cannot measure
      (real-subprocess execution, isMainModule gate) -- already behaviorally
      covered by build-bin.test.ts's real-subprocess tests including the
      printStack=true case. Excluded from the >=90% requirement by name, never
      silently; no production refactor."
  - id: AC007
    text: "The gate: a real full `npm run test:coverage` run at milestone end shows
      OVERALL branch coverage >=90% and OVERALL line coverage >=90%, and every
      src file at >=90% branches and lines except src/cli/index.ts (AC006). Full
      before/after per-file numbers recorded in docs/evidence/M024/coverage.md."
  - id: AC008
    text: "Test-quality discipline, verbatim from M020: never superficial
      line-padding, never a coverage-config change to hide an uncovered branch,
      never an unrelated refactor. Every newly covered branch corresponds to a
      real behavioral case. If a specific branch proves genuinely unreachable
      in-process, it is disclosed by name with reasoning in the owning task's
      completion evidence (and AC007's per-file bar treats a named disclosure as
      passing for that file), never silently left or config-excluded."
  - id: AC009
    text: The full test suite and tsc --noEmit stay green throughout; no production
      behavior changes (test-only milestone, src diffs limited to test-support
      if strictly needed and disclosed).
verification:
  - id: CT001
    criterion: AC002
    type: command
    command: npx vitest run tests/integration/milestone-add.test.ts
      tests/integration/milestone-cancel.test.ts
      tests/integration/milestone-complete.test.ts
      tests/integration/milestone-confirm.test.ts
      tests/integration/milestone-list.test.ts
      tests/integration/milestone-merge.test.ts
      tests/integration/milestone-status.test.ts
      tests/integration/verify.test.ts tests/integration/usage-add.test.ts
      tests/integration/write-ms-artifacts.test.ts
      tests/integration/resume.test.ts
      tests/integration/milestone-review-interactive.test.ts
      tests/unit/verification-status.test.ts
  - id: CT002
    criterion: AC003
    type: command
    command: npx vitest run tests/integration/auto-run.test.ts
      tests/unit/auto-run-authorization.test.ts
      tests/integration/backlog.test.ts tests/unit/backlog-state.test.ts
      tests/integration/quick-change.test.ts
      tests/integration/quick-change-lifecycle.test.ts
      tests/integration/quick-change-commit.test.ts
  - id: CT003
    criterion: AC004
    type: command
    command: npx vitest run tests/integration/task-add.test.ts
      tests/integration/task-amend.test.ts
      tests/integration/task-discard.test.ts
      tests/integration/task-dispatch.test.ts
      tests/integration/task-status.test.ts
      tests/integration/task-update.test.ts
      tests/integration/task-verify.test.ts tests/unit/task-verify.test.ts
      tests/integration/task-integrate.test.ts
      tests/integration/task-integrate-recovery.test.ts
      tests/unit/critical-path.test.ts tests/unit/dependencies.test.ts
      tests/unit/write-scope-check.test.ts
      tests/unit/parallel-eligibility.test.ts
  - id: CT004
    criterion: AC005
    type: command
    command: npx vitest run tests/unit/failure-summary.test.ts
      tests/integration/verification-repair.test.ts
      tests/integration/verification-process-exec.test.ts
      tests/integration/verification-recursion-guard.test.ts
      tests/unit/verification-hash.test.ts tests/unit/journal.test.ts
      tests/unit/review-roles.test.ts tests/integration/git-worktree.test.ts
      tests/integration/git-safety.test.ts tests/unit/state-store.test.ts
      tests/unit/contract-file.test.ts
  - id: CT005
    criterion: AC007
    type: manual
    instruction: Run a real full npm run test:coverage; confirm overall branches and
      lines >=90% and every file >=90% except src/cli/index.ts (AC006) or an
      AC008-disclosed named branch; record full before/after numbers in
      docs/evidence/M024/coverage.md.
  - id: CT006
    criterion: AC006
    type: manual
    instruction: Confirm src/cli/index.ts had no production change and the exception
      is restated (not expanded) in the evidence doc.
  - id: CT007
    criterion: AC009
    type: command
    command: npm run build && npm test && npx tsc --noEmit
---

# M024: Global Branch Coverage Hardening

## Background

Developer directive during v0.2.0 release preparation: all test coverage
must be over 90%. A real full-suite coverage run (2026-08-22, after
qc-90a293e4) shows lines at 95.4% but branches at 86.3% overall, with 51
files below 90% -- overwhelmingly the same gap class M020 closed for its
5 target files: human-render permutations, CommandDeps default fallbacks,
and error/refusal paths that only ever ran under --json in tests. M020's
approach (real behavioral branch tests, per-file targets, honest metric
definition, disclosed structural exceptions) scales to the full tree here.

## Design Decisions

- **Same metric discipline as M020**: branch coverage per file from real
  lcov BRDA data; the coverage threshold itself is a manual gate check
  (full coverage runs are slow and contention-prone as command checks).
- **cli/index.ts stays a disclosed exception** (AC006) -- M020/AC006
  settled this: V8 cannot instrument the real-subprocess error boundary;
  behavioral coverage exists via build-bin's real-subprocess tests.
- **Four parallel-eligible test-writing tasks** clustered by TEST-FILE
  ownership (not src layer), so write scopes stay pairwise disjoint; one
  final gate task runs the authoritative full coverage measurement.
- **Release sequencing**: v0.2.0's local tag will be re-cut after this
  milestone lands, so the released version carries the hardened suite.

## Change Log

- 2026-08-22: Initial draft.
