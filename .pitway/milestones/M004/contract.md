---
schema_version: 1
id: M004
title: Verification, completion, and usage accounting
status: in_progress
requirement: null
confirmed_at: 2026-08-18T14:39:30Z
verification_approved_hash: sha256:12411c2658d555bc7acec526240f7252c26a0e3fa2a3c58f5ad56a885af147e5
acceptance_criteria:
  - id: AC001
    text: pitway verify recomputes the verification hash first; a mismatch with the
      recorded approval refuses with a precise diagnostic — nothing executed,
      nothing recorded; verify works again after a milestone-confirm --amend
      re-approval.
  - id: AC002
    text: Bare pitway verify runs only approved command-type checks, in contract
      order, recording pass/fail with trimmed-output evidence and recorded_by
      command; a failing check is recorded and reported, never hidden; no
      command absent from the approved contract is ever executed.
  - id: AC003
    text: pitway verify --check CTnnn --pass|--fail --evidence <text> records
      manual/review checks as recorded_by developer; refuses unknown check ids
      and refuses developer-recording of a command-type check.
  - id: AC004
    text: Verification results are append-only with timestamps; the latest result
      per check is authoritative; re-running verify appends fresh results
      without erasing history.
  - id: AC005
    text: pitway milestone-complete refuses unless the milestone is in_progress,
      every non-cancelled task is completed, and the latest result for every
      check is pass — diagnostics name exactly what is missing.
  - id: AC006
    text: "On success milestone-complete transitions in_progress -> review ->
      completed as one persisted write, clears active_milestone to null in
      state.yaml, then creates a completion commit (\"workflow: complete
      milestone <id>\", milestone-only trailer) staging exactly the milestone's
      own four files plus state.yaml (subset check, exact matches); verify's
      written results are committed at this boundary."
  - id: AC007
    text: "Completion re-entry is resumable with operation-specific identity (a
      completion-subject candidate whose committed contract.md shows status
      completed): idempotent success / resume pending commit / precise ambiguity
      refusal; hook-failure, retry, and post-commit interruption are tested."
  - id: AC008
    text: "pitway usage-add <milestone> --category planning|qa --usage <json>
      accumulates honestly into usage.yaml (attempts incremented once per
      recording, token fields summed); rejects malformed or negative input;
      absent data stays null and is never estimated. Each recording preserves a
      clean working tree by creating an ancillary milestone-only commit
      (\"workflow: record usage for <id>\", PitWay-Milestone trailer only)
      staging exactly the milestone's usage.yaml, with resumable safety via
      commitOrResume (identity: usage-subject candidate whose committed
      usage.yaml parses equal to the currently persisted values); unrelated
      dirty paths refuse the entire operation."
  - id: AC009
    text: milestone-status displays aggregated totals equal to the sum of measured
      task usage plus planning plus qa, never double-counting, surfacing
      unmeasured tasks explicitly (e.g. "84.2k (2 tasks N/A)"); measured and
      unavailable values are never blended.
  - id: AC010
    text: Task completion auto-promotes dependent tasks whose dependencies are now
      all completed (waiting -> ready via the existing resolver) within the same
      persisted write and commit; resume then reports them ready. When any task
      is in_progress, resume reports that task as the continuation target and
      recommends no ready task; ready-task selection (lowest id) applies only
      when no task is in_progress. The self-hosting readiness scenario's
      assertion is updated to these guarantees.
  - id: AC011
    text: Requirement-artifact I/O moves into the state store; the milestone
      creation core retains zero direct filesystem access; existing
      milestone-add behavior is unchanged and the full suite stays green.
  - id: AC012
    text: "Newly created milestones use directory MNNN-<slug>: the slug is derived
      once from the contract title (lowercase; runs of non-alphanumerics
      collapse to single hyphens; trimmed of leading and trailing hyphens;
      truncated at a word boundary to at most 40 characters; empty result falls
      back to the bare id), never regenerated or renamed; the bare MNNN id
      remains the sole canonical identifier in CLI arguments, state.yaml,
      contract frontmatter, depends_on, and git trailers."
  - id: AC013
    text: "Directory resolution by canonical id lives only in the state store and
      succeeds only when exactly one candidate exists: a bare MNNN directory
      (grandfathering M001-M004) or a single MNNN-* directory. Zero candidates,
      multiple slugged candidates, or a bare and a slugged directory coexisting
      all refuse with a precise diagnostic naming the candidates — no candidate
      is ever silently preferred."
  - id: AC014
    text: "Self-hosting evidence, pre-completion scope: M004 was created, confirmed,
      executed, and verified through pitway commands — its baseline commit and
      every task commit in this repository carry PitWay-written trailers with no
      direct edits to authoritative .pitway/ state. The completion commit itself
      is audited after completion (it cannot gate the completion that creates
      it); that post-completion audit is recorded as follow-up evidence, not as
      a completion precondition."
  - id: AC015
    text: Every command — existing (milestone-status, milestone-list, task-status,
      resume, init, milestone-add, milestone-confirm, task-update) and new
      (verify, milestone-complete, usage-add) — is registered in the CLI program
      built by buildCli's main entry path, so each is reachable through the
      single pitway entry point; only npm packaging and distribution remain
      deferred.
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npm test -- tests/integration/verify.test.ts
  - id: CT002
    criterion: AC002
    type: command
    command: npm test -- tests/integration/verify.test.ts
  - id: CT003
    criterion: AC003
    type: command
    command: npm test -- tests/integration/verify.test.ts
  - id: CT004
    criterion: AC004
    type: command
    command: npm test -- tests/integration/verify.test.ts
  - id: CT005
    criterion: AC005
    type: command
    command: npm test -- tests/integration/milestone-complete.test.ts
  - id: CT006
    criterion: AC006
    type: command
    command: npm test -- tests/integration/milestone-complete.test.ts
  - id: CT007
    criterion: AC007
    type: command
    command: npm test -- tests/integration/milestone-complete.test.ts
  - id: CT008
    criterion: AC008
    type: command
    command: npm test -- tests/integration/usage-add.test.ts
  - id: CT009
    criterion: AC009
    type: command
    command: npm test -- tests/integration/milestone-status.test.ts
  - id: CT010
    criterion: AC010
    type: command
    command: npm test -- tests/integration/task-update.test.ts
      tests/integration/resume.test.ts
      tests/integration/self-hosting-readiness.test.ts
  - id: CT011
    criterion: AC011
    type: command
    command: npm test -- tests/unit/state-store.test.ts
      tests/integration/milestone-add.test.ts
  - id: CT012
    criterion: AC012
    type: command
    command: npm test -- tests/integration/milestone-add.test.ts
  - id: CT013
    criterion: AC013
    type: command
    command: npm test -- tests/unit/state-store.test.ts
  - id: CT014
    criterion: AC014
    type: review
    instruction: "Before completion, review this repository's git history to confirm
      M004's baseline commit (\"workflow: add milestone M004\", PitWay-Milestone
      trailer only) and every task commit (both trailers) were produced by
      pitway commands, and that no commit in the milestone's range hand-edits
      authoritative .pitway/ state outside those commands. The completion commit
      is audited separately after completion and recorded as follow-up
      evidence."
  - id: CT015
    criterion: AC015
    type: command
    command: npm test -- tests/integration/cli.test.ts
