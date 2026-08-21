---
schema_version: 1
id: M016
title: Extended Dogfood Validation and Release Readiness
status: in_progress
requirement: null
confirmed_at: 2026-08-21T01:56:17Z
verification_approved_hash: sha256:9d5efab06bb3a5f9078f6176a26d443aac4d23446949b30bc6fe5fe57bb6e1be
base_branch: main
base_revision: 6297ba2d701b75c62c99870b3c8ecddbd44af266
acceptance_criteria:
  - id: AC001
    text: "The first real parallel dispatch since M014 built the mechanism: T001 and
      T002 (below) are genuinely independent, disjoint-write_scope tasks with no
      dependency between them, dispatched and integrated concurrently via
      `task-dispatch`/`task-integrate` under a real, committed
      `execution.strategy: parallel_worktrees` opt-in (M014's own tasks were
      mutually parallel-ineligible under its own rules and never exercised this
      for real). Evidence: real `worktree_dispatch`/ `worktree_integrate`
      journal records for both tasks, and the resulting mainline history proven
      structurally indistinguishable from sequential execution (per-task trailer
      commits in integration order, zero merge commits, zero surviving
      scaffolding branches/worktrees) -- the same guarantee M014's synthetic
      test proved, now proven against genuine dogfood use."
  - id: AC002
    text: "The first real use of `git.branch_strategy: milestone` (M012) in this
      repository's own history: this milestone itself is confirmed under a real,
      committed `branch_strategy: milestone` opt-in -- `milestone-confirm`
      creates M016's own dedicated branch (`pitway/M016-<slug>`) and every
      task/completion commit for this milestone lands there. Evidence: this
      milestone's own committed `contract.md` frontmatter carries a real
      `base_branch`/`base_revision` pair, and a manual git-plumbing inspection
      performed before `milestone-complete` (mirroring M012's own end-to-end
      proof, exercised here for real rather than only by test) confirms the
      branch contains exactly this milestone's own commits from `base_revision`,
      with the base branch left untouched and no merge commit created."
  - id: AC003
    text: "The nested-full-suite flake recurring across three consecutive milestones
      (M013/T008, M014 CT010, M015/T011) is diagnosed and hardened so it stops
      failing under real system load nested inside `task-verify`/`verify` --
      `tests/integration/completed-task-revision-path.test.ts`'s line-121
      `pitway init` assertion, in the same real-git-repo setup every occurrence
      has shared. A real root-cause fix if the cause is a genuine PitWay defect
      (a resource-contention or timing issue in `init`'s git-work-tree detection
      or file-system operations under concurrent load); a disclosed,
      evidence-backed test-level accommodation (never a bare retry-until-green)
      if the cause proves to be inherent to spawning many real git subprocesses
      concurrently under load rather than a PitWay defect. Either way, the fix
      is proven against a reproduction of the actual failure condition, not
      merely asserted -- QA-caught pre-confirmation gap, fixed at drafting: a
      standalone single-file run of the target test always passes regardless of
      whether the fix works (that is the flake's own defining symptom), so
      neither T001's own task-level verification nor this AC's milestone-level
      check may rely on that alone. T001's own declared verification is
      therefore the FULL suite (not just its own test file) -- a disclosed,
      deliberate exception to the general never-run-the-full-suite-per-task
      habit, justified because this task's entire job is fixing a bug that only
      manifests when a full run nests inside `task-verify`, so `task-verify
      T001` reproduces that exact historical trigger for real. CT008 (below)
      independently reproduces the sibling `verify`-nested trigger at the
      milestone level."
  - id: AC004
    text: "Both unfixed M011 dogfood structural findings
      (`docs/evidence/M011/skill-dogfood-evidence.md`) are fixed, with a third,
      closely-related defect this milestone's own investigation found while
      scoping AC004: `QuickChangeError` is declared as two textually-identical
      but distinct classes (`src/core/quick-change/create.ts` and `run.ts` each
      `export class QuickChangeError extends Error {}`), so an `instanceof
      QuickChangeError` check written against one site's import silently fails
      to catch an error thrown by the other's code path (`commit.ts` imports
      `run.ts`'s class, `promote.ts` imports `create.ts`'s -- a real,
      currently-live identity split, not a hypothetical one). Unified to exactly
      one exported class, re-exported or imported consistently everywhere. The
      `requireQuickChange` lookup helper, found duplicated in FOUR files --
      `create.ts`, `run.ts`, `commit.ts`, AND `promote.ts` (one more site than
      the M011 finding's own text named) -- consolidated to a single shared
      implementation. Zero behavior change: every existing quick-change test
      still passes unmodified except where it was itself asserting the broken
      cross-class `instanceof` gap, which becomes a positive assertion instead.
      QA-caught gap, fixed at drafting: `promote.ts` is one of the four files
      this AC touches but had no dedicated test naming it anywhere in the
      original draft's checks -- the new regression test (see T002) explicitly
      covers `promote.ts`'s own error identity too, not only
      `run.ts`/`commit.ts`'s."
  - id: AC005
    text: "Real recovery-path dogfood evidence, exercised against genuine
      PitWay-generated state in this repository rather than only a synthetic
      test fixture: `pitway resume`'s live-dispatch reporting is observed for
      real against T001/T002's own real dispatches (AC001) while at least one is
      still in flight; separately, one additional, genuinely disposable scratch
      task is dispatched and then abandoned via `task-discard` (the sanctioned
      recovery exit), with `resume`'s before/after state and the discard's own
      journal record documented -- QA-caught gap, fixed at drafting: the live
      `resume` output during T001/T002's own dispatch window is captured to a
      file by the driver AT THAT TIME
      (`docs/evidence/M016-live-resume-capture.txt`, decision 6), not
      reconstructed afterward, so T003's quote is genuinely contemporaneous.
      Recorded honestly: this proves the live-dispatch and
      sanctioned-abandonment paths for real; it does NOT claim to simulate an
      actual process crash mid-dispatch, which is not safely reproducible
      against this repository's own real working tree without risking corrupting
      it -- that narrower simulated-crash case remains covered only by M014's
      existing synthetic tests, disclosed as a deliberate, safety-motivated
      scope boundary of this AC."
  - id: AC006
    text: "Context-efficiency evidence recorded honestly under the now-expanded
      surface (22 commands, 35 Claude assets, following M006's own evidence-file
      precedent and its own honesty register --
      `docs/evidence/M016-context-efficiency.md`): a real `task-status <id>
      --context --json` bundle measured for a representative task in this
      milestone's own execution, compared byte-for-byte against the M006
      baseline measurement and against the M007/AC011 post-`mapped_ac_ids`-fix
      figure, with the actual delta reported plainly -- larger, smaller, or
      unchanged -- never framed favorably. No new measurement mechanism built;
      this reuses the existing bundle exactly as delivered."
  - id: AC007
    text: "`IMPLEMENTATION_PLAN.md` is reconciled per the established pattern: the
      Bootstrap delivery table gains M015's row (M016's own row left for the
      next reconciliation, per the self-referential discipline); the Revised
      Roadmap header and its opening sequencing paragraph move from \"M014
      delivered\" to \"M015 delivered\"; the Backlog / Pending Candidates
      section is updated -- the M011 findings entry marked DELIVERED (AC004),
      and two new real entries added for items this milestone's own drafting
      surfaced but did not schedule: the write_scope/stale-test-assertion gap
      pattern recurring a fourth time across M012/M013/M014/M015
      reconciliation-adjacent tasks (worth a systemic look, not yet scoped), and
      the \"As of this snapshot\" narrative paragraph's own staleness (it does
      not currently name every completed milestone) -- corrected in the same
      pass rather than merely flagged again; the Status line reflects M016's
      actual delivery. Then the milestone-level gates run exactly once: full
      `npm test` and `npx tsc --noEmit`, both clean. QA-caught gap, fixed at
      drafting: the documentation-edit half of this AC is independently verified
      by CT009's own review check, distinct from CT007's test/typecheck gate --
      the gate proves nothing about whether the prose was actually reconciled."
