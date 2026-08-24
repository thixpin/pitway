---
schema_version: 1
id: M030
title: Task-Verify Evidence Resolution Hotfix
status: completed
requirement: null
confirmed_at: 2026-08-24T04:56:07Z
verification_approved_hash: sha256:7ce939f9637f867ebf5208838ccda6d474bef32a25459d9649460083cc92699e
base_branch: main
base_revision: bac19f1089d55c881b5159ead5d02aff8038f657
acceptance_criteria:
  - id: AC001
    text: "Implicit resolveTaskVerifyEvidence selection picks the newest
      task_verify_evidence record whose execution passed (terminationReason ===
      'exited', exitCode === 0, no typecheck failure), searching backward from
      newest to oldest and skipping only newer execution-failing records to find
      it -- so a later execution-failing record (or several) never masks an
      earlier execution-passing one. That single selected candidate then
      undergoes the existing full staleness validation (task identity, attempt,
      command, write_scope, fingerprint) exactly as today; a staleness mismatch
      on it still refuses immediately, citing that record -- the backward search
      never crosses into staleness, and the existing 'refuses citing the newer
      diverged record, never falling back to an older matching one' regression
      test is preserved unmodified as the boundary proof. When no record's
      execution passed at all, selection refuses exactly as before, citing the
      newest record's own failing-run error -- including when several records
      all fail. Explicit --evidence <id> selection is unchanged: single-record,
      no backward search of any kind. No task_verify_evidence journal record is
      ever mutated, overwritten, or deleted by this change."
  - id: AC002
    text: "pitway task-update <id> in_progress is a legal recovery transition from
      review (new task state-machine edge in src/core/tasks/state-machine.ts,
      mirroring the existing milestone-level review ->
      in_progress-on-failed-verification pattern), incrementing attempts exactly
      like every other transition into in_progress. Making the transition
      actually usable, and fixing the directly-related failed/blocked -> ready
      -> in_progress retry gap with the same mechanism (both already-legal
      transitions per state-machine.ts; no state-machine change needed for
      them), requires one narrowly-scoped, non-overlapping edit in
      src/core/tasks/update.ts: the target === 'in_progress' branch's dirty-tree
      check (lines ~621-633) is rewired to call src/git/safety.ts's existing
      classifyDirtyPaths with taskWriteScope: task.write_scope ??
      task.relevant_files ?? [] and verifiedCleanStart: (task.attempts ?? 0) >
      0, replacing the current bare tasksRepoPath+journal-only allowance --
      reusing the purpose-built, previously-unused mechanism instead of
      hand-rolling a second one. Because attempts is immutable outside this one
      increment path (task-amend's AMENDABLE_FIELDS excludes it -- confirmed)
      and increments exactly once per entry into in_progress, attempts > 0
      correctly and uniformly means 'this task has been in_progress before, so
      its own write_scope dirt is legitimate carryover' -- covering review ->
      in_progress recovery, failed -> ready -> in_progress retry, and blocked ->
      ready -> in_progress retry with one check, with no need to inspect which
      specific prior status led here. A fresh ready -> in_progress first attempt
      (attempts 0/undefined) still gets verifiedCleanStart: false, so unexpected
      write_scope dirt there still refuses exactly as today -- AC014/M005-T004's
      original guarantee is unweakened, proven by a dedicated regression test.
      The existing completion-commit safety guard (ambiguous-state refusal when
      a commit already carries this task's completion trailers) is unchanged and
      keeps applying across any number of recovery cycles. Ownership stays
      explicit: T001 owns the evidence-selection region of update.ts (lines
      ~227-314); T002 owns this in_progress-transition region; neither task
      edits the other's lines. Regression tests prove: (a) the full review ->
      in_progress recovery cycle end to end with a real dirty write_scope file;
      (b) failed -> ready -> in_progress retry with a real dirty write_scope
      file -- confirmed broken on main today (reproduced live against a clean
      scratch repo during this milestone's review) and must pass after this fix;
      (c) the same for blocked -> ready -> in_progress; (d) a fresh ready ->
      in_progress first attempt with an unexpected dirty write_scope file still
      refuses."
  - id: AC003
    text: CLAUDE.md's binding task-states line, the shared driver protocol doc
      (src/integrations/common/protocol-driver.md), and the
      task-update.md/task-verify.md command docs across all three installed
      drivers (claude, codex, opencode) -- including this repo's own installed
      dogfood copies -- are updated to document the review -> in_progress
      recovery path and to correct task-verify.md's 'always the newest record'
      and 'no documented escape hatch' claims, which this fix supersedes. The
      claude-assets pinned sha256 manifest (tests/unit/claude-assets.test.ts) is
      refreshed for every changed shared/claude asset.
  - id: AC004
    text: This fix is implemented entirely in selection logic
      (src/core/tasks/update.ts), the task state machine
      (src/core/tasks/state-machine.ts), and the in_progress dirty-tree check --
      never through a contract/task-definition schema change or a
      journal-format/journal-writer edit. task-amend fingerprint behavior is
      untouched; nothing in this milestone required touching it.
  - id: AC005
    text: Full suite and tsc --noEmit stay green at milestone completion; working
      tree clean.
  - id: AC006
    text: "Governance: any amendment must be proposed by the agent and stop for
      explicit developer approval before the contract is mutated or execution
      continues."
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npx vitest run tests/integration/task-update.test.ts
  - id: CT002
    criterion: AC002
    type: command
    command: npx vitest run tests/unit/task-state.test.ts
      tests/integration/task-update.test.ts
  - id: CT003
    criterion: AC003
    type: command
    command: npx vitest run tests/unit/claude-assets.test.ts
      tests/unit/opencode-assets.test.ts tests/unit/codex-assets.test.ts
  - id: CT004
    criterion: AC004
    type: review
    instruction: Confirm the full diff touches no schema (src/state/schemas.ts), no
      journal writer (src/state/journal.ts), and no task-amend fingerprint code,
      and that no contract/task field shapes changed.
  - id: CT005
    criterion: AC005
    type: command
    command: npm run build && npm test && npx tsc --noEmit
    timeout_ms: 900000
  - id: CT006
    criterion: AC006
    type: manual
    instruction: Confirm every amendment applied to this contract carries recorded
      explicit developer approval made before the amending command ran.
---

# Contract

## Objective

Fix `resolveTaskVerifyEvidence`'s implicit selection so a later failing
task-verify re-run can never mask an earlier passing one, give a task stuck
in `review` with no valid evidence a narrow, sanctioned way back to
`in_progress` to produce a fresh record -- closing the "there isn't one"
escape-hatch gap `task-verify.md` currently documents as permanent -- and
fix the same-root dirty-tree defect that already blocks the existing
`failed`/`blocked -> ready -> in_progress` retry path today.

## Background

Today, implicit evidence selection always takes the last-appended
`task_verify_evidence` record for a task and validates only that one
(`src/core/tasks/update.ts:287-314`). If a developer re-runs `task-verify`
after an earlier passing run -- for any reason, including a flake or an
unrelated environment hiccup -- the newer failing record permanently masks
the older passing one, and `task-update <id> completed` refuses with no
way to select the still-valid earlier evidence. Because `review`'s only
legal exit today is `completed` (`state-machine.ts`), and `task-verify`
only runs while `in_progress`, a task can become permanently stuck once
this happens.

**Design decision, made explicit for the approval gate:** the backward
search added by AC001 crosses the pass/fail boundary only -- it skips
newer records solely because their *execution* failed. It deliberately
does **not** search further back past a staleness mismatch (attempt/
command/write_scope/fingerprint divergence) on the newest execution-passing
candidate; that candidate's staleness failure still refuses immediately,
exactly as today. The alternative (searching backward across staleness too)
was considered and rejected as unscoped widening beyond this hotfix's
"pass/fail masking" defect -- the existing regression test asserting a
diverged-command record is never bypassed for an older matching one stays
green, unmodified, as the boundary proof.

**Independent architect review finding, verified empirically before folding
into scope:** `failed`/`blocked -> ready -> in_progress` retry hits the
exact same dirty-tree check in `update.ts` (~lines 621-633) that AC002
originally only fixed for `review`, and that path was never fixed to
tolerate the task's own carried-over `write_scope` dirt either. Reproduced
directly against a clean scratch repo on `main`, independent of any of
this milestone's changes: `in_progress -> failed -> ready -> in_progress`
with a genuinely dirty declared `write_scope` file refuses today with
`cannot safely proceed: unrelated dirty changes present: <file>`. This is
the same defect on the same code path, not a lookalike -- so AC002 now
fixes both `review` and `failed`/`blocked` recovery with one unified
mechanism (see AC002's `attempts > 0` derivation) rather than leaving a
known, freshly-confirmed sibling bug for a follow-up milestone.

**Why the recovery path is `task-update <id> in_progress`, not `task-amend`:**
`task-amend`'s cumulative-chain fingerprint check hashes
`JSON.stringify(currentTask)` -- the whole task record, including
`status`/`result`/`usage`/`attempts` (`src/core/tasks/amend.ts:104,163-164`).
Any ordinary `task-update` status transition between two amendments in an
uncheckpointed chain changes that hash and permanently conflicts the next
amendment against the same task. This is a real, independently
confirmed gap, but a separate one from the evidence-masking defect this
milestone fixes, and `task-amend` plays no role in AC002's recovery flow --
so per the original scope ("keep task-amend fingerprint behavior out of
scope unless implementation proves it is strictly required"), it stays
untouched here and is a candidate for `pitway backlog` once this milestone
is active, not a task in this plan.

**Post-draft architect review (recorded against this milestone before
confirmation):** an independent architect-role review surfaced four
findings -- one major (the failed/blocked retry gap above, folded into
AC002), two minor (reuse `classifyDirtyPaths`' existing `taskWriteScope`/
`verifiedCleanStart` option instead of a hand-rolled check, folded into
AC002's mechanism; `resume.ts` doesn't surface a task stuck in `review`
needing recovery, kept out of scope per developer direction -- a `pitway
backlog` candidate once this milestone is active, not a task here), and one
checked-clean confirmation of AC001's pass/fail/staleness boundary (no
change). Recorded in `reviews.yaml` under this milestone.

## Change Log

- 2026-08-24: T003's `write_scope` amended to drop `.claude/protocol-driver.md`,
  `.claude/commands/task-update.md`, `.claude/commands/task-verify.md`,
  `.opencode/commands/task-update.md`, `.opencode/commands/task-verify.md`.
  Discovered mid-task: `.gitignore` excludes `/.claude/` and `/.opencode/` at
  the repo root ("local dogfood installs, never the tracked product output;
  `src/integrations/<driver>/` is the real shipped asset source, installed
  verbatim into *other* repos, never this one") -- `task-verify` correctly
  refuses a declared write_scope path that is git-ignored, since it can never
  be committed. AC003's text is unaffected (it never named these specific
  paths as write_scope, only as "this repo's own installed dogfood copies"
  to update); those five files were still edited to stay in sync for local
  convenience, but sit outside git's purview and outside any verifiable task
  scope. Developer-approved before this amendment ran.
