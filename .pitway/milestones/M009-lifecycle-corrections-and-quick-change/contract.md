---
schema_version: 1
id: M009
title: Lifecycle Corrections and Quick Change
status: in_progress
requirement: null
confirmed_at: 2026-08-19T16:38:03Z
verification_approved_hash: sha256:cbd7ba731e56f4003aa19a66690008a3d829dd7a9c2ef166b09adad00e362aa5
acceptance_criteria:
  - id: AC001
    text: "A supported, git-safe way exists to correct an unconfirmed draft
      milestone in place, and a separate supported way exists to abandon one
      permanently. milestone-add gains a --replace <id> mode: usable only while
      <id>'s status is draft (refuses otherwise, pointing to milestone-confirm
      --amend), it validates the same contract/tasks input milestone-add already
      validates and overwrites the existing draft's
      contract.md/tasks.yaml/verification-results.yaml/usage.yaml/
      verification-repairs.yaml in place under the SAME id -- no new id is
      minted, state.milestones is unchanged, and no git operation occurs
      (nothing is committed for a draft; the baseline commit only happens at
      confirm). If --requirement is omitted, the draft's currently materialized
      requirement id is preserved unchanged rather than cleared; if supplied, a
      fresh requirement file is created and the prior one is left in place
      (requirements are append-only artifacts, never deleted). Separately,
      milestone-cancel <id> remains the preserve-and-retire path: draft-only, no
      git operation, the directory and contract.md are never deleted (preserved
      with status: cancelled as a permanent record), and the id is never reused.
      The draft-id-burning question is resolved by this split, not left open:
      --replace is the no-burn path for the common case (the developer made a
      mistake in the draft and wants it fixed), so retiring the id on an
      explicit milestone-cancel is acceptable -- cancellation is reserved for
      genuine abandonment, not routine correction."
  - id: AC002
    text: "A bounded, attributable, resumable, two-phase command exists to land a
      correction against a milestone whose non-cancelled tasks are all completed
      but which is not yet milestone-complete'd -- the exact window M008's
      6f8b5e6/ed119ed exception occupied. Usable only when the target milestone
      is in_progress and every non-cancelled task's status is completed. Phase
      one, approve: the developer supplies repeatable --file <path> and --check
      <id> flags plus --change-log <text> BEFORE any implementation edit begins;
      this allocates an immutable VR id and persists it, its rationale, its
      exact file list, and its exact check list as status: pending -- running
      approve against that exact list is itself the approval (the same 'running
      the command is the approval' convention milestone-confirm and task-amend
      already use), and no implementation edit is permitted before it. --file
      rejects an empty list, duplicate paths, and any path that resolves outside
      the repository; --check rejects an empty list, duplicate ids, and any id
      that is not a command-type check defined in the target milestone's own
      contract. The declared file scope is not restricted by whether a file also
      appears in some completed task's own write_scope -- write_scope membership
      is irrelevant to this gate -- but may never include .pitway/state.yaml or
      the target milestone's own contract.md, tasks.yaml, or
      verification-results.yaml, which stay exclusively owned by
      milestone-confirm/--amend, task-update, and verify/this command's own
      commit phase respectively. Phase two, commit (run only after
      implementation edits are made): validates the actual dirty working tree is
      a subset of exactly the approved files plus this command's own state
      files, refusing on any unexpected dirt; reruns every approved check by
      reusing the same command-check execution and append-only
      verification-results.yaml recording pitway verify itself already uses
      (never a duplicated implementation), refusing the entire commit if any
      approved check fails; and, only once every approved check passes,
      atomically commits the durable VR record together with the corrected files
      and the fresh verification-results.yaml entries in one
      commitOrResume-backed commit. Consequently: tasks.yaml results/usage and
      every historical task commit are byte-for-byte untouched by this mechanism
      (never edited, never amended, never rewritten), and
      verification-results.yaml's append-only history is extended, never
      rewritten, by the exact same recording path pitway verify already uses."
  - id: AC003
    text: "A real, working quick-change workflow exists for small, bounded fixes
      against already-completed milestones, delivered across three
      dependency-ordered tasks (state/schema/lifecycle; verification/
      commit/recovery/trailer; CLI/resume/assets/integration) rather than as one
      oversized task, implementing docs/evidence/M007/ quick-change-design.md's
      specification and its post-M007/T005 primary- use-case refinement. A
      quick-change always references an already-completed source milestone and
      never reopens, rewrites, or amends that milestone or any of its existing
      commits -- the same terminality M007/AC008's completed-task-revision path
      already establishes at the task level, applied here at the commit/defect
      level. Resolved design points, not left implicit: quick-change create
      requires active_milestone: null (refusing while any milestone is
      in_progress -- a bug inside an active milestone's own scope uses a task or
      the ripple-fix policy, not this mechanism) and a clean working tree at
      start, mirroring task-update's own clean-start invariant; the declared
      --scope is an exact file census, approved the same way AC002's repair
      scope is (a deliberate parallel between the two new mechanisms); every
      path under .pitway/ is a protected path a quick-change's scope may never
      include; run history (every quick-change run attempt, pass or fail) is
      preserved append-only in its journal entry, never overwritten, matching
      M007/AC002's flaky-pass-is-a- decision-gate discipline; commit identity
      resolves via a PitWay-Change: <change-id> trailer through the same
      commitOrResume resume/retry pattern task and milestone commits already
      use; `pitway resume` is the authoritative recovery view for a pending
      quick-change -- a fresh session must discover and be able to act on it
      from resume's own output alone, with no separate command required to know
      one exists. An optional quick-change status [<change-id>] subcommand may
      additionally exist for focused inspection of one change, but it is a
      convenience read, never a substitute for resume's own authority; cancel is
      valid only from draft or approved, never from committed, appends a journal
      record and performs no git operation if nothing was ever committed;
      promote is valid only from draft or approved (before commit), converts the
      change into a milestone draft referencing its original objective, and is a
      terminal transition -- a promoted change can never later be committed as a
      quick-change. This mechanism proceeds ahead of quick-change-design.md's
      own stated revisit threshold (>= 3 real quick-change-shaped cases; only
      one, 85fa243, currently qualifies) as an explicit developer decision,
      recorded here rather than silently treated as evidence-satisfied."
  - id: AC004
    text: "IMPLEMENTATION_PLAN.md is reconciled against this milestone's actual
      delivery, mirroring M005/T009, M006/T006, M007/T013, and M008/T005's
      identical self-referential discipline: the Bootstrap delivery table gains
      M008's row (M009's own row is correctly omitted here too, left for
      whichever milestone next runs its own reconciliation task); the command
      surface count and table (S7) are updated for the new commands
      (milestone-cancel, milestone-add's --replace mode, verification-repair,
      quick-change) and the resulting total; the Claude-asset file count (S9) is
      updated for the new command .md assets and the protocol-driver.md
      addition; a new Revised Roadmap placeholder bullet is added for M010 --
      Claude Skills, scheduled before branch/worktree work per explicit
      2026-08-19 developer directive, overriding M007/AC009's own 'revisit when
      a concrete use case exists, not on a fixed schedule' recommendation --
      carrying, in this document's own committed text (never by reference to any
      gitignored reports/*.md or the non-clone-durable
      .git/pitway/m006-report-notes.md), the full vendoring requirement: skills
      may be copied and adapted directly from github.com/thixpin/claude-config
      because it is the developer's own MIT-licensed repository; they are
      vendored into PitWay's own src/integrations/claude/skills/ tree, never a
      runtime dependency on that external repository; appropriate MIT
      attribution is preserved in each vendored file; skills are adapted to
      PitWay's own task/contract shapes, never duplicating
      contract/AC/context_files/write_scope content; they install through
      PitWay's existing Claude-assets installer with no installer changes
      anticipated (already verified by M007/T008); a task declares at most the
      specific skill(s) it needs, never all skills unconditionally; and adoption
      is verified with tests plus real dogfood evidence before being called
      complete, not assumed from the reference repository's design alone. The
      milestones this document previously numbered M009 (Milestone Git branch
      isolation), M010 (parallel task worktrees), and M011 (extended dogfood
      validation) are renumbered M011, M012, and M013 respectively, consistently
      across every cross-reference (S10's trailer-lookup note, S15's
      design-sketch note, the Revised Roadmap bullets and their gating
      language), not just the summary table."
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npm test -- tests/integration/milestone-add.test.ts
      tests/integration/milestone-cancel.test.ts
  - id: CT002
    criterion: AC001
    type: manual
    instruction: Confirm milestone-add --replace preserves the same id, does no git
      operation, preserves the currently materialized requirement id when
      --requirement is omitted, and refuses outside draft status; confirm
      milestone-cancel never deletes the directory/contract.md and the cancelled
      id is never reused; confirm the draft-id-burning question is resolved by
      the two-path split, not left open.
  - id: CT003
    criterion: AC002
    type: command
    command: npm test -- tests/integration/verification-repair.test.ts
  - id: CT004
    criterion: AC002
    type: manual
    instruction: Confirm approve and commit are two distinct, ordered actions -- no
      implementation edit is possible before approve persists the immutable VR
      id, rationale, exact file list, and exact check list; confirm
      --file/--check each reject an empty list, duplicates, and (for --file) a
      path outside the repository or (for --check) an id that is not a
      command-type check in the contract; confirm the file gate is based only on
      the approved scope, never on write_scope membership; confirm commit
      validates the dirty diff is a subset of the approved scope, reruns every
      approved check via the same mechanism pitway verify uses and refuses the
      commit outright on any failure, and only then atomically commits the VR
      record, the corrected files, and the fresh verification-results.yaml
      entries together; confirm both PitWay-Milestone and
      PitWay-Verification-Repair trailers are written correctly; confirm
      retry/resume, pre-commit failure, post-commit interruption, and ambiguity
      are each covered by a real test; confirm contract.md/tasks.yaml/state.yaml
      are structurally unreachable as repair targets and no historical task
      commit is ever edited; confirm milestone-complete refuses while any VR
      record for that milestone is still pending.
  - id: CT005
    criterion: AC003
    type: command
    command: npm test -- tests/integration/quick-change.test.ts
  - id: CT006
    criterion: AC003
    type: manual
    instruction: Confirm the three-task split (state/schema/lifecycle;
      verification/commit/recovery/trailer; CLI/resume/assets/integration)
      delivers docs/evidence/M007/quick-change-design.md's specification in
      full; confirm a null active_milestone is required at create and
      clean-start is enforced; confirm the exact file census, protected .pitway/
      paths, append-only run history, commitOrResume-based commit identity,
      cancellation, and promotion gates are each implemented and tested; confirm
      pitway resume is the authoritative recovery view for a pending
      quick-change (discoverable from resume's own output with no other command
      required) and that any quick-change status subcommand is a
      focused-inspection convenience only, never a substitute; confirm a
      quick-change never reopens or rewrites its source milestone or any of its
      existing commits; confirm the threshold-override disclosure is present.
  - id: CT007
    criterion: AC004
    type: manual
    instruction: Confirm IMPLEMENTATION_PLAN.md gains M008's Bootstrap-table row
      (correctly omitting M009's own), the command surface and Claude-asset
      counts are updated for every new command/asset this milestone actually
      added, the new M010 -- Claude Skills bullet carries the full
      vendoring/attribution/routing/evidence requirement in its own committed
      text, and every cross-reference to the old M009/M010/M011 numbering is
      consistently renumbered to M011/M012/M013.
  - id: CT008
    criterion: AC001
    type: command
    command: npm test
---

# Contract — M009: Lifecycle Corrections and Quick Change

## Objective

Close two real, twice-observed gaps in PitWay's own dogfooded milestone
lifecycle -- no in-place correction path for an unconfirmed draft milestone,
and no supported repair path for a milestone whose tasks are all complete
but which is not yet `milestone-complete`d -- each of which has already
forced a manual, developer-approved exception outside normal command flow.
Build the already-designed quick-change workflow for real, split across
bounded, dependency-ordered tasks, for small fixes against already-completed
milestones. Reconcile IMPLEMENTATION_PLAN.md, including recording a
placeholder for a dedicated future Claude Skills milestone and renumbering
the branch/worktree roadmap entries around it.

## Scope

- `milestone-add --replace <id>`: draft-only, same-id, no-git-operation
  in-place correction. `milestone-cancel <id>`: draft-only,
  preserve-and-retire abandonment path.
- `verification-repair approve <milestone> --file <path>... --check <id>...
  --change-log <text>` then `verification-repair commit <milestone>
  <vr-id>` (and `cancel`): bounded, VR-id-identified, dual-trailer,
  two-phase (approve-before-edit, then validate-rerun-and-commit)
  correction for the tasks-complete/pre-`milestone-complete` window, gated
  on explicit approved scope, never on write_scope membership.
- Quick-change, split into: (1) state/schema/lifecycle, (2)
  verification/commit/recovery/trailer, (3) CLI/resume/assets/integration
  -- implementing the existing M007 design in full, refined to the
  post-milestone-bug-finding primary use case.
- IMPLEMENTATION_PLAN.md reconciliation, including the new M010 -- Claude
  Skills roadmap placeholder (full vendoring requirement recorded) and the
  consistent M009(old)->M011, M010(old)->M012, M011(old)->M013
  renumbering.

## Non-Goals

- Any branch- or worktree-level implementation (now M011/M012 after
  renumbering).
- Implementing Claude Skills -- this milestone only records the M010
  placeholder and its requirements.
- Dependabot configuration, completed-task usage detection/correction, and
  structured failure-evidence extraction -- unrelated future candidates.
- Reopening, rewriting, or amending any completed milestone (M001-M008),
  any of its existing commits, tasks.yaml results/usage, or
  verification-results.yaml history, by any mechanism built here -- a hard
  invariant of AC002 and AC003 both.
- `milestone-add --replace` / `milestone-cancel` acting on anything but a
  `draft`-status milestone.
- `verification-repair` gating on task write_scope membership -- AC002
  explicitly rejects that model.
- `verification-repair` permitting any implementation edit before `approve`
  has persisted the VR id/scope, or committing without rerunning every
  approved check -- both are hard gates, not best-effort.
- `verification-repair`'s check-rerun replacing or duplicating `pitway
  verify`'s own implementation -- it reuses the exact same execution and
  recording path.
- Changing the approved runtime stack (TypeScript strict / Node >= 20 / ESM
  / `commander` + `yaml` + `zod`).

## Design Decisions

- **Draft-id-burning is resolved, not open**: `--replace` (no id burned) is
  the ordinary-mistake path; `milestone-cancel` (id burned, directory
  preserved) is the genuine-abandonment path. Two different developer
  intents, two different mechanisms, each doing exactly one thing.
- **verification-repair drops the earlier draft's `milestone-confirm
  --amend`-first precondition.** Requiring both a contract-level Change Log
  entry (via `--amend`) and the repair command's own `--change-log`
  argument was genuinely duplicative -- two "why" texts for one operation.
  Resolved: the repair command's own persisted VR record (files, checks,
  `--change-log` text, timestamp) is the sole durable rationale.
  `task-amend`'s own two-step dance stays as-is for task-*definition*
  changes, a materially different (and more consequential) kind of edit
  than a bounded post-completion file repair.
- **Every verification-repair gets a durable `VR\d{3}` id** (e.g. `VR001`,
  milestone-scoped, computed the same `max(existing) + 1` way
  `nextMilestoneId` already works), persisted with its exact approved
  files/checks and a `status: pending | committed | cancelled` field in a
  new, self-contained-schema `verification-repairs.yaml` (mirroring
  `journal.ts`'s own precedent of keeping a schema local to the module that
  owns it rather than widening `state/schemas.ts`), initialized empty at
  milestone creation/replacement and included in the baseline commit's
  expected paths.
- **Approve-before-edit is a real two-command lifecycle, not a convention.**
  `approve` performs an uncommitted `.pitway/` write (VR record status:
  pending) -- exactly the same shape as `task-update --status in_progress`
  uncommittedly flipping a task's status before its own completion commit,
  not a new pattern. Only `commit` (run after implementation edits) stages
  and commits anything. At most one `pending` VR may exist per milestone at
  a time; a second `approve` while one is pending refuses, naming it.
- **`commit` reruns the approved checks as a hard, fail-closed gate**,
  reusing the exact command-check execution and verification-results.yaml
  recording `pitway verify` already implements (never a second
  implementation of either). A failing rerun refuses the entire commit; the
  VR stays `pending`, nothing is staged or committed, and -- matching
  §11's existing discipline -- Core never retries automatically; the
  retry-or-diagnose decision is the driver's, the same as for `pitway
  verify` itself.
- **`milestone-complete` refuses while any VR record for its milestone is
  still `pending`** -- an approved-but-uncommitted repair must be resolved
  (committed or cancelled) before the milestone can complete, closing an
  otherwise-dangling state. This is the one new gate added to
  `src/core/milestones/complete.ts`.
- **`--file`/`--check` are repeatable singular flags** (`--file <path>
  --file <path> ...`, not a comma-joined list), each independently
  rejecting an empty list, duplicates, and (files) a path resolving outside
  the repository root or (checks) an id absent from the contract's
  verification list or not of type `command` -- a manual/review check
  cannot be programmatically rerun, so declaring one is rejected the same
  way an unknown id is.
- Commit identity is the pair `(PitWay-Milestone: <id>,
  PitWay-Verification-Repair: VR001)` -- a regression test proves this new
  trailer does not perturb any existing `PitWay-Milestone`/`PitWay-Task`
  lookup. Retry/resume: re-invoking `commit` against a still-`pending` VR
  resumes that exact id using its locked scope, never minting a second id
  or silently accepting a different scope. Pre-commit failure (unexpected
  dirt outside the approved scope, or a failed check rerun): VR stays
  `pending`, no commit, safely retryable. Post-commit interruption (the
  commit lands, the local `status: committed` write does not): resume
  self-heals by matching HEAD's trailers plus committed content against the
  persisted VR record, mirroring `reconcilePending`/`findCompletionCommit`'s
  existing pattern. Ambiguity (a matching-trailer commit whose content
  diverges from the persisted VR record): refuses with "inspect manually,"
  the same idiom used everywhere else in this codebase.
- **`pitway resume` is the authoritative recovery view for a pending
  quick-change**; an optional `quick-change status` exists only for focused
  inspection and never substitutes for it. `verification-repair` has no
  equivalent `resume`/`milestone-status` surfacing in this milestone -- a
  pending VR is only directly inspectable via `verification-repairs.yaml`
  itself. Surfacing it in `resume`/`milestone-status` is left as a
  residual, non-blocking enhancement, not silently decided either way.
- **Quick-change is deliberately split into three dependency-ordered
  tasks** because the single-task version was oversized (six new Core
  files, a new journal kind, three CLI-facing integration points). The
  split also happens to resolve every write_scope overlap it has with
  AC002 (both touch `src/git/trailers.ts`) without inventing an artificial
  dependency -- see the overlap census below.
- **Some `depends_on` edges below exist purely to serialize a shared
  writable file, not because of a logical prerequisite** (T002 on T001;
  T004 on T002). This is stated explicitly rather than left to look like a
  design requirement that isn't real.
- **Quick-change proceeds ahead of its own stated evidence threshold** and
  **Claude Skills is scheduled to a dedicated M010** ahead of its own
  "revisit when a concrete use case exists" decision -- both explicit
  developer overrides, disclosed in AC003/AC004 rather than treated as
  silently evidence-satisfied.

## References

- `docs/evidence/M008/verification-repair-6f8b5e6.md` -- AC002's
  motivating incident.
- `docs/evidence/M007/quick-change-design.md` -- AC003's specification.
- `docs/evidence/M007/claude-skills-decision.md` -- AC004's M010
  placeholder content.
- M007's contract, AC008 -- the completed-task-revision-path precedent
  AC003's terminality invariant mirrors.
- `src/core/milestones/state-machine.ts`, `src/core/milestones/create.ts`,
  `src/core/milestones/complete.ts` (the new pending-VR gate),
  `src/core/tasks/update.ts` (AC018 re-entry path, and its
  clean-start/dirty-subset pattern AC002/AC003 both reuse),
  `src/core/verification/run.ts` (the command-check execution/recording
  path AC002's commit phase reuses), `src/state/journal.ts`,
  `src/git/trailers.ts`, `src/git/baseline.ts`, `src/git/commit-or-resume.ts`
  -- the existing mechanisms AC001/AC002/AC003 extend or deliberately avoid
  reusing, and why.

## Change Log

- 2026-08-19: draft revised before confirmation (first pass) -- AC001
  extended to cover in-place draft correction (not only cancellation);
  AC002's repair-scope gate changed from write_scope-exclusion to
  explicit-approved-scope, and given a durable VR-id/dual-trailer identity
  model with defined retry/resume/failure/ambiguity behavior; AC003's
  single task split into three dependency-ordered tasks with explicit
  lifecycle/protection/identity gates defined; AC004's M007/AC008 reference
  corrected and CT008 reframed as a cross-cutting regression gate; every
  task's `depends_on` reordered so no two tasks with overlapping
  `write_scope` are unordered.
- 2026-08-19: draft revised before confirmation (second pass) -- `pitway
  resume` confirmed as quick-change's authoritative recovery view (an
  optional `quick-change status` may exist alongside it, never in place of
  it); `verification-repair`'s CLI resolved to repeatable `--file`/`--check`
  flags with explicit empty/duplicate/out-of-repo/unknown-check/non-command
  rejection; AC002 rebuilt around a real approve-before-edit lifecycle
  (`approve` locks the immutable VR id/rationale/exact scope before any
  edit; `commit` validates the dirty diff against that scope, reruns every
  approved check as a fail-closed gate via `pitway verify`'s own execution
  path, and only then atomically commits the VR record, the corrected
  files, and the fresh verification-results.yaml entries together); added
  the `milestone-complete`-refuses-on-pending-VR gate.