verification:
  - id: CT001
    criterion: AC001
    type: review
    instruction: Read the real worktree_dispatch/worktree_integrate journal records
      for T001 and T002 (via the evidence documented in T003) and the resulting
      git log -- confirm both tasks landed via task-integrate with per-task
      trailer commits in integration order, zero merge commits, and zero
      surviving scaffolding branches or worktrees.
  - id: CT002
    criterion: AC002
    type: manual
    instruction: The developer personally performs this check (not the executing
      driver session -- QA-flagged self-attestation gap) before running
      milestone-complete, inspecting this milestone's own contract.md
      frontmatter (base_branch/base_revision set) and the actual branch's git
      log against its base -- confirm the branch contains exactly this
      milestone's own commits, the base branch is untouched, and no merge commit
      exists.
  - id: CT003
    criterion: AC003
    type: command
    command: npm test -- tests/integration/completed-task-revision-path.test.ts
  - id: CT004
    criterion: AC004
    type: command
    command: npm test -- tests/unit/quick-change-lifecycle.test.ts
      tests/unit/quick-change-commit.test.ts
      tests/integration/quick-change.test.ts
  - id: CT005
    criterion: AC005
    type: review
    instruction: Where practical, the developer personally performs this check (not
      the executing driver session -- QA-flagged self-attestation gap). Read
      docs/evidence/M016-parallel-recovery-dogfood.md against AC005 -- confirm
      real resume output is quoted (not paraphrased, sourced from
      docs/evidence/M016-live-resume-capture.txt for the in-flight case) for the
      in-flight dispatch case and the task-discard abandonment case, the scope
      boundary around simulated-crash recovery is disclosed, and no claim
      exceeds what the evidence actually shows.
  - id: CT006
    criterion: AC006
    type: review
    instruction: Where practical, the developer personally performs this check (not
      the executing driver session -- QA-flagged self-attestation gap). Read
      docs/evidence/M016-context-efficiency.md against AC006 -- confirm a real
      bundle was measured (not estimated), the comparison against the M006
      baseline and M007/AC011 figures is byte-for-byte, and the delta is
      reported plainly regardless of direction.
  - id: CT007
    criterion: AC007
    type: command
    command: npm test && npx tsc --noEmit
    timeout_ms: 600000
  - id: CT008
    criterion: AC003
    type: command
    command: npm test
    timeout_ms: 600000
  - id: CT009
    criterion: AC007
    type: review
    instruction: Diff IMPLEMENTATION_PLAN.md against AC007's specific edit list --
      the Bootstrap table's new M015 row, the Revised Roadmap
      header/opening-paragraph move to "M015 delivered", the Backlog section's
      M011-findings-DELIVERED mark plus its two new real entries, the "As of
      this snapshot" paragraph's own staleness fix, and the Status line --
      confirm each edit actually landed as described, not merely that the
      test/typecheck gate (CT007) passed.
