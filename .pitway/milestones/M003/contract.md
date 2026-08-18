---
schema_version: 1
id: M003
title: Mutation commands and self-hosting readiness
status: in_progress
requirement: null
confirmed_at: 2026-08-18T13:48:48Z
verification_approved_hash: sha256:ad12275ad2158ce0d4d504c7dc740d42af4fe20cd04c90ee5241d3702dffbeaf
acceptance_criteria:
  - id: AC001
    text: >-
      pitway init outside a git work tree refuses with a clear error and
      creates nothing.
  - id: AC002
    text: >-
      pitway init in a clean repo creates exactly .pitway/config.yaml and
      .pitway/state.yaml (schema v1, empty milestone index, null active
      milestone) and nothing else.
  - id: AC003
    text: >-
      Re-running init when both files exist and validate is a safe no-op;
      nothing is overwritten.
  - id: AC004
    text: >-
      Partially initialized or invalid state (either file missing or failing
      validation while the other exists) refuses with a precise diagnostic;
      never overwrites, never treated as success.
  - id: AC005
    text: >-
      milestone-add fully validates inputs before any write (contract/tasks
      schemas, CT-to-AC criterion references, task dependency references,
      cycles); any failure leaves .pitway/ unchanged.
  - id: AC006
    text: >-
      On success milestone-add assigns the next sequential milestone id (and
      next requirement id when --requirement is given, writing
      .pitway/requirements/RNNN.md and linking contract frontmatter
      requirement: RNNN); writes the four milestone files forced to
      draft/planned; registers the id in state.yaml last; sets
      active_milestone.
  - id: AC007
    text: >-
      milestone-add refuses while active_milestone references a milestone
      whose status is not completed or cancelled (sequential MVP enforced by
      the tool).
  - id: AC008
    text: >-
      Interrupted-add detection: if the computed next id's directory already
      exists unregistered, milestone-add refuses with a diagnostic naming it;
      no automatic reconciliation.
  - id: AC009
    text: >-
      milestone-confirm on a non-draft milestone (outside the AC012 resume
      path) refuses; any dirty path outside the exact expected baseline set
      refuses listing the offending paths; nothing staged or written.
  - id: AC010
    text: >-
      On success milestone-confirm computes and records
      verification_approved_hash and confirmed_at, transitions
      draft->confirmed->in_progress as one persisted write, promotes ready
      tasks via the existing dependency resolver, and creates the baseline
      commit staging exactly the expected path set (config.yaml, state.yaml,
      the milestone's four files, plus .pitway/requirements/RNNN.md iff the
      contract references RNNN) — subset check with exact file matches only;
      a stray file even inside the milestone directory refuses.
  - id: AC011
    text: >-
      milestone-confirm --amend requires an identifiable existing baseline
      commit and a Change Log entry; refuses while draft or while a confirm
      is mid-resume; recomputes the hash only (no status transition);
      commits exactly contract.md with subject "workflow: amend milestone
      <id>" and milestone-only trailer.
  - id: AC012
    text: >-
      Confirm/amend re-entry is deterministic with operation-specific
      identity. Baseline identity: a commit with the milestone trailer, the
      "workflow: add milestone <id>" subject, and no task trailer (a
      milestone has exactly one baseline operation). Amendment identity: an
      amend-subject candidate whose committed contract.md frontmatter
      verification_approved_hash equals the currently recomputed hash —
      later amendments change the hash so each operation matches only its
      own commit. Found -> idempotent success; not found -> revalidate the
      exact expected paths and resume the pending git step; candidate found
      while local status says not-yet-advanced, or unexpected dirty paths on
      re-entry -> stop with a precise diagnostic. Never reset, stash,
      checkout, clean, or rewrite history.
  - id: AC013
    text: >-
      task-update validates every transition through the existing pure task
      state machine; illegal transitions refuse with the existing error
      naming allowed targets; nothing written.
  - id: AC014
    text: >-
      task-update to in_progress requires the tree clean except the
      milestone's own tasks.yaml, and increments the task's attempts counter
      ((attempts ?? 0) + 1) at this boundary — the defined execution-start
      point, deterministic across retries.
  - id: AC015
    text: >-
      task-update to completed requires --result and --message and requires
      dirty paths to be a subset of the task's relevant_files plus
      tasks.yaml; any violation refuses the entire operation — nothing
      staged, committed, or written.
  - id: AC016
    text: >-
      On success the completion stages exactly that set, commits with the
      metadata-stripped composed message plus PitWay-Milestone and
      PitWay-Task trailers, records the result, and accumulates --usage
      honestly onto prior measured usage; absent runtime data stays null and
      is never estimated.
  - id: AC017
    text: >-
      task-update to failed, blocked, review, or cancelled writes tasks.yaml
      only and never commits.
  - id: AC018
    text: >-
      Completion re-entry mirrors AC012 with task-specific identity:
      candidates matched by PitWay-Milestone plus PitWay-Task trailers;
      identity holds iff, in the committed tasks.yaml at that SHA, the
      target task's record alone shows completed with a result equal to the
      currently persisted result — sibling task changes are ignored (parsed
      comparison, not byte equality). Idempotent success / resume pending
      commit (--message must be resupplied; persisted --result/--usage
      ignored if resupplied) / precise refusal on ambiguity.
  - id: AC019
    text: >-
      Schema (approved option b, task-side only): taskSchema gains an
      optional independent attempts field (integer >= 0) and its usage field
      moves to a new taskUsageSchema (nullable; input/output/total tokens,
      no attempts); the shared usageSchema used by usageFileSchema
      planning/qa is unchanged so M004 milestone-level usage semantics are
      untouched; schema_version stays 1; existing task records without
      attempts remain valid unedited.
  - id: AC020
    text: >-
      The four command modules contain only parsing, orchestration, and
      formatting — zero direct fs or child_process calls; all state access
      via store.ts, all git operations via the git module.
  - id: AC021
    text: >-
      Self-hosting readiness scenario passes end-to-end in a real temp repo:
      init -> milestone-add (including a --requirement variant) ->
      milestone-confirm (baseline commit, correct trailer, exact file set)
      -> first task ready->in_progress->review->completed via task-update
      (commit with both trailers) -> pitway resume reconstructs the state
      correctly -> injected unrelated dirt at each of the three git
      boundaries refuses cleanly. This proves readiness only; self-hosting
      begins when the real M004 is created and confirmed through these
      commands in this repository.
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npm test -- tests/integration/init.test.ts
  - id: CT002
    criterion: AC002
    type: command
    command: npm test -- tests/integration/init.test.ts
  - id: CT003
    criterion: AC003
    type: command
    command: npm test -- tests/integration/init.test.ts
  - id: CT004
    criterion: AC004
    type: command
    command: npm test -- tests/integration/init.test.ts
  - id: CT005
    criterion: AC005
    type: command
    command: npm test -- tests/integration/milestone-add.test.ts
  - id: CT006
    criterion: AC006
    type: command
    command: npm test -- tests/integration/milestone-add.test.ts
  - id: CT007
    criterion: AC007
    type: command
    command: npm test -- tests/integration/milestone-add.test.ts
  - id: CT008
    criterion: AC008
    type: command
    command: npm test -- tests/integration/milestone-add.test.ts
  - id: CT009
    criterion: AC009
    type: command
    command: npm test -- tests/integration/milestone-confirm.test.ts
  - id: CT010
    criterion: AC010
    type: command
    command: npm test -- tests/integration/milestone-confirm.test.ts
  - id: CT011
    criterion: AC011
    type: command
    command: npm test -- tests/integration/milestone-confirm.test.ts
  - id: CT012
    criterion: AC012
    type: command
    command: npm test -- tests/integration/milestone-confirm.test.ts
  - id: CT013
    criterion: AC013
    type: command
    command: npm test -- tests/integration/task-update.test.ts
  - id: CT014
    criterion: AC014
    type: command
    command: npm test -- tests/integration/task-update.test.ts
  - id: CT015
    criterion: AC015
    type: command
    command: npm test -- tests/integration/task-update.test.ts
  - id: CT016
    criterion: AC016
    type: command
    command: npm test -- tests/integration/task-update.test.ts
  - id: CT017
    criterion: AC017
    type: command
    command: npm test -- tests/integration/task-update.test.ts
  - id: CT018
    criterion: AC018
    type: command
    command: npm test -- tests/integration/task-update.test.ts
  - id: CT019
    criterion: AC019
    type: command
    command: npm test -- tests/unit/schemas.test.ts
  - id: CT020
    criterion: AC020
    type: review
    instruction: >-
      Review src/cli/commands/{init,milestone-add,milestone-confirm,
      task-update}.ts to confirm they contain only parsing, orchestration,
      and formatting: zero direct fs or child_process calls, all state
      access through src/state/store.ts, all git operations through the git
      module.
  - id: CT021
    criterion: AC021
    type: command
    command: npm test -- tests/integration/self-hosting-readiness.test.ts
