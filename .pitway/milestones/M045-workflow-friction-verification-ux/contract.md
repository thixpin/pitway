---
schema_version: 1
id: M045
title: Workflow Friction & Verification UX
status: completed
requirement: null
confirmed_at: 2026-08-29T03:54:04Z
verification_approved_hash: sha256:b6bcc7eb86ae96c80a6c9b27d80bd93947145fd3f3ffb8e1f5c8b068b0de4fc8
base_branch: main
base_revision: e7fd1f846462a2926b33cd20fc8cdbff134b360d
acceptance_criteria:
  - id: AC001
    text: "W1 -- a task may declare verification.timeout_ms (additive optional, same
      1000..3600000 bounds as contract check timeouts). task-verify uses it when
      --timeout is absent; an explicit --timeout still wins; tasks without it
      keep the 120000 ms default. The M044/T006-style gate task (npm run
      typecheck && npm test, ~155-190 s) verifies without a false-fail when it
      declares timeout_ms. Evidence: M041/T004's first task-verify record
      tve-622507de5dcb failed at 119,998 ms on a passing 161 s suite; every gate
      task since needed --timeout by hand."
  - id: AC002
    text: "W2 -- milestone-add, milestone-add --replace, and task-add refuse a task
      whose write_scope, context_files, or relevant_files names a directory (a
      path that exists as a directory in the repository, or ends with '/') with
      a message naming the task, the field, the path, and the rule 'write_scope
      entries must be files; Core matches dirty paths exactly'. Chosen over
      draft-time expansion because expansion would silently widen an approved
      scope to files the author never listed and would drift as files are added;
      refusal keeps the developer's declared list the single source of truth
      (M040 Decision 1's scope semantics). Evidence: M038 draft caught
      pre-confirm; M041/T001 blocked mid-flight and needed a developer-approved
      task-amend."
  - id: AC003
    text: "W3 -- task-update <id> in_progress on a FIRST attempt (attempts 0)
      accepts a tree whose only dirty paths are inside that task's own
      write_scope (or relevant_files), tasks.yaml, verification-results/
      repairs, and pending-journal targets -- reusing classifyDirtyPaths'
      existing taskWriteScope/verifiedCleanStart path rather than adding a new
      rule -- while any path outside those sets still refuses with the existing
      message. The retry path (attempts > 0) is unchanged. Evidence:
      M042/T002-T003 -- driver-session evidence files written into the tasks'
      own write_scope had to be parked and restored to start each task."
  - id: AC004
    text: "W4 -- milestone-confirm's baseline commit absorbs a dirty
      .pitway/backlog.yaml exactly as it absorbs the milestone's own draft state
      files (subset semantics: harmless when clean), so a backlog add recorded
      while no milestone was active no longer forces a chore commit before
      confirmation. The gate itself is unchanged: confirm still runs only on
      explicit developer approval and still refuses every other unexpected dirty
      path. Evidence: chore commits 193f0cf and ab3e525 were needed solely for
      this."
  - id: AC005
    text: "W5 -- task-status <id> --json additively exposes contextFiles,
      writeScope, and relevantFiles (each present only when the task declares
      it, mirroring task-status --context's omission convention), plus
      verification (strategy, detail, timeoutMs when declared); human output is
      unchanged. Evidence: M041/T001's task-amend had to reconstruct write_scope
      from a scratch draft because task-status --json exposed neither field."
  - id: AC006
    text: Every behavior change in AC001-AC005 carries a regression test that fails
      on the pre-M045 code; every human gate (milestone-confirm,
      milestone-complete, milestone-merge, task-amend/--amend,
      verification-repair approve, quick-change commit) is untouched; command
      docs for task-verify, milestone-add, task-add, task-update,
      milestone-confirm, and task-status are updated in common/ and claude/
      lockstep with pinned hashes regenerated; full suite and typecheck pass.
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npx vitest run tests/unit/task-verify.test.ts
      tests/integration/task-verify.test.ts tests/unit/schemas.test.ts
  - id: CT002
    criterion: AC002
    type: command
    command: npx vitest run tests/integration/milestone-add.test.ts
      tests/integration/task-add.test.ts tests/unit/draft-formats.test.ts
  - id: CT003
    criterion: AC003
    type: command
    command: npx vitest run tests/integration/task-update.test.ts
      tests/unit/git-safety.test.ts
  - id: CT004
    criterion: AC004
    type: command
    command: npx vitest run tests/integration/milestone-confirm.test.ts
      tests/integration/backlog.test.ts
  - id: CT005
    criterion: AC005
    type: command
    command: npx vitest run tests/integration/task-status.test.ts
  - id: CT006
    criterion: AC006
    type: command
    command: npm run typecheck && npm test
    timeout_ms: 900000
---

# Contract

## Objective

Remove the five workflow frictions the v1.3.0 architecture/workflow review
ranked highest by pain x frequency (W1-W5), each observed on PitWay's own
milestones this cycle: a false-failing full-suite gate, directory-form
write scopes that pass drafting but block execution, a first-attempt
clean-tree rule that blocks a task from starting on its own in-scope
evidence, a chore commit forced by every milestone-less backlog capture,
and a task-status JSON that hides the fields a task-amend needs. Each fix
is the smallest one consistent with the existing architecture -- reusing
`classifyDirtyPaths`, `computeExpectedBaselinePaths`, and the contract
check timeout schema rather than adding mechanisms -- and none touches a
human gate or the Orchestrator role decisions.

## Scope / tasks

- T001 (W1) task-level `verification.timeout_ms`, honored by `task-verify`.
- T002 (W2) refuse directory-form scope paths at `milestone-add` /
  `--replace` / `task-add`.
- T003 (W3) first-attempt `in_progress` tolerates the task's own
  write-scope dirt via the existing `taskWriteScope` classification.
- T004 (W4) baseline commit absorbs `.pitway/backlog.yaml`.
- T005 (W5) `task-status --json` exposes scope and verification fields.
- T006 Full gate.

T001-T005 are independent (disjoint write scopes); T006 depends on all.

## Dependencies

- v1.3.0 on main (`e7fd1f8`); M040 Decisions 1-4 and M044's protocol
  rules are fixed inputs and are not touched.
- The v1.3.0 architecture/workflow review is the sole source of scope;
  each AC cites its evidence.

## Non-Goals

- W6 usage attribution / usage-schema work (next milestone, re-scoped
  against docs/evidence/M042/synthesis.md section 9).
- A1 journal.ts split, A4 sha256-manifest retirement, and any other
  structural cleanup (the milestone after).
- Any change to which commands require developer approval, or to the
  Orchestrator role, partition, identity, or bucket decisions.
- Draft-time expansion of directories into files (rejected in AC002).
- Weakening any dirty-tree protection beyond the task's own declared scope
  on a first attempt.
- Non-additive CLI output changes, except the new refusal message in AC002.
- Unrelated refactoring; version bump, CHANGELOG, or release work.

## Change Log

- 2026-08-29: Draft created from the v1.3.0 architecture/workflow review
  (W1-W5). Registered as M045 -- the next sequential id after M044
  (Orchestrator Lifecycle & Context Handling, completed and merged
  2026-08-29).
