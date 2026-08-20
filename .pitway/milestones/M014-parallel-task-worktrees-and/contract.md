---
schema_version: 1
id: M014
title: Parallel task worktrees
status: in_progress
requirement: null
confirmed_at: 2026-08-20T12:18:29Z
verification_approved_hash: sha256:0bce5cc75f4d885540c1a3746ad85129ea7673b25a55e38a5932288725fe376a
base_branch: null
base_revision: null
acceptance_criteria:
  - id: AC001
    text: "Parallel execution is a repository-level, opt-in policy: `configSchema`
      (`src/state/schemas.ts`) gains an additive-optional `execution` block with
      `strategy: z.enum(['sequential', 'parallel_worktrees'])`, mirroring M012's
      `git.branch_strategy` pattern exactly. A
      `resolveExecutionStrategy(config)` helper returns `'sequential'` whenever
      the block is absent — every `config.yaml` written before this milestone,
      and every fresh `pitway init` output (init does not write this field),
      resolves to `sequential` with byte-identical behavior to today: no
      worktree, branch, or dispatch code path is reachable under `sequential`,
      proven by tests that run the full existing task lifecycle under an absent
      and an explicit `sequential` config and assert identical outcomes. (Each
      new command's own sequential-strategy refusal is owned and tested by that
      command's own criterion — AC004/AC006/AC008 — not here.)"
  - id: AC002
    text: "A pure, exported Core function (`src/core/tasks/parallel-eligibility.ts`,
      e.g. `checkParallelEligibility(candidate: Task, concurrent: Task[],
      allTasks: Task[]): EligibilityResult`) decides whether a candidate task
      may run concurrently with the set of ALL currently `in_progress` tasks —
      dispatch-record-backed AND plain inline `in_progress` tasks alike, because
      under `parallel_worktrees` nothing stops a driver from also running a task
      inline in the main tree, and an overlap with an inline task is just as
      much a two-writers hazard as one with a dispatched task. Eligible only
      when ALL hold: (1) the candidate's status is `ready`; (2) no transitive
      dependency relationship exists in either direction between the candidate
      and any concurrent task (derived from `depends_on` via the existing
      dependency-graph module, not re-implemented; this rule is provably
      redundant given rule 1 for well-formed graphs — a ready task's
      dependencies are all completed and no in_progress task is completed — and
      is kept as cheap defense-in-depth in a pure function, with a comment
      saying exactly that); (3) the candidate's `write_scope` is
      pairwise-disjoint with every concurrent task's `write_scope` (exact
      path-string comparison — no globbing or prefix inference in this
      milestone, matching `checkWriteScope`'s existing exact-match semantics);
      (4) the candidate and every concurrent task declare `write_scope` at all —
      a legacy `relevant_files`-style task is never parallel-eligible, because
      its write boundary is not declared precisely enough to prove disjointness.
      The result names the specific failing rule and the conflicting task/paths
      — never a bare boolean. Pure unit tests cover at minimum: independent
      pair, direct dependency, transitive dependency, overlap with a dispatched
      task, overlap with an inline in_progress task, disjoint scopes,
      legacy-task refusal, and empty concurrent set."
  - id: AC003
    text: "A new Git-layer worktree module (`src/git/worktree.ts`) provides
      create/list/remove primitives used only by Core: `createTaskWorktree`
      creates one temporary worktree per task at
      `.pitway-worktrees/<milestoneId>-<taskId>/` under the repository root, on
      a fresh task-scoped scaffolding branch named
      `pitway/task/<milestoneId>-<taskId>` branched from the currently
      checked-out HEAD; it refuses, never reuses or resets, if the worktree path
      or branch already exists (foreign collision and PitWay's own
      crashed-attempt orphan are deliberately not distinguished — both refuse
      identically, matching M012's confirm-branch policy). Two entries are
      appended to `.git/info/exclude` (local only, never the committed
      `.gitignore` — PitWay does not edit user files), each exactly once,
      idempotently: `.pitway-worktrees/` (keeps worktrees out of main-tree
      status) and an anchored `/.pitway-worktree.yaml` (keeps the runtime marker
      out of worker `git status`/`git add -A` AND lets `git worktree remove`
      succeed without `--force` — an untracked marker otherwise blocks removal;
      `--force` is never used on the normal path, and the marker is never
      deleted separately before removal, so a crash can never produce a
      markerless worktree). Each created worktree contains the uncommitted
      `.pitway-worktree.yaml` runtime marker (schema v1: milestone id, task id,
      created-from revision) enabling AC005's guard and AC008's orphan
      detection. `listTaskWorktrees` reports PitWay task worktrees from `git
      worktree list --porcelain` filtered to the managed path prefix, reading
      markers; `removeTaskWorktree` removes exactly one worktree and deletes its
      scaffolding branch, refusing on an unexpected path outside the managed
      prefix; `detectTaskWorktree` resolves the invocation's worktree top-level
      via `git rev-parse --show-toplevel` (never trusting cwd directly, so
      invocation from a subdirectory is still detected) and reads the marker.
      All primitives leave the main working tree, its index, and its checked-out
      branch completely untouched, proven by integration tests against real temp
      git repositories, including a test that removal succeeds without --force
      with the marker present."
  - id: AC004
    text: "A new `pitway task-dispatch <taskId>` command (CLI → Core) prepares one
      task for parallel execution: it refuses under `sequential` strategy
      (AC001); refuses when AC002's eligibility check fails against ALL current
      `in_progress` tasks, naming the rule and conflict; refuses on a dirty main
      working tree using the existing git-safety classification (pending
      journal/state writes remain expected, everything else stops with 'ask the
      developer' — never auto-stash); refuses when any journal-pending
      contract/task amendment exists for the milestone
      (materialized-but-uncommitted amendments are invisible to a worktree's
      committed `.pitway/` copy, so dispatching before the next checkpoint
      commit would hand the worker a stale pre-amendment contract — the
      diagnostic says to complete a checkpoint first); otherwise it performs, in
      this normative order: (1) the `ready → in_progress` transition through the
      existing state-machine/journal path (attempts increment included, exactly
      as `task-update --status in_progress` does), (2) append a new
      `worktree_dispatch` journal record (milestone id, task id, branch,
      worktree path, created-from revision), (3) create the AC003 worktree. A
      crash between (1) and (2) leaves an `in_progress` task with no dispatch
      record — recoverable via the existing `in_progress → failed → ready` path
      and surfaced by AC008's resume labeling; a crash between (2) and (3)
      leaves a vanished-worktree orphan AC008 detects. `--json` output is the
      worker handoff envelope: task id, absolute worktree path, scaffolding
      branch, created-from revision. It deliberately does NOT embed the task
      context bundle: the documented handoff model (AC010) is that the DRIVER
      obtains the bundle via `task-status <id> --context` at the authoritative
      main root and passes it to the worker — matching the existing
      context-isolation model, and avoiding any reliance on in-worktree reads,
      which see a stale committed `.pitway/` copy and an empty per-worktree
      journal. Multiple tasks may be `in_progress` concurrently under
      `parallel_worktrees`; integration tests prove two eligible tasks dispatch
      side by side, a third overlapping task is refused with the specific
      overlap named, an overlap with an INLINE in_progress task is refused, and
      the sequential-refusal, dirty-tree, pending-amendment, and
      ineligible-status refusals all fire."
  - id: AC005
    text: "Authoritative-state protection is fail-closed: EVERY pitway command
      refuses to run when invoked from inside a PitWay task worktree (AC003's
      `detectTaskWorktree`), with a diagnostic naming the worktree's task and
      the authoritative repository root — except an explicit read-only
      allowlist: `resume`, `task-status` (including `--context`),
      `milestone-status` (including `--report`), `milestone-list`, and `verify`
      ONLY with `--status` (the guard is flag-aware for `verify`, whose bare
      form executes commands). Because the polarity is default-deny with an
      enumerated allowlist, commands not individually considered (`init`,
      `write-ms-artifacts`, and every future command including this milestone's
      own task-dispatch/ task-integrate/task-discard) are covered structurally,
      not by enumeration. The worker's contract is thereby mechanical, not
      advisory: a worker inside a worktree can read and mutate no authoritative
      `.pitway/` state — the worktree's own committed `.pitway/` copy is stale
      transport data (it shows pre-dispatch task status, and the per-worktree
      git path resolution means the journal reads as empty there), and the
      allowlisted read-only commands are permitted as a convenience with that
      staleness documented (AC010), never as an authoritative view. Tests prove:
      inside a real created worktree, task-update, task-verify,
      milestone-complete, and one never-enumerated command (e.g. init) all
      refuse with the named diagnostic; task-status --context and verify
      --status still run; verify without --status refuses; everything is
      unchanged in a normal repo root."
  - id: AC006
    text: "A new `pitway task-integrate <taskId>` command integrates one dispatched
      task's work back into the main working tree, diff-apply-model, one task at
      a time: it refuses under `sequential` strategy; refuses when the task has
      no live `worktree_dispatch` record (pointing at task-discard, or at the
      idempotent-re-run path below when an integrate record already exists);
      refuses when the main working tree is dirty beyond expected pending state
      writes; refuses when the worker committed nothing (no commits on the
      scaffolding branch) or when the range diff is empty ('nothing to
      integrate' diagnostic — never a raw git error). The diff is computed as
      the range diff `git diff --binary --no-renames
      <created-from-revision>..<scaffolding branch HEAD>` — pinned flags so
      binary files integrate correctly and deletions/additions are listed
      plainly for scope checking; multi-commit worker branches are integrated as
      one combined diff by construction. Before touching the main tree it
      refuses if any changed path (including deletions) falls outside the task's
      declared `write_scope` or touches `.pitway/` or the
      `.pitway-worktree.yaml` marker (scope violation names every offending
      path). Apply is pre-checked (`git apply --check`) before any write: a diff
      that does not apply cleanly refuses atomically — main tree unchanged,
      worktree preserved for inspection, task stays `in_progress`; PitWay never
      invents a merge. The success path order is normative: (1) apply the diff,
      leaving it uncommitted and unstaged; (2) append a `worktree_integrate`
      journal record carrying the worker's scaffolding-branch HEAD SHA as
      evidence-only transport metadata (never persisted into tasks.yaml —
      decision 4 unchanged; the SHA becomes dangling after cleanup by design);
      (3) remove the worktree and scaffolding branch (AC003's remove). Crash
      recovery is defined for both windows and a re-run is always safe: a re-run
      that finds a matching `worktree_integrate` record performs cleanup only
      (step 3) and reports success — the 'cleanup pending' case; a re-run in the
      applied-but-unrecorded window (main tree dirty with exactly this diff:
      forward `git apply --check` fails but reverse-apply check succeeds)
      reports 'already applied, pending journal record and cleanup' and
      completes steps 2-3 — never a bare refusal, and task-discard is NOT the
      answer in either window (the work is sitting applied in the main tree).
      Completion then flows through the EXISTING, unchanged path: the driver
      runs the authoritative `task-verify <id>` in the main tree (while the task
      is still `in_progress`), then `task-update <id> --status review`, then
      `--status completed`, producing the one atomic commit per task containing
      code + same-task state update with PitWay-Milestone/PitWay-Task trailers.
      No merge commit, no persisted task branch, no second commit shape:
      mainline history after parallel execution is structurally
      indistinguishable from sequential execution — with one disclosed,
      precedented nuance: a task's completion commit may carry a
      concurrently-dispatched sibling's `in_progress`/attempts state in the same
      `tasks.yaml` write, exactly as dependent-task promotions already ride
      along today, and `findCompletionCommit`'s parsed comparison already
      ignores sibling changes."
  - id: AC007
    text: "Verification authority is single-sourced: the authoritative verification
      for a dispatched task is the existing main-tree `task-verify <id>` run
      after integration while the task is still `in_progress` (before `review`),
      unchanged in mechanism, hash-gating, and evidence recording. Anything a
      worker runs inside its worktree (its own test invocations, its own checks)
      is advisory working practice, produces no authoritative
      `task_verify_evidence`, and cannot — per AC005's guard — write any;
      additionally, in-worktree journal path resolution is per-worktree, so
      worktree-written evidence could never reach the authoritative journal
      anyway. This disposition is stated in the contract body's design decisions
      and documented in AC010's protocol-doc updates; tests prove task-verify
      refuses inside a worktree (shared with AC005) and that a post-integration
      main-tree task-verify of a dispatched task's work records evidence exactly
      as a sequential task's would."
  - id: AC008
    text: "A new `pitway task-discard <taskId>` command abandons one dispatched
      task's worktree without integrating: refuses under `sequential` strategy;
      requires an explicit `--reason <text>`; removes the worktree and
      scaffolding branch (tolerating an already-vanished worktree); appends a
      `worktree_discard` journal record (task id, reason, discarded branch HEAD
      SHA as evidence-only metadata when resolvable); and transitions the task
      `in_progress → failed` through the existing state machine (whence the
      existing `failed → ready` path allows re-dispatch; discarded work is
      unrecoverable through PitWay and the command's output says so). To keep
      the discard path the single exit for a live dispatch, `task-update
      --status blocked` (and any other status change that would bypass it)
      refuses on a task with a live `worktree_dispatch` record, pointing at
      task-integrate or task-discard — a dispatched task's only legal
      transitions from the main root are through those two commands until its
      record is closed. Orphan and residue detection: `pitway resume` under
      `parallel_worktrees` classifies and reports, read-only, every abnormal
      combination: (a) a live dispatch record whose worktree has vanished
      (crashed before creation, or externally deleted); (b) a managed-prefix
      worktree with no matching record (foreign or pre-crash); (c) a worktree
      whose dispatch record is closed by an integrate record — 'cleanup
      pending', resolved by re-running task-integrate (AC006's idempotent
      re-run); (d) an `in_progress` task with no dispatch record — labeled
      'inline or interrupted dispatch' (legitimate inline work and a crash
      between transition and journal-append are indistinguishable, and the label
      says so). `resume`'s `--json` shape is extended additively (keys always
      present; sequential repos byte-identical human output). Integration tests
      cover discard-then-redispatch, blocked-refusal on a live dispatch, all
      four residue classifications, and sequential repos unchanged."
  - id: AC009
    text: "One end-to-end lifecycle test
      (`tests/integration/parallel-worktrees-lifecycle.test.ts`, following
      M012's `branch-isolation-lifecycle` naming convention) proves the full
      parallel lifecycle against a real temp git repository: a confirmed
      milestone with two dependency-independent, write-scope-disjoint tasks plus
      one dependent task; both independent tasks dispatched concurrently
      (`task-dispatch` × 2), work simulated by committing distinct files in each
      worktree (within each task's write_scope), then integrated one at a time
      in ascending task-id order, each followed by the authoritative main-tree
      task-verify and the review → completed atomic commit; the dependent task
      then becomes ready and completes sequentially. Assertions: final mainline
      history is exactly baseline + one atomic trailer-carrying commit per task,
      in integration order, with no merge commits and no surviving
      `pitway/task/*` branches or `.pitway-worktrees/` entries; final `.pitway/`
      state is structurally equivalent to sequential execution's (statuses,
      attempts, results-present, promotion order — NOT byte equality, since
      result evidence embeds durations/timestamps). Additional cases: the
      conflict path (a worker commit touching a path outside write_scope is
      refused at integrate, preserving the worktree and leaving the main tree
      byte-identical), and the `branch_strategy: milestone` interaction
      (dispatch worktrees branch from the milestone branch;
      integration/completion land on it; `assertOnMilestoneBranch` still holds;
      the base branch stays untouched)."
  - id: AC010
    text: "The installed Claude protocol assets document the real delivered
      mechanism, driver-parallelizes/PitWay-gates honesty included:
      `protocol-driver.md` gains a parallel-dispatch section (when to prefer
      parallel dispatch; the dispatch → driver-passes-bundle → worker-commits →
      integrate → authoritative task-verify → review → completed sequence;
      ascending-task-id deterministic integration order as the stated driver
      convention; the task-discard/orphan/ cleanup-pending recovery paths mapped
      to AC008's resume classifications; and the explicit disclosure that PitWay
      enforces eligibility/scope/state boundaries but never spawns, schedules,
      or monitors workers — the driver does, and PitWay cannot verify how many
      workers actually ran concurrently); `coordination.md`'s shared-worktree
      hazard section gains its parallel-mode counterpart: under
      `parallel_worktrees` the main tree stays clean during worker execution,
      the stale-snapshot hazard moves to the integrate boundary (always
      re-derive tree status after each integrate, never carry a pre-dispatch
      snapshot), and a worktree's own `.pitway/` copy is stale read-only
      transport — it shows pre-dispatch state and an empty journal, so workers
      and drivers must never treat in-worktree reads as authoritative; the
      worker-side assets (`protocol-worker.md` / `dispatch.md`) state the worker
      contract: work only inside the assigned worktree, only within write_scope,
      commit locally on the scaffolding branch, never run state-mutating pitway
      commands (AC005 enforces this mechanically), never merge/rebase/push, and
      report the scaffolding-branch HEAD SHA back. QA guidance: milestone-level
      QA/review may run in a read-only checkout or a dedicated non-task
      worktree, never in a task's own worktree. Each of the three new commands
      gains its own command doc (`commands/task-dispatch.md`,
      `commands/task-integrate.md`, `commands/task-discard.md`) following the
      existing per-command doc convention. Asset discovery is DYNAMIC
      (`listClaudeAssets` readdirs the integration directory; the copy script
      globs) — no hardcoded manifest exists to update; instead, the existing
      asset tests gain assertions that the three new command docs are shipped by
      `listClaudeAssets` and installed by `pitway init`. The asset-count change
      (31 → 34) is recorded in `IMPLEMENTATION_PLAN.md` §9 prose by AC011's
      reconciliation, not in code."
  - id: AC011
    text: "`IMPLEMENTATION_PLAN.md` is reconciled with the delivered design,
      including the explicit disposition of the four points where this milestone
      touches previously-recorded positions: (1) §10's 'no
      worktrees/stashes/automatic merges; sequential execution (MVP, preserved
      decision)' line is rewritten to state that sequential remains the default
      and `parallel_worktrees` is the delivered opt-in, with stashes and
      automatic merges still never used; (2) §10/§15's 'no per-task branch of
      any kind — milestones may own a branch, tasks never do' durable principle
      is reworded to its delivered precise form: tasks never own PERSISTENT
      branches — the `pitway/task/*` scaffolding branch exists only between
      dispatch and integrate/discard, never enters mainline history (diff-apply,
      never merge), and is always deleted with its worktree; the reconciliation
      notes this resolves an internal plan contradiction (the roadmap's own M014
      entry already sanctioned 'one temporary worktree + task branch per
      dispatched task' against §10's absolute wording) in the roadmap's favor;
      (3) the one-atomic-commit-per-task invariant is stated as preserved
      byte-for-byte under both strategies, with the disclosed
      sibling-state-rider nuance (AC006); (4) the worker-verification refinement
      is named as a deviation from the roadmap entry's literal wording: the
      entry says each worker 'returns a verified result + commit SHA', the
      delivery makes worker-side checks advisory and the post-integration
      main-tree task-verify authoritative, with the reasons recorded (worktree
      evidence cannot reach the authoritative journal; only a post-integration
      run observes the landed state). §7's command list/count reflects the three
      new commands (18 → 21); §9's asset count moves to 34; the Bootstrap
      delivery table adds M013's row (self-referential discipline: M014's own
      row is left for the next milestone's reconciliation); the Revised
      Roadmap's M014 entry is rewritten from placeholder to actual delivery; the
      Status paragraph is updated. Follows the established revision-header
      convention."
  - id: AC012
    text: "The full existing test suite and typecheck pass with the complete
      milestone integrated: `npm test` (all tiers) and `npx tsc --noEmit` both
      clean, run as milestone-level gates exactly once at verification time per
      the verification-granularity discipline — proving parallel support
      introduced no regression to the sequential path, whose behavior with
      `execution` absent remains byte-identical."
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npm test -- tests/unit/schemas.test.ts
      tests/integration/execution-strategy.test.ts
  - id: CT002
    criterion: AC002
    type: command
    command: npm test -- tests/unit/parallel-eligibility.test.ts
  - id: CT003
    criterion: AC003
    type: command
    command: npm test -- tests/integration/git-worktree.test.ts
  - id: CT004
    criterion: AC004
    type: command
    command: npm test -- tests/integration/task-dispatch.test.ts
      tests/unit/journal.test.ts
  - id: CT005
    criterion: AC005
    type: command
    command: npm test -- tests/integration/worktree-state-guard.test.ts
  - id: CT006
    criterion: AC006
    type: command
    command: npm test -- tests/integration/task-integrate.test.ts
      tests/integration/task-integrate-recovery.test.ts
  - id: CT007
    criterion: AC007
    type: command
    command: npm test -- tests/integration/task-integrate-recovery.test.ts
      tests/integration/worktree-state-guard.test.ts
  - id: CT008
    criterion: AC008
    type: command
    command: npm test -- tests/integration/task-discard.test.ts
      tests/integration/resume.test.ts
  - id: CT009
    criterion: AC009
    type: command
    command: npm test -- tests/integration/parallel-worktrees-lifecycle.test.ts
    timeout_ms: 300000
  - id: CT010
    criterion: AC012
    type: command
    command: npm test
    timeout_ms: 600000
  - id: CT011
    criterion: AC012
    type: command
    command: npx tsc --noEmit
    timeout_ms: 300000
  - id: CT012
    criterion: AC010
    type: review
    instruction: Read the delivered protocol-asset changes (protocol-driver.md
      parallel-dispatch section, coordination.md parallel-mode counterpart,
      protocol-worker.md/dispatch.md worker contract, three new command docs)
      against AC010's required content list and against the actually-delivered
      command behavior — confirm every claim the docs make matches real, tested
      behavior, the completion sequence includes the review state, the
      driver-parallelizes/PitWay-gates and stale-worktree-view disclosures are
      present, the QA read-only/dedicated-worktree guidance is stated, and the
      asset tests assert the three new docs ship and install (no hardcoded
      manifest claims anywhere).
  - id: CT013
    criterion: AC011
    type: review
    instruction: Read the reconciled IMPLEMENTATION_PLAN.md against AC011's list —
      confirm all four dispositions are explicitly written (sequential-default
      rewrite, persistent-branch rewording with the internal-contradiction note,
      atomic-commit preservation with the sibling-rider nuance, the
      worker-verification deviation with reasons), the command surface (21) /
      asset count (34) / Bootstrap table / Roadmap entry / Status updates are
      accurate against the delivered code, and no historical M001-M013 text was
      rewritten beyond the sanctioned reconciliation points.
---

# M014 — Parallel task worktrees

## Objective

Deliver the roadmap's M014 entry: opt-in parallel execution for tasks proven
independent (dependency graph + pairwise-disjoint `write_scope`), one
temporary worktree + scaffolding branch per dispatched task, workers that can
never touch authoritative milestone state, and deterministic driver-side
integration that preserves every existing history invariant — one atomic
commit per task, no merge commits, no persistent task branches.

## Design decisions (binding for this milestone)

1. **Diff-apply integration, never merge.** The worker's worktree commit is
   transport + verification evidence only. `task-integrate` applies the
   content diff (pinned: `git diff --binary --no-renames`, range from
   created-from revision to branch HEAD) to the main working tree and the
   *existing* task-completion path creates the single atomic commit (code +
   same-task state update + trailers). Because concurrent write scopes are
   pairwise-disjoint and `.pitway/` is excluded from worker diffs, the
   diffs commute — integration order can change commit order, never
   content. Mainline history after parallel execution is structurally
   indistinguishable from sequential execution. This preserves §10's
   atomic-commit invariant and §15's branch principle (recast as: tasks
   never own *persistent* branches; `pitway/task/*` scaffolding branches
   never enter history and are always deleted).
2. **PitWay gates; the driver parallelizes.** PitWay never spawns,
   schedules, or monitors workers (not a multi-agent framework — non-goal
   preserved). It provides eligibility checking, worktree lifecycle,
   mechanical state protection, and integration validation. Concurrency is
   the driver's. One-integration-at-a-time is mechanically real: an
   applied-but-uncommitted diff dirties the main tree, so the next
   integrate refuses until completion commits.
3. **Authoritative state lives only in the main tree, fail-closed.** A
   worktree's committed `.pitway/` copy is stale transport (pre-dispatch
   state; per-worktree git-path resolution makes the journal read empty
   there). AC005 makes this mechanical with default-deny polarity: every
   command refuses inside a task worktree except an enumerated read-only
   allowlist — future commands are covered structurally.
4. **Verification authority is the main tree.** Worker-side checks are
   advisory; the post-integration `task-verify` (run while `in_progress`,
   before `review → completed`) is the one authoritative record. This is a
   named refinement of the roadmap entry's 'returns a verified result'
   wording — worktree-written evidence could never reach the authoritative
   journal, and only a post-integration run observes the landed state
   (AC011 disposition 4).
5. **Sequential stays the default, byte-identical.** `execution.strategy`
   absent ⇒ `sequential` ⇒ no new code path reachable. Mirrors M012's
   `branch_strategy` opt-in discipline, including its provably-unaffected
   test standard.
6. **Deterministic integration order is a driver convention, PitWay-validated
   per step.** PitWay enforces one-integration-at-a-time, clean-tree, scope
   and apply checks on each integrate; ascending-task-id order among
   finished tasks is documented driver protocol (AC010), not Core
   scheduling — Core has no scheduler.
7. **Refuse loudly, recover explicitly, resume can always name the state.**
   Every crash window in dispatch and integrate maps to a defined,
   resume-describable residue class (AC008's four classifications) with a
   sanctioned recovery command; integrate re-runs are idempotent (AC006).
   Collisions, conflicts, and scope violations refuse with named
   diagnostics and leave the main tree untouched; recovery is explicit
   (`task-discard` → `failed` → `ready`, or integrate's own re-run), never
   automatic repair.
8. **Bootstrap disclosure.** M014's own tasks share `schemas.ts` /
   `journal.ts` / `cli/index.ts` across write scopes and are therefore
   mutually parallel-ineligible under M014's own rules — this milestone
   builds parallel execution while itself executing sequentially; the
   first real parallel dispatch is a later milestone's.

## Scope boundaries

- No scheduler, no worker spawning, no concurrency limits, no progress
  monitoring of live workers — driver territory.
- No globbing/prefix semantics in write-scope disjointness — exact path
  comparison only (a future milestone may widen this).
- No parallel QA execution mechanism — QA worktree guidance is
  documentation (AC010), not code.
- No changes to worker report format (`report-format.md` capped shape
  unchanged) or to the context-bundle mechanism.
- Sequential execution path: zero behavior change.

## Change Log

- 2026-08-20 — Initial draft (M014, drafted after M013's completion per the
  roadmap's renumbered M014 entry).
- 2026-08-20 — Draft revised before confirmation, folding in two
  independent pre-confirmation reviews (Senior SWE + Senior Architect):
  title shortened; eligibility widened to all in_progress tasks (inline
  included); AC005 guard made fail-closed default-deny and flag-aware;
  marker file added to info/exclude (removal otherwise needs --force);
  integrate diff mechanics pinned (--binary --no-renames, empty-diff and
  deletion handling) and crash-window/idempotent-re-run semantics defined;
  orphan taxonomy widened to four resume-describable residue classes;
  dispatch refuses on journal-pending amendments (stale-bundle hazard);
  bundle handoff pinned to driver-passes-bundle; completion sequence
  corrected to include the review state; AC010's nonexistent-manifest
  claim corrected to dynamic-discovery reality; AC011 gains the
  worker-verification deviation as disposition (4); task-integrate split
  into engine + command/recovery tasks (11 tasks total).