---

# Contract — M003: Mutation commands and self-hosting readiness

## Objective

Implement pitway init, milestone-add, milestone-confirm (incl. --amend),
and task-update as a thin CLI/orchestration layer over M001's pure state
machines and M002's git module, with deterministic operation-specific
resumability for the two operations that combine a state write with a git
commit. M003 is the final manually-authored milestone and proves readiness
for self-hosting. Self-hosting begins only when the real M004 is created
and confirmed through these commands in this repository without direct
edits to authoritative .pitway/ state; the real M004 baseline commit with
PitWay-written trailers is the transition evidence. Full lifecycle
self-hosting is demonstrated when M004 is later verified and completed
through the commands M004 itself implements.

## Scope

- Four commands per the acceptance criteria, plus shared primitives:
  exact-set dirty-path checking (replacing M002's prefix-overlap logic in
  baseline.ts; pathsOverlap is deleted and M002's existing tests must still
  pass), commitOrResume with an operation-specific matchesCommit(sha)
  predicate, computeExpectedBaselinePaths (incl. optional requirement
  path), computeVerificationHash, TrailerQuery.messagePrefix.
- Task-side schema adjustment per AC019 (approved option b), scoped to T005.

## Non-Goals

- verify, milestone-level review->completed execution, usage-add, usage
  aggregation — M004. Authoritative sequence: M003 -> real M004 created
  through PitWay (self-hosting begins) -> M004 implements verification/
  completion/accounting -> M005 six-point Dogfood Validation -> post-M005
  decision on Adaptive Workflow Intensity -> README/release.
- Claude integration assets — M005 per the implementation plan.
- No changes to usageFileSchema / planning / qa semantics (reserved for
  M004); no new state values or transitions; no general crash-recovery
  framework (resumability is narrowly scoped to completing an
  already-started confirm/completion); no branches/worktrees/stashes/
  merges.

## References

- IMPLEMENTATION_PLAN.md §7 (CLI), §10 (git strategy), §13 (testing).
- Confirmed drafting-round decisions (2026-08-18): exact enumerated
  baseline path set; operation-specific commit identity; option (b)
  attempts/usage split scoped to tasks; readiness-vs-self-hosting boundary
  wording; resumability policy favoring recoverability with no destructive
  git operations.

## Change Log