---

# M016 — Extended Dogfood Validation and Release Readiness

## Objective

Validate M012's branch-strategy and M014's parallel-worktree mechanisms
under real, dogfooded use for the first time in this repository's own
history (both were built but never exercised for real -- M012's own
development happened under `branch_strategy: main`, and M014's own tasks
were mutually parallel-ineligible under its own rules); fix the two
remaining M011 dogfood findings plus a closely-related third one this
milestone's own drafting found; harden the three-milestone-recurring
nested-full-suite flake; record honest context-efficiency evidence under
the now-expanded surface; and gate the branch/worktree release increment
per the Revised Roadmap's own M016 entry.

## Design decisions (binding for this milestone)

1. **Two real, disjoint-scope, backlog-sourced fixes (T001, T002) are the
   parallel-dispatch vehicle.** Rather than inventing artificial work
   purely to demonstrate parallelism, this milestone uses two already-real,
   already-scoped, genuinely independent fixes already sitting in the
   Backlog section -- the flaky test and the M011 findings -- as the first
   real dispatch pair.
2. **`.pitway/config.yaml` is edited manually, once, before `milestone-add`
   -- never by a task.** No CLI command mutates `config.yaml` (by design:
   it is a repository policy file, not workflow state any command owns),
   and `.pitway/` is off-limits to every task's own write_scope. Enabling
   `execution.strategy: parallel_worktrees` and `git.branch_strategy:
   milestone` for this repository is therefore a manual, developer-approved
   setup step -- the same class of action as `pitway init` itself -- made
   once, explicitly, before this contract is confirmed. **This decision
   requires the developer's explicit sign-off before milestone-add runs.**