---

# Contract — M004: Verification, completion, and usage accounting

## Objective

Implement verification execution (verify), milestone-level completion
(milestone-complete), and usage accounting (usage-add plus aggregation in
milestone-status), together with dependent-task auto-promotion, the
requirement-store refactor closing the recorded core-fs debt, and stable
slugged-directory support for milestones created after this one. M004 is
the self-hosting transition: it is created and confirmed through pitway
commands, and completing it through the milestone-complete command it
implements demonstrates full lifecycle self-hosting.

## Scope

- pitway verify: hash-gated execution of approved command checks;
  developer recording for manual/review checks; append-only results.
- pitway milestone-complete: validated in_progress -> review -> completed
  with a resumable completion commit, symmetric with confirm.
- pitway usage-add (clean-tree preserving via an exact-path ancillary
  commit) and honest aggregation display in milestone-status.
- milestone-complete clears active_milestone and includes state.yaml in
  its exact completion commit set.
- Dependent auto-promotion at task completion.
- Requirement I/O moved into the state store.
- Slugged milestone directories for newly created milestones — M004 stays
  the grandfathered bare directory; slugged paths begin with M005.
- All commands reachable through the single CLI entry point (buildCli main
  path); only packaging is deferred.

## Non-Goals

- Claude integration assets, README, npm packaging/distribution (later
  milestones per the corrected sequence: M005 is dependency-aware Claude
  integration including /milestone-draft; M006 is the six-point Dogfood
  Validation; release/docs follow, with the Adaptive Workflow Intensity
  decision point after M006).
- No automatic merges, no parallel execution, no new state values or
  transitions, no plugin framework.

## Design Decisions

- Auto-promotion replaces the explicit task-update ready step: it is
  deterministic, occurs in the same write/commit as the completion, and
  removes a pure-ceremony command invocation with no safety value.
- Slug rule applies to all newly created milestones with bare-id
  directories grandfathered — no repository-specific threshold constant in
  generic tool code.
- Verification results are append-only with the latest result per check
  authoritative, preserving honest failure history.

## References

- IMPLEMENTATION_PLAN.md §11 (verification strategy), §12 (token
  accounting), §7 (CLI commands).
- M003 completion report findings: explicit-promotion gap, requirement
  store fs debt, deferred slug design.

## Change Log

- 2026-08-18 — Amended AC010/CT010/T004: resume prioritizes an in_progress
  task as the continuation target; ready-task selection applies only when
  none is in progress. Developer-requested during T003 review.
