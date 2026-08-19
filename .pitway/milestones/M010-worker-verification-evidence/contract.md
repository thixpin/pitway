---
schema_version: 1
id: M010
title: Worker Verification Evidence
status: completed
requirement: null
confirmed_at: 2026-08-19T19:25:00Z
verification_approved_hash: sha256:12dc04cf652e98c36c47e0bad99a35f8db34b823a953fd3210f049ee386ca8c1
acceptance_criteria:
  - id: AC001
    text: >-
      A new task-verify command executes exactly a task's own approved
      verification command (task.verification.detail, command/tdd strategy only
      -- manual/review tasks are refused, they were never programmatically
      verifiable) plus an optional --typecheck <command>, reusing the existing
      timeout-bounded, descendant-cleanup-guaranteed executeCommand primitive
      (src/core/verification/process-exec.ts) -- never a new
      subprocess-execution implementation.

      Fingerprint scope (resolved after architecture review found the original
      'every dirty path' design self-invalidating: the mandatory in_progress ->
      review transition rewrites tasks.yaml between verify time and completion
      time, so a fingerprint that included .pitway/ state paths could never
      match): the fingerprint covers exactly the task's own normalized
      write_scope paths, falling back to relevant_files for legacy tasks --
      never arbitrary untracked siblings, never any .pitway/ workflow-state
      file, regardless of the dirty-path allowance below.

      Dirty-path allowance (resolved after a second architecture review found
      the first fix's own compensating check self-defeating in turn:
      task-verify's precondition is that the task already be in_progress, and
      reaching in_progress necessarily writes tasks.yaml via updateTask's
      persistTask -- tasks.yaml is unconditionally dirty at verify time, and
      write_scope never contains a .pitway/ path, so a check that only allowed
      write_scope would refuse on every legal invocation, the identical
      always-refuse defect relocated rather than closed): task-verify's allowed
      dirty set is constructed exactly the way completeTask already constructs
      its own (src/core/tasks/update.ts, its expectedPaths local) -- the task's
      own normalized write_scope/relevant_files, plus the active milestone's own
      tasks.yaml path (always allowed, unconditionally, the same way
      completeTask's own tasksPath is), plus whatever classifyDirtyPaths(root,
      {journalMilestone}).expected returns for the active milestone
      (src/git/safety.ts -- real, pending-journal- backed workflow paths only,
      never a broad .pitway/** allowance; this is the same primitive
      completeTask's own journalExpected already calls). Any dirty path outside
      that exact constructed set -- task-unrelated source code or an unsupported
      .pitway/ file alike -- is refused. This dirty-path allowance is a distinct
      concern from the fingerprint above and never feeds into it: workflow-owned
      state paths are permitted for this safety classification only, the
      fingerprint itself still covers exactly the task's own
      write_scope/relevant_files, nothing more. Each declared path is
      fingerprinted as (normalized POSIX-relative path, a defined
      filesystem-state marker, and a real content hash): a path that exists is
      hashed from its actual bytes; a path that does not exist on disk is
      represented by a fixed, defined missing-file marker, never silently
      skipped or erroring.

      A rename must never silently omit either side (resolved after a third
      round of scrutiny: the fingerprint itself still has no rename- detection
      logic of its own, and none is added -- git status --porcelain, empirically
      verified, never reports an unstaged worktree rename as a single R entry
      with both paths, only as a separate plain delete plus a separate untracked
      add, so no reliable rename-pairing signal exists to build
      fingerprint-level detection on). Instead, both the normalized old and new
      paths are required to be explicitly declared in write_scope/relevant_files
      for a rename to verify at all: when both are declared, the old path
      fingerprints as missing and the new path fingerprints as its real content,
      exactly as before. When only one side is declared, the other side's real,
      separately-reported delete-or-untracked status is -- by construction of
      the dirty-path allowance below, not a new mechanism -- already a dirty
      path outside the declared scope, and verification refuses with a precise
      diagnostic naming the exact undeclared path and its git status (deleted or
      untracked), noting explicitly that an incompletely-declared rename is a
      likely cause. A declared path that itself git-ignored (checked via git
      check-ignore, the same primitive git already exposes for exactly this
      question, never inferred from absence in git status output) is refused
      outright at verify time -- an ignored output can never be safely
      checkpointed by the completion commit this evidence is meant to support,
      so declaring one is treated as an inconsistent task definition, not
      silently fingerprinted anyway. write_scope/relevant_files comparison (both
      for the dirty-subset check and for evidence matching, below) is
      order-independent normalized-set comparison, never array equality -- a
      task-amend that only reorders declared paths never spuriously invalidates
      otherwise- valid evidence.

      task-verify captures the exact command, exit code, best-effort pass/fail
      counts parsed from the command's own output (never fabricated when parsing
      fails -- left absent instead), duration, termination_reason, and the
      typecheck result when supplied, and persists all of it plus the
      fingerprint above as a new, git-invisible, sibling journal record kind
      (task_verify_evidence, alongside entry/checkpoint/auto_run/quick_change,
      structurally excluded from checkpoint-folding the same way those already
      are), never a .pitway/-committed file, carrying a unique evidence id, the
      milestone id, the task id, and the task's current attempts count.

      Verification-command identity is exact string equality against the task's
      current verification.detail -- no separate approved-command hash is
      introduced; a task definition is already protected by the confirmed
      baseline/amendment workflow (task-amend, gated on an approved Change Log
      entry), so the plain string comparison is already tamper-evident by
      construction. A canonical tuple hash is deferred, introduced later only if
      a real ambiguity or measured performance need demonstrates it's actually
      required -- not speculatively now.

      Evidence selection (resolved after architecture review found the original
      wording self-contradictory about whether 'newest' meant newest-overall or
      newest-matching): `task-update <id> completed` resolves evidence
      implicitly by default by selecting the single newest task_verify_evidence
      record for the current milestone id and task id, by append order alone --
      selection never filters by attempt, command identity, write_scope, or
      fingerprint. That one selected record is then validated against all four:
      attempt must match the task's current attempts, the command must match
      verification.detail exactly, write_scope/relevant_files must match as a
      normalized set, and a freshly recomputed fingerprint (same scope rules
      above) must match exactly. Any one mismatch refuses completion outright,
      naming the specific mismatch -- implicit resolution never searches
      backward to an older record that happens to match, and never silently
      treats a mismatch as absent evidence. If no task_verify_evidence record
      exists for this task at all (task-verify was never run for it), completion
      falls through unchanged to the existing --result/--message path -- this is
      the only case implicit resolution treats as equivalent to omitting
      evidence entirely. An optional, explicit --evidence <id> flag selects only
      that exact record by id (never a milestone/task filter) and applies the
      identical four-way validation to it; an id that does not exist at all is
      refused with its own distinct unknown- evidence-id message, separate from
      the mismatch-refusal message for an id that exists but fails validation.
      Missing, malformed (schema-invalid), timed-out, failed, or
      non-command-type evidence is refused outright regardless of how it was
      selected.

      Completion semantics (resolved after architecture review found the
      relationship between --result and evidence unspecified): --result <file>
      and --message <file> remain required inputs to task-update completed
      exactly as today, unchanged, whether or not evidence is being applied --
      this milestone never makes them optional. When valid verification evidence
      is resolved (implicit or explicit), the captured evidence becomes the
      authoritative persisted result.evidence, replacing whatever evidence
      string the driver supplied in --result's file; the driver-supplied summary
      is used as-is, unchanged, since task-verify has no analog to it. Driver-
      supplied evidence text is never allowed to overwrite verified evidence --
      this is an unambiguous, unconditional precedence rule, not a
      conflict-detection step. Three distinct concepts stay terminologically
      separate throughout this milestone's own docs (task-verify.md,
      protocol-driver.md, dispatch.md): the verification record (the full
      task_verify_evidence journal entry), the evidence id (the identifier
      naming one such record), and the persisted result evidence (the final,
      capped string in task.result.evidence, derived from the verification
      record when one is applied).

      When no task_verify_evidence record exists for a task at all,
      task-update's existing --result/--message behavior (including its own
      evidence field going straight to result.evidence, unchanged) is completely
      unchanged -- byte-for-byte -- from before this milestone
      (additive-optional, the same non-breaking pattern mapped_ac_ids already
      established): this milestone adds a new, stronger, structurally-checked
      path alongside the existing one, it does not remove or weaken it. The
      driver still independently reviews the diff and write_scope for every task
      before persisting a result -- task-verify's evidence formalizes and
      replaces the driver's own ad hoc rerun-and-eyeball step (the exact
      informal protocol adopted live during M009's own execution), it never
      replaces the diff review itself. Full typecheck and the full suite remain
      milestone-level gates only, run once at pitway verify, never per-task.
      Only the capped, concise evidence fields above are ever persisted into a
      task's own result.evidence (via the existing character-cap/ truncation
      path already used for every other result), never a full log or raw command
      transcript.
  - id: AC002
    text: "IMPLEMENTATION_PLAN.md is reconciled against this milestone's actual
      delivery, mirroring M005/T009 through M009/T006's identical
      self-referential discipline: the Bootstrap delivery table gains M009's row
      (M010's own row is correctly omitted here too, left for whichever
      milestone next runs its own reconciliation task); the command surface
      count and table (S7) are updated for the new task-verify command and
      task-update's new --evidence flag; the Claude-asset file count (S9) is
      updated for the new task-verify.md asset and the
      protocol-driver.md/dispatch.md additions describing the new
      evidence-acceptance discipline; the Revised Roadmap's M010 entry reflects
      its actual delivery in place of its current not-yet-drafted placeholder
      text; the Status line reflects M010's actual delivery."
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npm test -- tests/unit/task-verify.test.ts
      tests/integration/task-verify.test.ts
      tests/integration/task-update.test.ts
  - id: CT002
    criterion: AC001
    type: manual
    instruction: Confirm task-verify only accepts command/tdd-strategy tasks and
      refuses manual/review ones; confirm it reuses executeCommand rather than
      reimplementing subprocess execution; confirm the fingerprint covers
      exactly normalized write_scope (or relevant_files) paths only, never
      arbitrary untracked siblings or any .pitway/ path, and that a real, live
      test proves a task completes successfully through the mandatory
      in_progress -> review -> completed lifecycle without the review step's own
      tasks.yaml rewrite invalidating evidence; confirm missing/deleted paths
      use a defined marker, a rename requires both the old and new paths
      declared -- verified by a real test for the valid both-declared case and a
      real test for each one-sided case, confirming the one-sided case refuses
      with a precise diagnostic naming the specific undeclared path and its git
      status, not a silent omission; confirm a declared git-ignored path is
      refused at verify time via a real git check-ignore call (not inferred from
      git status), and write_scope comparison is order-independent; confirm
      task-verify's dirty-path allowance is constructed exactly the way
      completeTask's own expectedPaths already is (write_scope/relevant_files,
      the active milestone's own tasks.yaml path, and classifyDirtyPaths's
      journal-backed expected set) -- never a broad .pitway/** allowance -- and
      that a live test proves a task can verify successfully while its own
      tasks.yaml is dirty from the in_progress transition, that a valid
      journal-backed workflow path is allowed, and that both an arbitrary
      .pitway/ edit and an unrelated source/untracked file are still refused;
      confirm the fingerprint itself never includes any workflow-owned path this
      allowance permits, only the task's own scope; confirm verification-command
      identity is plain string equality against verification.detail with no
      separate hash introduced; confirm implicit evidence resolution selects the
      single newest record by milestone id and task id alone (by append order,
      never filtered by match), validates it against
      attempt/command/write_scope/fingerprint afterward, refuses outright naming
      the mismatch when it diverges (never searching backward to an older
      matching record), and falls through to the unchanged --result/--message
      path only when no record exists at all for that task; confirm the explicit
      --evidence override selects only the named record by id and applies the
      identical validation, with a distinct refusal message for an id that does
      not exist versus one that exists but diverges; confirm --result/--message
      remain required inputs unchanged, and that accepted verification evidence
      becomes the authoritative result.evidence, never overwritten by
      driver-supplied text; confirm no usage-attachment field or input path
      exists anywhere in this milestone's diff; confirm only concise, capped
      evidence is ever persisted into a task result, never a full log; confirm
      protocol-driver.md/dispatch.md are updated to describe the driver using
      task-verify instead of an ad hoc independent rerun, and that the
      diff/write_scope review itself is preserved, not replaced, and that the
      verification-record/evidence-id/persisted-result-evidence distinction is
      documented.
  - id: CT003
    criterion: AC002
    type: manual
    instruction: Confirm IMPLEMENTATION_PLAN.md gains M009's Bootstrap-table row
      (correctly omitting M010's own), the command surface/count and
      Claude-asset count are updated for task-verify and the new --evidence
      flag, the M010 Revised Roadmap entry reflects actual delivery, and the
      Status line is updated accordingly.
  - id: CT004
    criterion: AC001
    type: command
    command: npm test
---

# Contract — M010: Worker Verification Evidence

## Objective

Eliminate routine duplicate driver test runs without weakening verification. A new
`task-verify` command formalizes the ad hoc "independently rerun and eyeball" discipline
adopted live during M009's own execution into a real, structurally-checked, Core-validated
mechanism: exact captured evidence (command, exit code, pass/fail counts, duration,
termination reason, typecheck result, a corrected deterministic fingerprint) tied to a task's
identity, attempt, approved command, and write_scope. `task-update`'s completion path can then
accept that evidence -- when and only when every one of those still matches -- instead of the
driver re-running a worker's already-verified command a second time. Nothing about this weakens
today's verification: the additive `--evidence` path is strictly stronger than today's
unchecked `--result` trust, and the existing `--result`-only path is completely preserved for
whatever doesn't go through `task-verify`.

## Scope

- `task-verify <task-id> [--typecheck <command>]`: executes the task's own approved
  verification command (and optional typecheck) via the existing `executeCommand` primitive,
  fingerprints exactly the task's own normalized `write_scope`/`relevant_files` paths (real
  content hash, defined missing-file marker, order-independent set), separately refuses any
  dirty path outside that scope, and persists a durable, git-invisible evidence record (a new
  journal sibling kind, `task_verify_evidence`).
- `task-update <id> completed`: resolves evidence **implicitly by default** — the single newest
  record for the current milestone id + task id (by append order alone), then validated against
  attempt/verification-command identity/write_scope/fingerprint, refusing outright and naming
  the mismatch on divergence (never falling back to an older record), falling through to the
  existing `--result`/`--message` path only when no record exists at all. An optional, explicit
  `--evidence <id>` selects only the named record (recovery/debugging/deterministic testing),
  applying the identical validation, with its own distinct unknown-id refusal.
- `--result`/`--message` remain required inputs unchanged; accepted verification evidence
  becomes the authoritative `result.evidence`, never overwritten by driver-supplied text.
- `task-update`'s existing `--result`/`--message`-only path (when no evidence record exists for
  a task at all): unchanged, byte-for-byte.
- `protocol-driver.md`/`dispatch.md`: updated to describe the driver using `task-verify`
  instead of an ad hoc independent rerun, preserving the diff/write_scope review itself.
- IMPLEMENTATION_PLAN.md reconciliation (M009's still-missing Bootstrap row, M010's own actual
  delivery, updated command/asset counts, Status line).

## Non-Goals

- Removing, deprecating, or weakening `task-update`'s existing `--result`/`--message`-only
  completion path -- it remains fully supported, unchanged.
- Making `--evidence` mandatory for every task completion -- manual/review-strategy tasks and
  inline-executed documentation tasks (like M009's own T006) have no command to verify this
  way and keep using the existing path.
- Running full typecheck or the full suite per task -- both remain milestone-level gates only.
- Any usage/token-accounting attachment to an evidence record, in any form -- removed entirely
  from this milestone after architecture review found it named in AC001's text with no
  implementing field, input path, or test anywhere in the task graph. Whole-run/main-agent token
  accounting remains the separate, already-deferred Token Telemetry Spike; if evidence-level
  usage attachment is wanted later, it needs its own real design and task, not a stray sentence.
- Any change to `verification-repair` or `quick-change` (M009) -- this milestone's evidence
  mechanism is task-scoped only, not a repair or change-lifecycle concept.
- Any change to the milestone-level `pitway verify` command or its CT execution engine
  (`src/core/verification/run.ts`) -- `task-verify` is a new, task-scoped sibling command,
  reusing `executeCommand` the same way `run.ts` already does, never modifying `run.ts` itself.

## Design Decisions

- **Evidence lives in the journal, not a new file.** A `task_verify_evidence` journal record,
  sibling to `entry`/`checkpoint`/`auto_run`/`quick_change`, reuses the existing
  git-invisible-storage, structural-checkpoint-exclusion, and append-only infrastructure rather
  than inventing a new path resolver and file format. This mirrors how `quick_change` was added
  in M009 with zero changes to `derivePending`/`resolveTargetPath`.
- **Evidence resolution is implicit by default, explicit `--evidence <id>` is an override, not
  the primary path.** Resolved 2026-08-20 (developer decision, closing what the earlier draft
  left open): the common case needs no id argument at all -- task-update finds the newest
  matching record itself. `--evidence <id>` exists for recovery, debugging, and deterministic
  testing, where naming a specific record matters; it never bypasses the match rules, only
  changes which record they're applied to.
- **Selection is by (milestone id, task id) alone; matching is a post-selection validation, never
  a search filter.** Resolved after architecture review found the original wording
  self-contradictory (it described "the newest matching record," which could silently mean
  reaching past a fresher-but-diverged record to an older one that happens to match -- exactly
  what the same sentence's own next clause forbade). The single newest record by append order is
  always the one checked; it either passes all four validations or completion refuses naming
  the mismatch. No fallback search ever happens.
- **The fingerprint is scoped to `write_scope`/`relevant_files` only, never `.pitway/` or
  arbitrary untracked files.** Resolved after architecture review found the original "every
  currently dirty path" design self-invalidating: `tasks.yaml` is dirty at task-verify time
  (the `in_progress` transition itself writes it) and is rewritten again by the mandatory
  `in_progress -> review` transition before `task-update completed` ever runs -- so a
  fingerprint that swept in `.pitway/` state could never match, for every task, unconditionally,
  defeating the milestone's own purpose. Scoping to exactly the declared write path(s) removes
  this entirely: nothing PitWay itself writes as part of the ordinary task lifecycle is ever
  inside a task's own `write_scope`. Out-of-scope dirt is still caught, just via a separate,
  explicit dirty-subset refusal at verify time, not folded into the hash -- see the dirty-path
  allowance decision below, which resolves a second, distinct always-refuse defect a second
  architecture review found in that separate check's own first draft.
- **The dirty-path allowance reuses `completeTask`'s own real, already-shipped construction --
  it does not reinvent it.** Resolved after a second architecture review found the first fix's
  compensating "refuse anything outside `write_scope`" check self-defeating in turn: `tasks.yaml`
  is unconditionally dirty the moment a task reaches `in_progress` (task-verify's own
  precondition), and `write_scope` never contains a `.pitway/` path, so that check alone refused
  on every legal invocation -- the same always-refuse class of bug relocated, not closed.
  `task-verify`'s allowed set is now built exactly the way `completeTask`'s `expectedPaths`
  already is (`src/core/tasks/update.ts`): the task's own `write_scope`/`relevant_files`, plus
  the active milestone's own `tasks.yaml` path (unconditionally allowed, the same way
  `completeTask`'s own `tasksPath` is), plus whatever `classifyDirtyPaths(root,
  {journalMilestone}).expected` (`src/git/safety.ts`) returns for the active milestone -- real,
  pending-journal-backed paths only, reusing the identical primitive `completeTask`'s own
  `journalExpected` already calls, never a broad `.pitway/**` glob. Anything outside that
  precisely constructed set is refused, source code and unsupported `.pitway/` files alike.
- **Missing files and git-ignored declared paths are each given a defined, explicit behavior**,
  not left to an implementer's judgment call: a missing declared path fingerprints as a fixed
  marker (never skipped, never an error); a declared path that is git-ignored is refused at
  verify time, since it could never be captured by the completion commit this evidence exists to
  support anyway.
- **A one-sided rename is refused, not silently omitted -- but detection reuses the existing
  dirty-path allowance, it does not add new rename-pairing logic.** Resolved after empirically
  verifying (a real temp repo, an unstaged rename, `git status --porcelain --untracked-files=all`
  both with and without `--find-renames`) that git never reports an unstaged worktree rename as a
  single paired entry -- only a separate plain delete and a separate untracked add, exactly the
  same as two unrelated changes. Building real rename-pairing detection would mean either content-
  similarity heuristics across the whole working tree (a significant undertaking, effectively
  reimplementing git's own staged-rename detection for the unstaged case, which git itself does
  not do) or waiting for the task's own commit to make staged rename detection possible (too
  late -- verification happens before that). The fix that's actually available and sufficient:
  the fingerprint requires both the old and new paths declared for a rename to be *correctly
  represented*, and separately, the dirty-path allowance (below) already refuses any dirty path
  outside the declared scope -- so a one-sided rename's undeclared half (a real, separately
  reported delete or untracked-add) is *already* refused by that existing mechanism, not silently
  missed. What changes here is the diagnostic: the refusal names the specific undeclared path and
  its git status, and notes that an incompletely-declared rename is a likely cause -- turning an
  already-correct refusal into a precise, actionable one, rather than adding a second detection
  mechanism.
- **`--result`/`--message` stay required; verified evidence is authoritative over driver text,
  unconditionally.** Resolved after architecture review found this relationship unstated: the
  driver-authored `summary` is always used as given (task-verify has no analog to it); when valid
  evidence is resolved, it becomes `result.evidence`, and whatever evidence text the driver's
  `--result` file carried is simply not used -- an unconditional precedence rule, not a
  conflict-detection step requiring its own judgment call at implementation time.
- **Usage attachment is removed from this milestone entirely**, not partially implemented.
  Architecture review found the original AC001 sentence ("runtime-reported worker usage may be
  attached... without estimation") had no backing field, input, or test anywhere in the task
  graph -- an aspiration stated in the contract that nothing actually built. Cut rather than
  retrofitted; if wanted later, it gets its own real design pass.
- **No separate approved-command hash.** Resolved 2026-08-20 (developer decision): plain string
  equality against the task's current `verification.detail` is sufficient, since task
  definitions are already protected by the confirmed baseline/amendment workflow (`task-amend`
  requires an approved Change Log entry) -- a second hash would be redundant tamper-evidence
  over an already-protected value. Renamed "approved command/hash" to "verification command
  identity" throughout this contract to match. A canonical tuple hash is deferred, not rejected
  outright -- introduced later only if a real ambiguity or a measured performance need
  demonstrates it, never speculatively.
- **`--evidence` (implicit or explicit) is additive-optional, never mandatory.** A task with no
  `task_verify_evidence` record at all completes via the existing `--result`/`--message` path,
  unchanged. This milestone adds a stronger path, it does not require migrating to it.
- **The fingerprint itself hashes declared paths directly from the filesystem, never via `git
  status` parsing** -- since it now covers exactly `write_scope`/`relevant_files`, each path's
  real content is read and hashed directly, with no dependency on git's own untracked-file
  reporting at all. The separate dirty-path allowance check (above), which does enumerate every
  actually-dirty path via the existing `checkWorkingTreeClean`/`classifyDirtyPaths` primitives
  (`src/git/safety.ts`) to compare against the allowed set, inherits whatever untracked-file
  detection those existing, already-tested functions already provide -- this milestone does not
  author its own dirty-path enumeration or its own `--untracked-files=all`-style fix a second
  time, it reuses the real primitive `completeTask` already trusts.
- **Task-verify does not change who runs what.** A dispatched worker still runs its own tests
  directly and reports back (per `protocol-worker.md`, unchanged); the driver is the one who
  runs `task-verify` to produce formal evidence, exactly the same "driver independently
  verifies" step already required today, just now structurally checked by Core instead of
  trusted by convention. The benefit is on *resume/retry*: a later completion attempt against
  unchanged state reuses the same evidence instead of re-verifying from scratch.
- **T002 filters the journal caller-side; no new reader is added to T001.** The earlier draft's
  T002 objective said "via T001's read helpers," but T001 only ever commissioned
  `appendTaskVerifyEvidenceRecord` -- no exported reader. Resolved by having T002 filter the
  existing generic `readJournal` export inline, the same way `readAllQuickChanges`
  (`src/core/quick-change/create.ts`) already lives caller-side rather than in `journal.ts`
  itself, rather than expanding T001's `write_scope` mid-milestone for a helper it was never
  asked to build.
- **Once any `task_verify_evidence` record exists for a task, there is no path back to plain
  `--result`/`--message`.** A real, disclosed limitation, not a defect: implicit resolution's
  fallback to the unchanged `--result`/`--message` path applies only when *no* record exists at
  all for a task (AC001 above); once one does -- even a failed or stale one -- completion always
  validates against it. The only way forward is a fresh, passing `task-verify` run producing a
  newer valid record; there is no bypass. Documented in `task-verify.md` (T003) rather than
  silently discovered later, matching this project's own pattern of disclosing lifecycle-edge
  gaps rather than hiding them.
- **T001 stays one task.** Re-evaluated against its current `write_scope` (four files:
  `journal.ts`, `tasks/verify.ts`, and their two test files) after being flagged as a sizing risk
  by both architecture reviews -- still genuinely bounded, not split preemptively. If real
  implementation reveals it has grown beyond this, splitting remains available via `task-amend`
  the same way every other task in this workflow can be corrected, rather than guessed at now.

## References

- `docs/evidence/M009/token-accounting-feasibility.md` -- the separate Token Telemetry Spike;
  this milestone has no usage-attachment mechanism of any kind after the architecture-review
  correction (see Design Decisions and Non-Goals above).
- `src/core/tasks/state-machine.ts` -- the task state machine (`in_progress -> review ->
  completed`, no direct `in_progress -> completed` transition) that made the original
  "every dirty path" fingerprint design self-invalidating; the exact reason the fingerprint is
  now scoped to `write_scope`/`relevant_files` only.
- `src/core/verification/process-exec.ts` (`executeCommand`) -- reused, never reimplemented.
- `src/state/journal.ts` (`auto_run`, `quick_change` sibling-kind precedent) -- the pattern this
  milestone's evidence storage follows.
- `src/core/tasks/update.ts` (`completeTask`, `attempts`, its `expectedPaths` construction) --
  the completion path this milestone extends additively, and the exact pattern task-verify's own
  dirty-path allowance now reuses.
- `src/git/safety.ts` (`classifyDirtyPaths`, `checkWorkingTreeClean`) -- the real, already-shipped
  primitive `completeTask` already trusts for journal-backed expected-dirty-path classification;
  task-verify reuses it directly rather than reimplementing dirty-path detection.
- This session's own live protocol change (the fingerprint-plus-diff-review evidence-acceptance
  discipline adopted informally during M009's dispatch of T002-T005) -- the exact behavior this
  milestone formalizes into real Core code.

## Change Log

- 2026-08-20: draft revised before confirmation (first pass) -- both open design decisions
  resolved by the developer: evidence resolution is implicit-by-default (newest matching record;
  explicit `--evidence <id>` is a recovery/debugging/testing override, not the primary path); no
  separate approved-command hash is introduced, plain string equality against
  `verification.detail` suffices given the confirmed baseline/amendment workflow already
  protects task definitions, and "approved command/hash" wording is renamed "verification
  command identity" throughout.
- 2026-08-20: draft revised before confirmation (second pass, after a fresh read-only
  architecture-review sub-agent returned one CRITICAL and four MAJOR findings) -- fingerprint
  scope changed from "every currently dirty path" to exactly the task's own normalized
  `write_scope`/`relevant_files` paths (fixing a self-invalidation bug: the mandatory
  `in_progress -> review` transition rewrites `tasks.yaml`, which the old scope would have
  swept in, guaranteeing every completion attempt refused); missing/renamed/git-ignored declared
  paths each given explicit, defined behavior; write_scope comparison is order-independent set
  comparison; a separate out-of-scope dirty-path refusal added at verify time; evidence
  selection rewritten to select the single newest record by (milestone id, task id) alone, with
  attempt/command/write_scope/fingerprint applied as post-selection validation only, never a
  search filter, closing a self-contradiction in the original wording; explicit `--evidence
  <id>` now has its own distinct unknown-id refusal, separate from a diverged-record refusal;
  `--result`/`--message` stated explicitly to remain required inputs unchanged, with accepted
  verification evidence unconditionally authoritative over driver-supplied evidence text; the
  usage-attachment clause removed entirely (it named a capability with no implementing field,
  input, or test anywhere in the original task graph).
- 2026-08-20: draft revised before confirmation (third pass, after a second fresh read-only
  architecture-review sub-agent confirmed all five prior findings resolved but found one new
  CRITICAL in the second pass's own compensating dirty-path check) -- the check refusing any
  dirty path outside `write_scope`/`relevant_files` unconditionally refused on every legal
  invocation, since `tasks.yaml` is always dirty once a task reaches `in_progress` and is never
  itself in `write_scope`; replaced with `task-verify`'s allowed dirty set being constructed
  exactly the way `completeTask`'s own `expectedPaths` already is -- the task's declared scope,
  plus the active milestone's own `tasks.yaml` path unconditionally, plus
  `classifyDirtyPaths(root, {journalMilestone}).expected`'s real, pending-journal-backed paths
  only, never a broad `.pitway/**` allowance -- with the fingerprint itself untouched by this
  change (still exactly `write_scope`/`relevant_files`, workflow-owned paths permitted for the
  dirty-path safety check only, never fingerprinted). Also resolved: T002's "via T001's read
  helpers" wording replaced with the actual caller-side `readJournal`-filtering pattern (no new
  T001 reader commissioned); `git check-ignore` named explicitly as the git-ignore-detection
  primitive, with its own test; the once-evidence-exists no-fallback-to-`--result`/`--message`
  limitation documented for `task-verify.md`; T001's one-task sizing re-confirmed as still
  bounded (four files) rather than split preemptively.
- 2026-08-20: draft revised before confirmation (fourth pass, developer-directed, no additional
  architecture review run) -- a one-sided rename is now explicitly refused rather than described
  as a silent omission: empirically verified (a real temp repo, an unstaged rename, `git status
  --porcelain --untracked-files=all` with and without `--find-renames`) that git never reports an
  unstaged worktree rename as a paired entry, only as a separate delete and a separate untracked
  add -- no new rename-pairing detection is built; instead, the existing dirty-path allowance
  already refuses the undeclared half of a one-sided rename as an out-of-scope dirty path, and
  the refusal's diagnostic now names the specific undeclared path, its git status, and that an
  incompletely-declared rename is a likely cause. Focused tests added for the valid
  both-declared case and both one-sided cases. Other disclosed limitations (once-evidence-exists
  no-fallback, T001 sizing) unchanged. No further architecture review requested per explicit
  developer instruction; awaiting developer confirmation directly.
