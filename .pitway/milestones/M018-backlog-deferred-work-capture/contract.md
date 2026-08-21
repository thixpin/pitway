---
schema_version: 1
id: M018
title: Backlog / Deferred Work Capture
status: in_progress
requirement: R002
confirmed_at: 2026-08-21T13:58:13Z
verification_approved_hash: sha256:33ff6b93b3f191d935c24f842ace541da48072372dc1056f38bbcda5254a3252
base_branch: main
base_revision: 34ae864e4ee836e2a0e5fe503b2e6c6783917365
acceptance_criteria:
  - id: AC001
    text: "A new, root-level, git-tracked, schema-validated state file
      `.pitway/backlog.yaml` (schema v1, absent-tolerant like
      `verification-repairs.yaml`/`reviews.yaml`) becomes the single
      authoritative store for deferred-work items, loaded/saved through
      `src/state/store.ts` (`loadBacklog`/`saveBacklog`, mirroring
      `loadState`/`saveState`'s root-level, non-milestone-scoped pattern — not
      `loadTasks`/`loadReviews`'s per-milestone-directory pattern, since a
      backlog item's lifetime is not bound to any one milestone's directory or
      lifecycle). Each item: `id` (sequential `B###`, minted by scanning the
      currently-loaded `items` array's existing ids and taking max+1, the same
      in-memory-scan idiom `nextSequentialTaskId` already uses for `tasks.yaml`
      — never a directory scan, and never a random/hash id, since this id is
      meant to be typed and cited in conversation the same way `M000`/`T000` ids
      are); `title` (non-empty, capped at a reasonable length); `reason`
      (non-empty prose capturing why this was deferred); `status` (`pending |
      promoted | archived`, both `promoted` and `archived` terminal); `source`
      (`{ milestone, task }`, both optional/nullable — when given, each must
      reference a milestone/task that actually exists at creation time,
      validated against `state.yaml`/that milestone's `tasks.yaml`, catching a
      typo rather than accepting free-text traceability that silently drifts);
      `created_at` (ISO timestamp); `resolved_at` (ISO timestamp, null until
      promoted/archived); `promoted_to` (`{ milestone, task }`, present only
      once `status: promoted` — same two-field shape as `source`, not a `{type,
      id}` discriminated reference: task ids are milestone-scoped, not globally
      unique (`nextSequentialTaskId` scans only the current milestone's own
      `tasks.yaml`, confirmed by inspection), so a bare `{type: 'task', id:
      'T004'}` would be ambiguous — which milestone's T004? — and
      `promoted_to.milestone` is required whenever `promoted_to.task` is
      present); `archived_reason` (present only once `status: archived`). A
      backlog item created during an active workflow preserves the active
      milestone as `source` context by default: `source.milestone` defaults to
      `state.active_milestone` whenever `backlog add`'s `--milestone` is omitted
      (never left null just because the flag wasn't passed). This default
      applies to `source.milestone` only — `source.task` has no equivalent
      auto-detection (PitWay has no `state.yaml`-level 'current task' concept
      the way it has `active_milestone`: multiple tasks can be `in_progress` at
      once under `execution.strategy: parallel_worktrees`, so guessing one would
      be unsound); it is recorded only when `--task` is given explicitly. These
      `--milestone`/`--task` flags on `add` are purely descriptive `source`
      annotations — see AC004 for the separate, unrelated concept of which
      milestone a mutation's journal entry attaches to."
  - id: AC002
    text: "Every backlog mutation (`add`/`promote`/`archive`) is validated by the
      same explicit state-machine discipline every other PitWay lifecycle
      already uses: `pending -> promoted` and `pending -> archived` are the only
      two transitions; every other requested transition (promoting an
      already-promoted or archived item, archiving an already-archived or
      promoted item) is rejected by name, never silently accepted or no-op'd.
      `promote <id> --task <task-id> [--milestone <milestone-id>]` requires the
      referenced task to **already exist**. `--milestone`/ `--task` here mean
      the promotion **target** only — never the journal- attachment milestone
      (that is always the active milestone; see AC004) — and `--milestone`
      defaults to `state.active_milestone` when omitted, since task ids are
      milestone-scoped (a bare `--task T004` is otherwise ambiguous — which
      milestone's T004?); an explicit `--milestone` promotes into a task
      belonging to a different, already-existing milestone. `backlog promote`
      never creates a task or milestone itself; it is a pure terminal-transition
      linking an already-drafted piece of planned work back to its backlog
      origin, mirroring `promoteQuickChange`'s identical boundary
      (`src/core/quick-change/promote.ts`): the driver runs
      `task-add`/`milestone-add` first, through the normal human-confirmed
      pipeline, then `backlog promote` records the link and closes the item out.
      Traceability is preserved via `backlog.yaml`'s own `source`/`promoted_to`
      pair (`pitway backlog show <id>` answers both 'where did this come from'
      and 'what did it become') — no forward- pointer field is added to
      `taskSchema`/`contractFrontmatterSchema`; considered and rejected as
      unneeded for marginal benefit against two shared schemas."
  - id: AC003
    text: "Backlog mutations reuse the existing checkpoint-eligible journal
      machinery exactly the way `task-add` and `task-amend` both already reuse a
      single `task_amendment` operation type for more than one kind of mutation
      — a new `backlog_recording` member is added to
      `journalOperationTypeSchema` in `src/state/journal.ts` (its fifth member,
      alongside `usage_recording`/`contract_amendment`/
      `task_amendment`/`review_recording`), and every `add`/`promote`/ `archive`
      appends a `journalEntrySchema` entry of that type via the existing
      `appendJournalEntry` — never a new discriminated-union `kind` sibling
      (`quick_change`/`auto_run`/etc. exist because those operations have no
      future-commit target to fold into; a backlog mutation does).
      `resolveTargetPath` (`src/core/journal/operations.ts`) gains one
      additional case: `backlog_recording -> '.pitway/backlog.yaml'` — a
      root-level path, so the function's existing `milestoneDir` parameter is
      simply unused on this branch, exactly as it already is unused by no other
      case today but is structurally free to be. No change to
      `journalEntrySchema`, `derivePending`, or `reconcilePending` is needed —
      both are already fully type-agnostic beyond `resolveTargetPath`'s mapping
      (verified directly: `derivePending` filters only on `kind === 'entry'` and
      checkpoint status; `reconcilePending` (`src/state/journal.ts:453-500`)
      calls `resolveTargetPath(entry, milestoneDir)` and does a byte-for-byte
      disk-vs-`HEAD` comparison with no per-type branching at all)."
  - id: AC004
    text: "All backlog journal mutations attach to the currently active milestone
      (`state.yaml`'s `active_milestone`). **No override is supported — this is
      a safety invariant, not an ergonomic default.** Unlike `task-amend`'s
      `resolveActiveMilestone` (explicit-override-or- fallback), backlog
      deliberately does **not** offer an override, because
      `.pitway/backlog.yaml` is the first journal-backed target that is not
      exclusively owned by the milestone its entry is attributed to — every
      other `resolveTargetPath` case maps into that milestone's own private
      directory, making misattribution structurally impossible today. An
      override would let a pending `backlog_recording` entry be attached to a
      milestone other than the one actually in progress, including — since
      nothing would stop it — an already-completed or -cancelled one, which will
      never produce another commit and so could never reconcile that pending
      entry, with no built-in repair path (a review finding this milestone's
      contract was revised specifically to close, not merely disclose). No CLI
      flag on `add`/`promote`/`archive` controls journal attachment; `backlog
      add`'s `--milestone`/`--task` and `backlog promote`'s
      `--milestone`/`--task` are unrelated, purely referential flags (source
      annotation and promotion target, respectively — see AC001/AC002). Refuses
      with `no active milestone; run milestone-add or resume the active one
      first` when `state.active_milestone` is `null` — deliberately worded
      differently from `task-amend`'s `no active milestone; pass a milestone id
      explicitly`, since backlog offers no such flag to pass. No
      milestone-status gating beyond that (unlike `task-add`, which refuses on
      `draft`/`review`/`completed`/`cancelled`): a backlog mutation never
      touches `tasks.yaml` or `contract.md`, so the task-graph-growth risk that
      motivates `task-add`'s stricter gating does not apply here, and
      `state.active_milestone` is already `null` for exactly the
      `completed`/`cancelled` states by construction (`saveState(..., {
      active_milestone: null })` in both `milestones/complete.ts` and
      `milestones/cancel.ts`, confirmed by inspection). There is deliberately
      **no global/no-milestone backlog** in this milestone — a repository with
      no active milestone cannot run any `backlog add`/`promote`/ `archive`;
      disclosed limitation, not solved here."
  - id: AC005
    text: "Because a backlog mutation's journal entry is always attached to the
      active milestone (AC004), `.pitway/backlog.yaml` automatically becomes a
      sanctioned dirty path through the existing, unmodified
      `classifyDirtyPaths({ ..., journalMilestone })` allowlist
      (`src/git/safety.ts:79-99`) the moment a pending `backlog_recording` entry
      exists — the same mechanism that already lets a pending `task_amendment`
      coexist with an in-progress task's own dirty `write_scope`. No change to
      `classifyDirtyPaths`, `assertDirtySubset`, `tasks/update.ts`,
      `milestones/confirm.ts`, `milestones/complete.ts`, or
      `verification/repair.ts` is required — all already pass `journalMilestone`
      generically. `reconcilePending`/`classifyDirtyPaths` both resolve the
      entry's milestone directory (`resolveMilestoneDirName`) before calling
      `resolveTargetPath`, even though `backlog_recording`'s root-level target
      doesn't itself need it — a coupling a reviewer flagged. AC004 makes this a
      non-issue in practice rather than requiring backlog-specific branching in
      either function: a milestone's directory is created by
      `milestone-add`/`replaceMilestoneDraft` at the moment it is *created*,
      strictly before `state.active_milestone` can ever be set to it, so the
      active milestone's directory always exists by construction —
      `resolveMilestoneDirName` cannot fail for a `backlog_recording` entry's
      milestone the way it hypothetically could have for an override-supplied,
      possibly-stale one. No further code change to
      `reconcilePending`/`classifyDirtyPaths` is made. A backlog item added
      mid-task is folded into whatever commit the current task, or the
      milestone's own checkpoint, next produces — never a dedicated commit of
      its own — via the existing, unmodified `reconcilePending`."
  - id: AC006
    text: "CLI surface: `pitway backlog add --title <t> --reason <r> [--milestone
      <id>] [--task <id>]` (the milestone/task flags here are `source`
      annotation only — AC001), `pitway backlog list [--status
      pending|promoted|archived]`, `pitway backlog show <id>`, `pitway backlog
      promote <id> --task <task-id> [--milestone <milestone-id>]` (these mean
      the promotion target only — AC002), `pitway backlog archive <id> --reason
      <text>` (deliberately **no** `--milestone`/`--task` flag — archiving names
      no other milestone/task, and journal attachment is never flag-controlled
      per AC004) — a parent `backlog` command with five subcommands, following
      `src/cli/commands/quick-change.ts`'s existing parent/subcommand wiring
      template (every subcommand supports `--json`; human-mode output follows
      `src/cli/format.ts`'s existing rendering conventions). The
      registered-command surface grows from 23 to 24; `tests/integration/
      cli.test.ts`'s `ALL_COMMAND_NAMES` and its 'registers all N commands'
      count, and `tests/integration/build-bin.test.ts`'s separately-maintained
      real-binary command list, are both updated in this same milestone.
      `backlog add/promote/archive` are state-mutating and are therefore
      automatically refused inside a task worktree by
      `src/cli/worktree-guard.ts`'s existing default-deny `READ_ONLY_COMMANDS`
      allowlist (no code change needed there — proven by a test, not assumed);
      `backlog list/show` are read-only but, matching `quick-change status`'s
      own existing precedent, are deliberately **not** added to that allowlist
      either — backlog inspection stays driver-owned, not a worker capability."
  - id: AC007
    text: "`pitway resume` gains a read-only `pendingBacklogItems` view (count and
      list of `status: pending` items, a `--json` key and a human-rendered
      block) mirroring `pendingQuickChanges`'s existing rendering exactly
      (`src/cli/commands/resume.ts`) — additive only, no gating or behavioral
      change to `resume`'s existing recommendations. Every exact-shape `--json`
      assertion this additive key could break is updated in the same task:
      `tests/integration/fresh-session-resume.test.ts` and
      `tests/integration/resume.test.ts`."
  - id: AC008
    text: "Documentation and shipped Claude assets are updated to reflect the new
      capability without inventing new mechanism: a
      `.claude/commands/backlog.md` slash-command asset (mirrored into
      `src/integrations/claude/commands/` the same way every other shipped
      command doc already is, so `pitway init`'s default installation picks it
      up automatically — no new copy-script logic, reusing the existing
      recursive-discovery glob); `.claude/protocol-driver.md`'s 'Choosing a
      correction mechanism' section gains backlog as the option for out-of-scope
      work discovered mid-task (distinct from `task-add`, which is for work that
      belongs inside the *current* milestone's own task graph, and requires an
      active milestone exactly like `task-add` does); `USAGE.md` documents the
      five subcommands. Every shipped-asset assertion this new file touches is
      updated in the same task: `tests/unit/claude-assets.test.ts` and
      `tests/integration/init.test.ts`."
  - id: AC009
    text: "A roadmap-reconciliation review (mirroring M005/T009, M006/T006,
      M007/T013, M008/T005's identical precedent and identical self-referential
      timing discipline — M018's own row is correctly omitted, left for a future
      M019 reconciliation task) confirms IMPLEMENTATION_PLAN.md accurately
      reflects M018's actual delivery: the command-surface count (23 -> 24); the
      Bootstrap delivery table gains any still-missing prior-milestone row; and
      the existing '## Backlog / Pending Candidates' section is given an
      explicit redirect note stating that, going forward, new deferred-work
      items are captured via `pitway backlog add` and `.pitway/backlog.yaml` /
      `pitway backlog list` is now the live, authoritative source — the
      section's existing entries remain as a frozen historical record, not
      retroactively migrated or deleted. No new doc-generation/auto-sync code is
      added — the reconciliation stays the same hand-authored review discipline
      this document already uses at every prior milestone boundary."
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npm test -- tests/unit/schemas.test.ts tests/unit/state-store.test.ts
  - id: CT002
    criterion: AC002
    type: command
    command: npm test -- tests/unit/backlog-state.test.ts
  - id: CT003
    criterion: AC003
    type: command
    command: npm test -- tests/unit/journal.test.ts
  - id: CT004
    criterion: AC004
    type: command
    command: npm test -- tests/integration/backlog.test.ts
  - id: CT005
    criterion: AC005
    type: command
    command: npm test -- tests/integration/backlog.test.ts
      tests/unit/git-safety.test.ts tests/integration/task-update.test.ts
  - id: CT006
    criterion: AC006
    type: command
    command: npm test -- tests/integration/cli.test.ts
      tests/integration/build-bin.test.ts tests/integration/backlog.test.ts
  - id: CT007
    criterion: AC007
    type: command
    command: npm test -- tests/integration/resume.test.ts
      tests/integration/fresh-session-resume.test.ts
  - id: CT008
    criterion: AC008
    type: command
    command: npm test -- tests/unit/claude-assets.test.ts tests/integration/init.test.ts
  - id: CT009
    criterion: AC009
    type: manual
    instruction: Confirm IMPLEMENTATION_PLAN.md's command-surface count reads 24,
      the Bootstrap delivery table correctly omits M018's own row, and the
      Backlog / Pending Candidates section carries the redirect note naming
      pitway backlog add/list as the live authoritative source without migrating
      or deleting its existing frozen entries.
  - id: CT010
    criterion: AC001
    type: command
    command: npm test
---

# Contract — M018: Backlog / Deferred Work Capture

## Objective

Give PitWay a controlled, first-class mechanism for capturing work
discovered during an existing milestone/task that is intentionally out of
scope — a deferred-work "backlog" item with a stable id, preserved source
context, and an explicit `pending -> promoted | archived` lifecycle —
without ever silently expanding the current task or milestone's own scope.
This closes the workflow gap named in the requirement: *discover → capture
→ defer → continue current work → later promote into planned work.*

## Scope

- A new root-level, git-tracked `.pitway/backlog.yaml` (schema v1) as the
  single authoritative store for deferred-work items (AC001).
- Explicit lifecycle validation (`pending -> promoted | archived`, both
  terminal), reusing PitWay's existing state-machine discipline; `promote`
  as a pure link-and-close terminal transition against an
  already-existing milestone/task, never an auto-creation path (AC002).
- Journal integration reuses the existing checkpoint-eligible entry
  machinery via one new `backlog_recording` operation type and one new
  `resolveTargetPath` case — never a new commit primitive or trailer
  (AC003).
- Backlog mutations require an active milestone, attach their journal
  entry to it unconditionally (no override), and are folded into whatever
  commit that milestone's workflow next produces — via the existing,
  unmodified `classifyDirtyPaths`/`reconcilePending` machinery (AC004,
  AC005).
- CLI surface: `backlog add/list/show/promote/archive`, all `--json`-
  capable, following the existing `quick-change` command-family template
  (AC006).
- Read-only `pendingBacklogItems` surfaced in `pitway resume` (AC007).
- Shipped `.claude/commands/backlog.md` asset, `protocol-driver.md` and
  `USAGE.md` updates naming backlog as the correction-mechanism option for
  out-of-scope discoveries (AC008).
- Roadmap reconciliation: IMPLEMENTATION_PLAN.md's command-surface count,
  Bootstrap delivery table, and existing Backlog / Pending Candidates
  section redirect note (AC009).

## Invariants

1. Backlog mutation requires an active milestone.
2. Every backlog mutation is represented by the `backlog_recording` journal
   operation type.
3. `.pitway/backlog.yaml` is the authoritative backlog state.
4. A backlog mutation performed during an active task must not violate the
   task's existing dirty-tree/scope invariant solely because
   `.pitway/backlog.yaml` changed.
5. A promoted backlog item must preserve traceability to the backlog item
   from which it originated.
6. Journal attachment for every backlog mutation is always
   `state.active_milestone`, with no CLI-controllable override; `--milestone`/
   `--task` on `add` (source annotation) and on `promote` (promotion target)
   are unrelated concepts that never redirect journal attachment.

## Non-Goals

- **No auto-creation of tasks/milestones on promote.** `backlog promote`
  only links and closes an already-drafted, already-confirmed piece of
  planned work back to its origin — it never runs `task-add`/
  `milestone-add` itself, and never infers scope on its own.
- **No AI issue classification.** Nothing in this milestone decides
  autonomously that something *should* become a backlog item — that
  judgment stays with whoever (developer or driving agent) calls
  `backlog add`.
- **No global/no-active-milestone backlog.** A backlog mutation with no
  active milestone fails clearly rather than creating an unscoped item;
  supporting a genuinely milestone-independent backlog is out of scope for
  this milestone (see AC004).
- **No journal-attachment override.** Added during milestone review: no
  CLI flag on any backlog subcommand can redirect a mutation's journal
  entry to a milestone other than the currently active one — see AC004
  and its Design Decisions entry.
- **No forward-pointer schema field** (`source_backlog` on `taskSchema`/
  `contractFrontmatterSchema`) — considered and rejected; `backlog.yaml`'s
  own `source`/`promoted_to` pair already gives complete bidirectional
  traceability without widening two shared schemas for marginal benefit.
- **No dedicated backlog commit mechanism, no new git primitive, no new
  commit trailer.** Backlog changes ride along in the next commit the
  existing pending/fold machinery already produces (see AC003–AC005).
- **No web UI, no remote/cloud sync, no notifications, no team
  collaboration backend.** Backlog state is local, git-tracked, file-based
  state exactly like every other PitWay artifact.
- **Not a GitHub Issues / Jira replacement.** No labels, assignees,
  comments, priorities, or cross-repo linking — a title, a reason, a
  source, and a lifecycle, nothing more.
- **No auto-sync/auto-generation between `.pitway/backlog.yaml` and
  IMPLEMENTATION_PLAN.md.** The roadmap reconciliation (AC009) stays the
  same hand-authored review discipline already used at every prior
  milestone boundary; `.pitway/backlog.yaml` is authoritative, the markdown
  section becomes a redirect note plus frozen history, not a live
  projection requiring new tooling.
- Re-opening or amending M001–M017's contracts or completed task history.
- Any change to `branch_strategy`/`execution.strategy` or the parallel-
  worktree lifecycle itself.

## Design Decisions

- **Storage is a new root-level file, not a per-milestone directory entry
  and not journal-only.** A per-milestone location would not survive past
  that milestone's own directory/lifecycle relevance; journal-only storage
  would not survive a fresh clone (the journal lives in the git-private,
  never-committed `.git/pitway/journal.yaml`, confirmed by direct
  inspection). `.pitway/backlog.yaml` mirrors `config.yaml`/`state.yaml`'s
  existing root-level, git-tracked, non-milestone-scoped pattern.
- **Journal integration reuses the existing checkpoint-eligible entry
  schema via a new `backlog_recording` operation type — not a new sibling
  `kind`.** `quick_change`/`auto_run`/`task_verify_evidence`/the
  `worktree_*` kinds are siblings specifically because those operations
  have no future commit to fold into. A backlog mutation does have one
  (whatever the active milestone's workflow next commits), so it belongs
  in the same checkpoint-eligible `entry`/`checkpoint` family
  `task_amendment` already uses — and, like `task_amendment` being reused
  by both `task-add` and `task-amend`, one `backlog_recording` type is
  reused by `add`/`promote`/`archive` rather than minting three.
- **Folds into the existing checkpoint/pending machinery rather than a new
  self-commit mechanism.** Verified directly before drafting (not assumed):
  `classifyDirtyPaths`'s `journalMilestone` option
  (`src/git/safety.ts:79-99`) already resolves every pending entry for the
  active milestone through `resolveTargetPath` into an allowlist of
  sanctioned dirty paths, and `reconcilePending`
  (`src/state/journal.ts:453-500`) already checkpoints any pending entry
  generically once the active milestone's own commit captures its target
  path's content — neither function branches on operation type beyond
  `resolveTargetPath`'s mapping. Adding one enum member and one
  `resolveTargetPath` case is sufficient; a dedicated commit primitive
  would duplicate this machinery for no benefit and was rejected.
- **Journal attachment is unconditionally the active milestone, with no
  override — added during milestone review (architect finding, major).**
  The original draft mirrored `task-amend`'s explicit-override-or-fallback
  pattern for journal attachment too, which a review found unsafe
  specifically for backlog: `.pitway/backlog.yaml` is a shared, non-
  exclusive target (unlike a per-milestone file, which an override can
  only ever misdirect within a scope that already tolerates it), so an
  override could misattribute a pending entry to a retired milestone that
  will never checkpoint it. Collapsing this to "always the active
  milestone, no override" closes that gap by construction and, as a side
  effect, also disentangles `add`/`promote`'s `--milestone`/`--task` flags
  from journal attachment — they now mean exactly one thing each (source
  annotation, promotion target) instead of silently double-duty.
- **Promote is a pure terminal transition, never a creation.** Reuses
  `promoteQuickChange`'s exact boundary: the driver runs `task-add`/
  `milestone-add` through the normal human-confirmed pipeline first, then
  `backlog promote` links and closes the item.
- **`promoted_to` mirrors `source`'s `{ milestone, task }` shape, not a
  `{ type, id }` discriminated reference.** Considered the latter (a
  reasonable default absent an established convention) but task ids are
  milestone-scoped, not globally unique (`nextSequentialTaskId` scans only
  the current milestone's own `tasks.yaml`) — a bare task id is ambiguous
  without also naming its milestone, so the two-field shape is required,
  not merely stylistic.
- **No Change Log entry required in `contract.md` for a backlog
  mutation**, unlike `task-add`/`task-amend`. Those commands require one
  because they grow the milestone's own task graph — the thing the
  contract's Change Log exists to narrate. A backlog item is, by
  definition, explicitly *not* added to that milestone's scope, so the
  same requirement does not apply.
- **`backlog list`/`show` are not added to the worktree-guard's
  `READ_ONLY_COMMANDS` allowlist**, matching `quick-change status`'s own
  existing precedent — backlog inspection stays driver-owned.
- **Verified, not assumed, before drafting these tasks:**
  - `classifyDirtyPaths`/`reconcilePending`/`resolveTargetPath` are fully
    generic across journal operation types (see above) — this is the load-
    bearing finding that makes the whole reuse-based design possible
    without touching `tasks/update.ts`, `milestones/confirm.ts`,
    `milestones/complete.ts`, or `verification/repair.ts`.
  - `state.active_milestone` is already `null` for exactly the
    `completed`/`cancelled` milestone states by construction
    (`milestones/complete.ts`, `milestones/cancel.ts`), so AC004's active-
    milestone requirement needs no additional status gating to exclude
    them.
  - `tests/integration/git-traceability-audit.test.ts` asserts only against
    synthetic temp-repo histories built inside the test itself — it makes
    no claim about this repository's own real commits and defines no
    `src/` audit module. A backlog mutation that rides along inside an
    existing commit's own trailers (never its own `PitWay-Backlog`
    trailer, since no such trailer is introduced) needs no change here.
  - `vitest.config.ts`'s `coverage` block configures the `v8` provider and
    `text`/`lcov` reporters but **no enforced numeric threshold**. "No
    coverage regression" (per the requirement's Definition of Done) is
    therefore honored as reporter-only status quo — this milestone
    introduces no new threshold gate, because none currently exists to
    regress against.
  - `src/state/managed-init-paths.ts`'s `listSafeManagedDirtyPaths` closes
    the narrow window between `pitway init`'s scaffold and a repository's
    first-ever commit for files `init` itself creates
    (`config.yaml`/`state.yaml`/Claude assets). `.pitway/backlog.yaml` is
    never part of `init`'s scaffold — it is lazily created by the first
    `backlog add`, then folded into a commit like any other pending
    journal-tracked file — so no change is needed there.

## References

- `src/core/tasks/add.ts` / `src/core/tasks/amend.ts` — the precedent this
  milestone reuses for one journal operation type across more than one
  mutation; `task-amend`'s `resolveActiveMilestone` explicit-override-or-
  fallback pattern was the original starting point but is deliberately
  **not** followed for journal attachment (AC004) — see this contract's
  Design Decisions and Change Log for why.
- `src/core/quick-change/promote.ts` — the precedent for a promote-as-
  terminal-transition boundary that never creates the thing it links to.
- `src/state/journal.ts` / `src/core/journal/operations.ts` — the
  checkpoint-eligible `journalEntrySchema`/`resolveTargetPath`/
  `reconcilePending` machinery this milestone extends with one new
  operation type and one new target-path case.
- `src/git/safety.ts` (`classifyDirtyPaths`) — the existing dirty-path
  allowlist this milestone's design relies on unmodified.
- `.claude/protocol-driver.md`'s "Choosing a correction mechanism" section
  — the existing decision tree (`quick-change`/`task-add`/one-task
  corrective milestone/full milestone) this milestone's AC008 adds backlog
  to, as the option for out-of-scope discoveries.

## Change Log

- Revised per `milestone-review` session `rev-b1e1d2ed8657` (architect role,
  `revision_requested`): collapsed backlog journal attachment to
  unconditionally `state.active_milestone` with no override (AC004), and
  separated `add`/`promote`'s `--milestone`/`--task` flags into purely
  descriptive `source` annotation vs. purely referential promotion target
  (AC001, AC002, AC006) — closing two major and two minor review findings
  about overloaded flag semantics and a shared, non-exclusive journal
  target's misattribution risk. Still draft, not confirmed.