3. **This contract's own draft is reviewed via a real `pitway
   milestone-review` run before confirmation** -- the first real use of the
   M015 mechanism, satisfying the disclosure in M015's own roadmap entry
   ("the first real `pitway milestone-review` run belongs to M016's own
   drafting").
4. **AC005's recovery evidence deliberately excludes a simulated process
   crash.** A genuine mid-dispatch crash is not safely reproducible against
   this repository's own real working tree without risking corrupting it;
   the live-dispatch and sanctioned-abandonment (`task-discard`) paths are
   real dogfood evidence, disclosed honestly as narrower than a true crash
   simulation, which stays covered by M014's existing synthetic tests only.
5. **No new measurement mechanism for AC006** -- reuses `task-status
   <id> --context --json` exactly as delivered, following M006's own
   evidence-file honesty register (report the real delta, never favorably
   framed).
6. **The driver captures live `resume` output to a file during T001/T002's
   own dispatch window** (`docs/evidence/M016-live-resume-capture.txt`) --
   a procedural step, not a task, performed between dispatching both and
   integrating either, so T003's later AC005 quote is a genuine
   contemporaneous record rather than a reconstruction (QA-caught gap).
7. **Self-attestation is a disclosed limitation, not solved.** CT002,
   CT005, and CT006 are review/manual checks with no independent reviewer
   distinct from the session that did the work; where practical the
   developer personally performs them before `milestone-complete` (each
   check's own instruction says so). This does not fully close the gap --
   disclosed honestly, matching the project's general practice of naming a
   limitation it cannot fully engineer around rather than pretending
   otherwise.

## Scope boundaries

- No new product features -- this milestone is validation, hardening, and
  documentation-reconciliation only.
- No simulated-crash recovery testing beyond what M014's existing synthetic
  tests already cover (decision 4).
- No change to the `quick-change`/`review`/`task-dispatch` mechanisms
  themselves beyond the two disclosed fixes in AC004 -- no redesign.
- `.pitway/config.yaml` is edited exactly once, manually, before
  `milestone-add` (decision 2) -- never touched again by any task in this
  milestone's own graph.

## Change Log

- 2026-08-21 — Initial draft, per the Revised Roadmap's own M016 entry
  (recovery, parallelism, branch/worktree behavior, and context efficiency
  under the expanded surface; gates the branch/worktree release increment)
  and the developer's request to draft the next milestone and have it
  reviewed by the QA role before confirmation.
- 2026-08-21 — Revised before confirmation, folding in the first real
  `pitway milestone-review` run's own QA findings (session `rev-7112ac529f8a`,
  decided `revision_requested`): AC003's verification was fabricated --
  neither T001's own task-level check nor the milestone-level CT003 could
  ever distinguish a real fix from no fix, since both only ran the target
  test file standalone, which always passes regardless (that is the
  flake's own defining symptom). Fixed: T001's own declared verification
  becomes the full suite (nesting inside `task-verify`, reproducing one of
  the two historically documented trigger contexts for real), and a new
  CT008 (full suite via `verify`, reproducing the sibling trigger) is
  mapped to AC003 alongside the original CT003. AC007's documentation-edit
  half had zero verification coverage (CT007 only proved the test/typecheck
  gate); a new CT009 review check closes that gap. Three further QA-caught
  gaps folded in: `promote.ts` (one of AC004's four touched files) gains
  explicit regression coverage in T002's own new test; AC005's live
  `resume` capture is now an explicit driver procedure (decision 6) instead
  of an unsourced quote; CT002/CT005/CT006 now explicitly ask the developer
  to perform them personally where practical, with the residual
  self-attestation limitation disclosed rather than silently accepted
  (decision 7).
