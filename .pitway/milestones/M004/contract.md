---
schema_version: 1
id: M004
title: Verification, completion, and usage accounting
status: in_progress
requirement: null
confirmed_at: 2026-08-18T14:39:30Z
verification_approved_hash: sha256:083090de621aee7d36cbbd72a5d6f8e749c140b96aa3e26529a15258ff21dd57
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
  - id: AC014
    text: "Self-hosting evidence, pre-completion scope: M004 crossed the
      self-hosting boundary — created, confirmed, executed, and verified through
      pitway commands — with one disclosed exception: commit 179491c
      (\"workflow: update M004 T004 for resume-priority amendment\") directly
      hand-edited T004's authoritative task definition in tasks.yaml because no
      supported task-amendment command existed at that point in M004's history.
      Every other commit in the milestone's range — the baseline commit and
      every task-completion commit — carries PitWay-written trailers matching a
      real command's commit shape, with no other direct edits to authoritative
      .pitway/ state. M004 is not claimed as fully self-hosted end-to-end; it is
      a self-hosting-boundary crossing with this one disclosed manual
      task-definition amendment. The completion commit itself is audited after
      completion (it cannot gate the completion that creates it); that
      post-completion audit is recorded as follow-up evidence, not as a
      completion precondition."
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
  - id: CT014
    criterion: AC014
    type: review
    instruction: "Before completion, review this repository's full M004 commit range
      (baseline through the latest task/amend commits) to confirm: the baseline
      commit (\"workflow: add milestone M004\", PitWay-Milestone trailer only)
      and every task-completion commit (feat(...)-prefixed, both
      PitWay-Milestone and PitWay-Task trailers) match a real pitway command's
      commit shape; both milestone-confirm --amend commits (\"workflow: amend
      milestone M004\", PitWay-Milestone trailer only) touch only contract.md.
      Explicitly detect and report commit 179491c (\"workflow: update M004 T004
      for resume-priority amendment\") as the single known exception — a direct
      hand-edit of tasks.yaml with no matching command, disclosed rather than
      hidden. Confirm no other commit in the range hand-edits authoritative
      .pitway/ state outside a real command's shape. The completion commit
      itself is audited separately after completion and recorded as follow-up
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
milestone-status), together with dependent-task auto-promotion and the
requirement-store refactor closing the recorded core-fs debt. M004 is
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
- All commands reachable through the single CLI entry point (buildCli main
  path); only packaging is deferred.

## Non-Goals

- Slugged milestone directories: deferred out of M004. T006 (originally
  scoped here) required editing five test files outside its declared
  relevant_files, and no validated command exists to amend a task's scope
  without a direct .pitway/ hand-edit; see Change Log. Slugged-directory
  implementation moves to a later milestone alongside the amendment command
  that makes such scope changes safe.
- Claude integration assets, README, npm packaging/distribution (later
  milestones per the corrected sequence: the next milestone is workflow
  hardening — a validated/auditable task-definition amendment command plus
  slugged-directory implementation, itself created as a grandfathered bare
  directory since slug support does not exist yet when it starts; slugged
  directories then apply from the milestone after that onward; Claude
  integration and the previously recorded context/token/shared-worktree/LSP
  requirements follow; then the six-point Dogfood Validation; release/docs
  and the Adaptive Workflow Intensity decision point come last).
- No automatic merges, no parallel execution, no new state values or
  transitions, no plugin framework.

## Design Decisions

- Auto-promotion replaces the explicit task-update ready step: it is
  deterministic, occurs in the same write/commit as the completion, and
  removes a pure-ceremony command invocation with no safety value.
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
- 2026-08-18 — Removed AC012/AC013/CT012/CT013 (slugged milestone
  directories) from M004's scope and deferred them, along with the slug
  Design Decision and the corresponding Scope/Non-Goals text. Discovered
  during T006 dispatch preparation: implementing slugged directories
  requires updating five test files (milestone-complete.test.ts,
  milestone-confirm.test.ts, self-hosting-readiness.test.ts,
  task-update.test.ts, verify.test.ts) that hardcode the pre-slug bare
  M001 directory path for milestones created through the real
  milestone-add path — none of which were in T006's declared
  relevant_files, and PitWay has no validated command to amend a task's
  relevant_files without a direct .pitway/ hand-edit (forbidden by the
  driver/state layering rule). Rather than expand T006's scope
  unilaterally or hand-edit tasks.yaml, the developer approved deferring
  slugged directories to a later milestone, which will also introduce the
  validated task-definition/scope amendment command that makes this class
  of change safe. T006 itself is cancelled via task-update (not deleted or
  hand-edited) once this amendment is committed. Developer-approved
  2026-08-18.
- 2026-08-19 — Amended AC014/CT014: the CT014 review (performed while
  preparing to complete M004) found that this same task-scope-amendment
  gap had already been worked around once earlier in M004's own history —
  commit 179491c ("workflow: update M004 T004 for resume-priority
  amendment") directly hand-edited T004's task definition in tasks.yaml,
  with no supported command to do so at the time, committed with a
  PitWay-Milestone trailer that mimics but does not match any real
  command's commit shape. This directly contradicted AC014's original
  unqualified "no direct edits to authoritative .pitway/ state" claim.
  Per developer direction: 179491c is preserved as-is (history is not
  rewritten); AC014 is amended to disclose it explicitly by name rather
  than claim M004 as fully self-hosted end-to-end — M004 crossed the
  self-hosting boundary with this one disclosed manual task-definition
  amendment; CT014 is amended to explicitly detect and report 179491c as
  the single known exception on every review, not just note its absence.
  This is the same root-cause gap as the T006 deferral above (no
  validated task-definition/scope amendment command) — the M005 durable
  fix (validated, auditable task-definition amendment command with
  Change Log recording and resumable operation identity) now closes both
  occurrences, not just the T006 one. Developer-approved 2026-08-19.
