---
schema_version: 1
id: M019
title: Milestone Merge Workflow and Backlog Promotion
status: in_progress
requirement: null
confirmed_at: 2026-08-21T15:31:53Z
verification_approved_hash: sha256:ec8b7797c7af177a618f318a81c7d178f137f61da74e9601ff7dc8d6755d7c92
base_branch: main
base_revision: d4fda5f54c2afb61bbbf1b6f3c202ff1568f7426
acceptance_criteria:
  - id: AC001
    text: "`pitway milestone-merge <id> [--target <branch>]` merges a completed
      milestone's branch into a target branch. Refuses immediately (before any
      git mutation) unless the milestone's status is `completed`."
  - id: AC002
    text: "State needed to perform the merge — the milestone's `contract.md`
      frontmatter (`base_branch`, `id`, `title`), its completion commit SHA (via
      the existing `findCompletionCommit`, mirroring
      `src/core/milestones/complete.ts`'s own reuse), and the resolved target
      branch — is fully read and resolved from the *current* branch **before**
      any `git checkout` runs. This is not a style preference: under
      `branch_strategy: milestone`, the target branch does not contain the
      milestone's own `.pitway/` directory or `state.yaml` entry until the merge
      lands (the disclosed M012 limitation already recorded in
      IMPLEMENTATION_PLAN.md) — any `.pitway/` state read attempted after
      checking out the target would silently see stale or missing data. A test
      proves the command run from the milestone's own branch (the natural
      starting position) succeeds, and that no state read occurs after the
      target checkout. **Wrong-branch / detached-HEAD refusal (added per
      milestone-review, architect finding, major):** if `findCompletionCommit`'s
      `since..HEAD` walk cannot find the milestone's completion commit in
      current HEAD's history, refuse by name: `completion commit for <id> not
      found in current branch history — run milestone-merge from <id>'s own
      branch or a branch it has already been merged into`. This is the correct
      invariant, not a blanket branch-name assertion
      (`assertOnMilestoneBranch`): a re-run from the *target* branch after a
      successful merge is a legitimate, working case for AC005's idempotency
      check (the completion commit is by then in the target's own ancestry, so
      the walk still finds it there), which a blanket branch-name assertion
      would incorrectly reject. A test proves both the refusal (run from an
      unrelated third branch or detached HEAD with the commit unreachable) and
      the legitimate case (re-run from the target branch post-merge, where the
      commit *is* reachable) resolve correctly."
  - id: AC003
    text: Default `--target` is the milestone's own
      `contract.frontmatter.base_branch`. Refuses with a clear, named error when
      `base_branch` is `null` (a main-strategy milestone commits directly to its
      base branch and has no separate branch to merge) — this refusal fires
      during the pre-checkout resolution step in AC002, not after any mutation.
  - id: AC004
    text: "Git safety, all checked before mutation: (1) refuses on a dirty working
      tree (reusing `checkWorkingTreeClean`, `src/git/safety.ts`); (2) refuses
      if the resolved target branch does not exist (`branchExists`,
      `src/git/branch.ts`); (3) refuses if the milestone's own source branch
      does not exist (`branchExists` on the resolved source branch — added per
      milestone-review, devops finding, major: a deleted milestone branch must
      produce a named PitWay refusal, not a raw git error); (4) on a merge
      conflict, runs `git merge --abort` and refuses — never leaves a
      half-merged working tree, and never auto-resolves; (5) if `MERGE_HEAD` is
      already present at command start (an interrupted prior merge), refuses
      with a distinct, actionable message naming manual `git merge --abort`
      recovery rather than a generic dirty-tree message (added per
      milestone-review, devops finding, minor). Every refusal restores the
      repository to its exact pre-command branch and state — the merge attempt
      is wrapped in a try/finally that restores the original branch on **any**
      thrown error, not only the conflict case (added per milestone-review,
      devops finding, minor); a test proves the original branch is
      re-checked-out after a conflict abort, and separately after an injected
      non-conflict failure."
  - id: AC005
    text: "Idempotent: if the milestone's completion commit SHA is already an
      ancestor of the target branch (`git merge-base --is-ancestor`, checked
      against the *commit SHA*, not the milestone branch tip — the branch may
      already be deleted), the command reports 'already merged' and exits
      cleanly without creating a duplicate merge commit or mutating the target
      branch further."
  - id: AC006
    text: "A successful merge produces a merge commit on the target branch with
      message `merge: <id> <title>` — matching the existing manual-merge
      convention already used for M016 (`3ddff06`) and M018 (`d4fda5f`),
      confirmed by inspection. The commit carries no PitWay trailer
      (`PitWay-Milestone`/`PitWay-Task`) — a deliberate continuation of that
      same precedent, not an oversight; a merge is not task-scoped work and has
      no task id to trail."
  - id: AC007
    text: "The merge is recorded as a new sibling journal record — `kind:
      'milestone_merge'` in `src/state/journal.ts`, added to
      `journalRecordSchema`'s discriminated union alongside
      `worktree_integrate`/`worktree_discard`/`quick_change`/`auto_run` — never
      a `journalEntrySchema` entry of `journalOperationTypeSchema`. Like those
      existing siblings: never checkpoint-eligible (no `resolveTargetPath` case
      is added; `derivePending`'s `kind === 'entry'` filter already excludes it
      structurally), audit-trail only, appended via a new
      `appendMilestoneMergeRecord`. Fields: `id`, `milestone`, `targetBranch`,
      `mergeCommitSha` (the created merge commit's SHA, or the
      already-satisfying ancestor SHA on the already-merged path),
      `alreadyMerged` (boolean), `at`."
  - id: AC008
    text: "CLI output follows existing command conventions: a `pitway_result`-shaped
      envelope under `--json`, human-readable text otherwise, on every path
      (success, already-merged, and each refusal)."
  - id: AC009
    text: "Every one of PitWay's own shipped command doc frontmatter `description:`
      fields — every `.md` file under `src/integrations/claude/commands/` at
      whatever count exists at the point T003 runs (24, after T002's
      `milestone-merge.md` lands; 31 once T003's own 7 `ms-*.md` alias files are
      added in the same task — the same `starts with 'PitWay: '` test sweeps in
      files this task itself creates, corrected per milestone-review, architect
      finding, minor: the original draft's hardcoded '19 files' was stale) — is
      prefixed with `PitWay: ` ahead of its existing text, verbatim — reusing
      the existing `description:` field, not a new mechanism. The 6 vendored
      Claude skills under `src/integrations/claude/skills/` are explicitly
      excluded — a disclosed deviation from the backlog item's literal 'all
      PitWay-generated command/skill metadata' wording, because those skills are
      vendored byte-for-byte at a pinned upstream commit with `NOTICE.md`
      attribution (confirmed by inspection); altering their frontmatter would
      break that vendoring invariant."
  - id: AC010
    text: Exactly 7 new alias command doc files ship — `ms-add.md`, `ms-cancel.md`,
      `ms-complete.md`, `ms-confirm.md`, `ms-list.md`, `ms-review.md`,
      `ms-status.md` under `src/integrations/claude/commands/` — each
      byte-identical in body to its canonical `/milestone-*` counterpart, with
      the same `PitWay:`-prefixed `description`/`argument-hint` frontmatter. No
      generation/build-time tooling is introduced (disclosed non-goal); a test
      enforces byte-for-byte parity between each alias file and its canonical
      counterpart directly, which is the discipline that keeps them in sync, not
      a shared template mechanism.
  - id: AC011
    text: "CLI-level: the 7 commander commands for `milestone-add`,
      `milestone-cancel`, `milestone-complete`, `milestone-confirm`,
      `milestone-list`, `milestone-review`, `milestone-status` each gain a
      native Commander `.alias('ms-<verb>')` (`ms-add`, `ms-cancel`,
      `ms-complete`, `ms-confirm`, `ms-list`, `ms-review`, `ms-status`) —
      confirmed sufficient with no new mechanism. `pitway ms-<verb>` invokes
      identically to `pitway milestone-<verb>` for every subcommand and flag
      (including `milestone-review`'s own `start`/`brief`/`record`/`report`/
      `decide` subcommands, reachable under either parent name). Aliases add no
      new entries to `program.commands` — `tests/integration/cli.test.ts`'s
      `ALL_COMMAND_NAMES`/'registers all N commands' count only grows by 1 (24 →
      25, for the new `milestone-merge` command from AC001), each alias verified
      separately via `Command.aliases()`/direct invocation."
  - id: AC012
    text: The 7 canonical `/milestone-*` slash commands and CLI subcommands remain
      valid, unchanged in behavior — aliases are strictly additive.
  - id: AC013
    text: Scope is fixed to exactly the 7 milestone commands the backlog item named.
      `milestone-merge` (new in this same milestone) is deliberately **not**
      given a `ms-merge` alias — the backlog item's spec is a fixed, enumerated
      list written before `milestone-merge` existed, not a general rule;
      extending it silently would be scope drift, not fidelity. No `task-*`
      command gains an alias, `auto-run` is not abbreviated, and no generic
      alias-declaration framework is introduced — all disclosed non-goals,
      matching the backlog item's own explicit exclusions.
  - id: AC014
    text: "Each of the 9 `REVIEW_ROLES` entries (`src/core/reviews/roles.ts`) gains
      a new `label` field: a short (3–8 word) display description (e.g. `System
      design & architecture`), additive alongside the existing `id`/`focus`
      fields. `focus` itself is never edited — it feeds reviewer-brief
      generation, a different consumer than the selection UI, and rewriting it
      is out of scope for a UX-only fix. No role is added, removed, or renamed —
      the backlog item explicitly forbids that; a test asserts the 9 role ids
      are unchanged."
  - id: AC015
    text: "`src/cli/review-prompt.ts`'s `formatRoleList()` renders each role as
      `<Capitalized Role Name>: <label>` (colon separator, per the backlog
      item's request) in place of today's raw `id -- focus` line, with no change
      to `parseSelection`/`promptForRoles`'s selection logic."
  - id: AC016
    text: No checkbox (`[ ]`) or HTML markup (`<b>`) is introduced — a disclosed,
      deliberate reinterpretation of the original backlog spec's mockup, which
      depicted a UI PitWay's actual surface (a plain `node:readline`
      numbered-text list) cannot render. ANSI bold escape codes are considered
      but not applied by default in this milestone — not every
      terminal/log-capturing context renders them reliably, and the
      colon-plus-label change alone already satisfies the item's 'visually
      prominent, easy to scan' goal without that risk.
  - id: AC017
    text: "A documented investigation (`docs/evidence/M019/backlog-scalability.md`)
      evaluates `.pitway/backlog.yaml`'s current single-file,
      whole-load/whole-save design (confirmed by inspection during this
      milestone's own drafting: `loadBacklog`/`saveBacklog`,
      `src/state/store.ts`) against realistic PitWay usage scale — a
      single-developer-in-the-loop, human-paced workflow tool, not a high-volume
      issue tracker — and reaches an explicit, justified conclusion. The
      investigation is permitted to conclude no redesign is warranted; no
      production code change is made on the basis of this investigation within
      this milestone (any indicated future action becomes its own new backlog
      item, not silently absorbed here)."
  - id: AC018
    text: "After this milestone is confirmed, `pitway backlog promote B001 --task
      <id>`, `backlog promote B002 --task <id>`, and `backlog promote B003
      --task <id>` are run for real against the live `.pitway/backlog.yaml` —
      the first real exercise of `backlog promote` since M018 shipped it — each
      pointing at the task in this milestone that actually implements it.
      `pitway backlog list --status pending` afterward shows only `B004`
      remaining pending; `backlog show B001|B002|B003` each show `status:
      promoted` with `promoted_to` correctly naming M019 and the implementing
      task."
  - id: AC019
    text: "IMPLEMENTATION_PLAN.md is reconciled (mirroring the identical precedent
      at every prior milestone boundary): the command-surface count (24 → 25);
      §9's shipped-asset count updated for the new `milestone-merge.md` command
      doc plus the 7 `ms-*.md` alias docs; the Bootstrap delivery table gains
      M018's own row (correctly omitted by M018's own reconciliation task, left
      for this milestone per that task's own disclosed note); the Revised
      Roadmap header/entry updated to reflect M018 delivered and this milestone
      (M019)."
  - id: AC020
    text: Any other drift between IMPLEMENTATION_PLAN.md and this milestone's actual
      delivery discovered during reconciliation is corrected in the same task,
      not left stale.
  - id: AC021
    text: "`docs/assets/workflow.mmd`/`.svg` — a pre-existing, uncommitted developer
      edit (adds a `Backlog` node and labels the `EXECUTE` subgraph `Executing
      Tasks`) discovered as unrelated dirty state blocking this milestone's
      baseline commit at confirm time — is folded into this milestone's scope by
      explicit developer decision: stashed before confirm, reapplied and
      committed as part of T006's single completion commit rather than as a
      separate standalone commit. No further content change is made to the
      diagram beyond what the developer had already drafted."
  - id: AC022
    text: "A driver-agnostic, MUST-level integration requirement is established:
      when a dispatched worker/subagent returns runtime-reported usage (e.g. an
      Agent-tool-style dispatch result carrying token counts), the driver MUST
      extract it and pass it to `task-update <id> completed --usage <json>`.
      Confirmed by a dedicated pre-task investigation (not assumed): the
      usage-persistence pipeline (`taskUsageSchema`, the `--usage` CLI flag,
      `parseUsageInput`, `accumulateUsage`, `aggregateUsage`) is already fully
      correct and tested — the defect is that no driver-facing document ever
      instructed this extraction/propagation step, even though a real,
      runtime-reported figure is already available at the exact point a
      worktree-dispatched worker's Agent-tool call returns. This is documented
      as part of PitWay's provider-agnostic Agent Interface design
      (`IMPLEMENTATION_PLAN.md` §8 Agent Interface / §12 Token Accounting
      Strategy), not solely as Claude-specific prose, so that any future driver
      adapter (a hypothetical OpenCode adapter, still deferred per §15) inherits
      the same obligation before it can be considered a compliant PitWay driver
      integration. `src/integrations/claude/dispatch.md`'s worktree-dispatch
      completion step and `src/integrations/claude/ protocol-driver.md` are
      updated with the concrete, MUST-level Claude instruction, cross-referenced
      from `src/integrations/claude/commands/ task-update.md`."
  - id: AC023
    text: "The existing 'never estimate, fabricate, or silently discard
      runtime-reported usage' principle (decision 8) is restated, not weakened
      or reinterpreted: when no task-scoped runtime usage is available (fully
      inline execution with no subagent dispatched, or a dispatched worker that
      itself reports none), `usage` MUST remain `null` / render `N/A` — AC022
      does not attempt to close that inherent, previously-disclosed gap, and no
      estimation/derivation is introduced for it. No change is made to
      `taskUsageSchema`, the `--usage` CLI flag, `parseUsageInput`,
      `accumulateUsage`, `aggregateUsage`, or any other part of the existing
      usage schema/persistence/aggregation/CLI contract — preserved verbatim,
      per the investigation's own finding that this layer is already correct.
      Regression tests: (1) `tests/integration/task-update.test.ts` proves a
      real `--usage` value supplied at the worktree-dispatch completion path
      (`task-dispatch` → work → `task-integrate` → `task-update completed
      --usage`) persists correctly end-to-end — the exact path AC022's
      instruction targets, not yet asserted by any existing test; (2) a test
      proves that when no `--usage` is supplied at completion (including a fully
      inline, non-dispatched completion), `usage` remains `null`, never
      defaulted; (3) a test proves `accumulateUsage`/`parseUsageInput` never
      coerce a missing/absent usage field to `0` or otherwise estimate it; (4) a
      documentation-presence test (extending `tests/unit/claude-assets.test.ts`)
      asserts `dispatch.md`/ `protocol-driver.md` literally contain the
      MUST-level `--usage` propagation instruction, so a future doc edit cannot
      silently drop it — the only enforcement mechanism available for a
      protocol-level, not code-level, requirement."
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npm test -- tests/integration/milestone-merge.test.ts
  - id: CT002
    criterion: AC002
    type: command
    command: npm test -- tests/integration/milestone-merge.test.ts
  - id: CT003
    criterion: AC004
    type: command
    command: npm test -- tests/integration/milestone-merge.test.ts
  - id: CT004
    criterion: AC005
    type: command
    command: npm test -- tests/integration/milestone-merge.test.ts
  - id: CT005
    criterion: AC007
    type: command
    command: npm test -- tests/unit/journal.test.ts
      tests/integration/milestone-merge.test.ts
  - id: CT006
    criterion: AC008
    type: command
    command: npm test -- tests/integration/cli.test.ts
      tests/integration/build-bin.test.ts
      tests/integration/milestone-merge.test.ts
  - id: CT007
    criterion: AC009
    type: command
    command: npm test -- tests/unit/claude-assets.test.ts
  - id: CT008
    criterion: AC011
    type: command
    command: npm test -- tests/integration/cli.test.ts
      tests/integration/build-bin.test.ts
  - id: CT009
    criterion: AC014
    type: command
    command: npm test -- tests/unit/review-roles.test.ts
  - id: CT010
    criterion: AC015
    type: command
    command: npm test -- tests/integration/milestone-review-interactive.test.ts
  - id: CT011
    criterion: AC017
    type: manual
    instruction: Confirm docs/evidence/M019/backlog-scalability.md exists, reasons
      from the current single-file backlog design against realistic PitWay usage
      scale, and reaches an explicit conclusion — no production code change is
      present on the strength of this investigation alone.
  - id: CT012
    criterion: AC018
    type: manual
    instruction: Confirm pitway backlog show B001/B002/B003 each read status
      promoted with promoted_to correctly naming M019 and the task that
      implemented them, and pitway backlog list --status pending shows only B004
      remaining.
  - id: CT013
    criterion: AC019
    type: manual
    instruction: Confirm IMPLEMENTATION_PLAN.md's command-surface count reads 25,
      the shipped-asset count reflects the 8 new docs, the Bootstrap delivery
      table now includes M018's row, and the roadmap header/entry reflects M018
      delivered and M019.
  - id: CT014
    criterion: AC001
    type: command
    command: npm test
  - id: CT015
    criterion: AC021
    type: manual
    instruction: Confirm docs/assets/workflow.mmd and docs/assets/workflow.svg carry
      the Backlog node / Executing Tasks label edit and were committed as part
      of T006, not as a separate standalone commit.
  - id: CT016
    criterion: AC022
    type: command
    command: npm test -- tests/unit/claude-assets.test.ts
  - id: CT017
    criterion: AC023
    type: command
    command: npm test -- tests/integration/task-update.test.ts
---

# Contract — M019: Milestone Merge Workflow and Backlog Promotion

## Objective

Give PitWay a first-class, safe way to land a completed milestone's branch
into a target branch (`pitway milestone-merge`) — the manual-merge gap
disclosed since M012 and exercised by hand twice already (M016, M018) — and
close out the backlog items surfaced during M018's own execution: command
discoverability (`ms-*` aliases + standardized `PitWay:` description
prefix), reviewer-selection UX (concise, colon-separated role labels), and a
documented scalability review of `.pitway/backlog.yaml`'s single-file
design. This is also the first real exercise of `backlog promote`. Also
establishes a driver-agnostic runtime-usage-propagation requirement (T007,
inserted highest-priority): a dedicated pre-task investigation confirmed
PitWay's usage schema/persistence/aggregation is already correct, and the
only real gap is that no driver protocol document ever instructed the
extraction/forwarding step for a dispatched worker's already-available,
runtime-reported usage figure.

## Scope

- `pitway milestone-merge <id> [--target <branch>]`: state resolved fully
  before checkout, git safety checks, idempotent already-merged detection,
  conflict-safe refusal, audit-trail-only journal record — no PitWay trailer
  on the merge commit (AC001–AC008).
- `PitWay: ` description prefix on every PitWay-owned command doc
  (skills excluded, disclosed); 7 new `ms-*` alias command docs and
  matching Commander `.alias()` wiring for the 7 named milestone commands
  only (AC009–AC013).
- Reviewer-selection UX: a new short `label` per review role, rendered as
  `RoleName: label`; `focus` untouched (AC014–AC016).
- Backlog storage scalability: a documented investigation, no code change
  required by its conclusion (AC017).
- Dogfooding: promote B001/B002/B003 for real; roadmap reconciliation
  (AC018–AC020).
- Fold in the developer's own pre-existing `workflow.mmd`/`.svg` diagram
  edit, discovered as a confirm-time dirty-tree blocker (AC021).
- T007 (highest-priority, inserted at the top of this milestone's task
  graph): a driver-agnostic, MUST-level usage-propagation requirement, with
  no change to the existing usage schema/persistence/aggregation/CLI
  contract (AC022–AC023).

## Invariants

1. `milestone-merge` never mutates repository state before every
   pre-checkout read has completed.
2. A merge is refused, not force-completed, on any git-safety violation
   (dirty tree, missing target, conflict) — the repository is always left
   exactly as it was found on a refusal.
3. `milestone-merge`'s journal record is audit-trail-only, never
   checkpoint-eligible, matching every existing non-entry journal sibling.
4. `focus` on any `REVIEW_ROLES` entry is never modified by this milestone.
5. `.pitway/backlog.yaml`'s schema and lifecycle (from M018) are unmodified
   by this milestone; only its promote path is exercised.
6. `usage: null` remains a valid, honest state whenever no task-scoped
   runtime usage is available — T007 closes a propagation gap, never
   introduces estimation, defaulting, or fabrication.

## Non-Goals

- **No auto-merge on milestone completion.** `milestone-complete` still
  never merges; `milestone-merge` remains a distinct, deliberate,
  developer-invoked step — consistent with the existing "merge-ready, never
  auto-merged" precedent.
- **No conflict auto-resolution.** A conflicting merge is always refused and
  aborted, never partially applied or auto-resolved.
- **No `PitWay-Milestone` trailer on the merge commit** — matches existing
  manual-merge precedent (M016, M018); a deliberate continuation, not an
  oversight.
- **No aliasing of `task-*` commands, `auto-run`, or `milestone-merge`
  itself.** Scope is fixed to the 7 commands the backlog item named.
- **No slash-command alias mechanism invented.** Verified directly: Claude
  Code has no frontmatter alias field; a second trigger name requires a
  second physical `.md` file. No generation/build tooling is added for
  keeping the 7 alias files in sync — a parity test is the discipline used
  instead.
- **No rewrite of `REVIEW_ROLES.focus`, no new/removed/renamed role, no
  change to review selection/parsing logic** — UX-only fix.
- **No backlog storage redesign** in this milestone, regardless of AC017's
  conclusion — any indicated follow-up becomes its own new backlog item.
- Re-opening or amending M001–M018's contracts or completed task history.
- Any change to `branch_strategy`/`execution.strategy` or the parallel-
  worktree lifecycle itself.
- **No change to `taskUsageSchema`, the `--usage` CLI flag, or the
  accumulation/aggregation logic.** T007 is a protocol/documentation
  requirement plus regression tests confirming the existing mechanism —
  never a rewrite of it.
- **No attempt to make inline (non-dispatched) task usage measurable.**
  Disclosed, unchanged limitation — `usage` stays `null` there by design,
  not something this milestone tries to solve.
- **No code-level enforcement of the driver-protocol MUST rule.** PitWay
  cannot compel a driver to follow its own documentation; the
  documentation-presence test (AC023) is the only mechanically-checkable
  proxy available, matching the existing, disclosed "testing discipline:
  guidance, not enforcement" precedent (`report-format.md`).

## Design Decisions

- **`milestone_merge` is a new sibling journal `kind`, not a
  `journalOperationTypeSchema` entry.** Unlike `backlog_recording`
  (M018), a merge has no future commit of the *milestone's own* workflow to
  fold into — the merge commit itself, produced by this very operation, is
  the terminal artifact. This mirrors `worktree_integrate`/
  `worktree_discard`'s reasoning exactly (audit-trail records with no
  target state file), not `task_amendment`'s reuse pattern.
- **State-before-checkout ordering is a first-class AC (AC002), not an
  implementation detail.** Verified by inspection before drafting: under
  `branch_strategy: milestone`, a milestone's own `.pitway/` directory only
  exists on its own branch until merged — reading `.pitway/` state after
  switching branches would silently read stale or absent data. Making this
  an AC (with its own test) prevents it from being refactored away later
  without deliberate review.
- **Idempotency checks the completion commit SHA's ancestry, not branch-tip
  ancestry.** A milestone branch may be deleted after merging (developer
  housekeeping); anchoring to the SHA keeps "already merged" detection
  correct regardless.
- **`ms-*` aliases are 7 duplicate `.md` files, not a generated set**,
  because Claude Code's command-discovery mechanism has no include/alias
  frontmatter field (verified directly, not assumed) — confirmed via a
  dedicated investigation before drafting this contract. A byte-for-byte
  parity test is the chosen discipline for keeping them in sync, deliberately
  simpler than introducing a build-time generation step for 7 files.
- **Skills are excluded from the `PitWay:` prefix.** The 6 vendored Claude
  skills carry byte-for-byte-vendoring + `NOTICE.md` attribution guarantees
  that a metadata edit would break; the backlog item's literal wording
  ("all... command/skill metadata") is read as aspirational rather than
  overriding that existing, load-bearing invariant. Disclosed here rather
  than silently narrowed.
- **Reviewer role UX adds a new `label` field rather than repurposing
  `focus`.** `focus` is consumed by reviewer-brief generation
  (`computeReviewContentHash` and related brief text) — a different job
  than the selection list's display need. Keeping them separate avoids
  coupling a cosmetic fix to briefing content.
- **No ANSI bold applied by default.** Considered per the backlog item's
  "bold role name" language, but rejected as the default: not every
  terminal/log-capturing context renders ANSI reliably, and the
  `RoleName: label` colon format alone satisfies the scannability goal.
- **`milestone-merge`'s wrong-branch protection is completion-commit
  reachability, not `assertOnMilestoneBranch` (revised per milestone-review,
  architect finding, major).** The original draft's References section
  claimed `assertOnMilestoneBranch` would be reused directly; a review
  found this would break AC005's legitimate idempotent re-run from the
  target branch post-merge. The correct, narrower invariant — "the
  completion commit must be reachable from current HEAD" — is what AC002
  now specifies; `assertOnMilestoneBranch` remains scoped to its existing
  callers (commit-producing operations for a still-active milestone) and is
  not reused here.
- **T006's `backlog promote` calls need no `write_scope` entry for
  `.pitway/backlog.yaml` (disclosed per milestone-review, devops finding,
  major).** This mirrors M018's own precedent exactly: no task in M018 ever
  declared `.pitway/backlog.yaml` in its `write_scope`, because a pending
  `backlog_recording` journal entry is already classified as an expected
  dirty path by the existing, unmodified `classifyDirtyPaths({
  journalMilestone })` allowlist (`src/git/safety.ts`) — the same mechanism
  that let a backlog item be added mid-task during M018's own execution.
  T006's three `backlog promote` calls ride along in T006's own single
  completion commit alongside its `IMPLEMENTATION_PLAN.md` change; no
  dedicated commit is created for them, and no code change is needed to
  make this true.
- **T007's "highest-priority, inserted at the top" is a procedural/driver
  discipline, not a state-machine-enforced blocking dependency — disclosed
  limitation, verified by inspection before drafting.** `task-add`
  (`src/core/tasks/add.ts`) always assigns a new task the next sequential
  id with `depends_on` referencing only already-existing tasks; `task-amend`
  (`src/core/tasks/amend.ts`)'s `AMENDABLE_FIELDS` explicitly excludes
  `depends_on` ("identity, status, dependency graph, and execution history
  stay immutable"). There is no sanctioned mechanism, post-confirm, to make
  T001/T004/T005 (already `ready`, unstarted) depend on a newly-added T007.
  T007 is therefore added with `depends_on: []`, made "first" by its own
  objective explicitly instructing the driver to complete it before
  dispatching any other M019 task, not by a hard gate. This is the honest
  ceiling of what `task-add`'s design permits, not an oversight.

## References

- `src/core/milestones/complete.ts` — `findCompletionCommit`,
  `expectedMilestoneBranch`, the "merge-ready, never auto-merged" precedent
  this milestone extends without altering.
- `src/git/branch.ts` / `src/git/safety.ts` — existing git-layer primitives
  (`branchExists`, `checkWorkingTreeClean`) this milestone reuses;
  `checkoutBranch` and the new `src/git/merge.ts` are the only new
  git-layer additions. `assertOnMilestoneBranch` is deliberately **not**
  reused by `milestone-merge` — see Design Decisions (revised per
  milestone-review).
- `src/state/journal.ts` — the `worktree_integrate`/`worktree_discard`
  sibling-kind precedent `milestone_merge` follows.
- `src/core/reviews/roles.ts` / `src/cli/review-prompt.ts` — `REVIEW_ROLES`
  and `formatRoleList()`, the exact surfaces AC014–AC016 touch.
- `.pitway/backlog.yaml` (M018) — the design AC017 investigates without
  modifying.
- Git log `3ddff06` (M016 manual merge), `d4fda5f` (M018 manual merge) —
  confirmed trailer-free merge-commit-message precedent for AC006.
- Pre-task investigation confirming the usage-persistence pipeline is
  already correct and identifying the driver-protocol propagation gap
  AC022/AC023/T007 close: `src/state/schemas.ts` (`taskUsageSchema`),
  `src/cli/commands/task-update.ts` / `src/core/tasks/update.ts`
  (`parseUsageInput`, `accumulateUsage`, `computeUsageWarning`),
  `src/core/metrics/aggregate.ts` (`aggregateUsage`),
  `src/integrations/claude/dispatch.md` / `protocol-driver.md` /
  `report-format.md` (the docs found silent on `--usage`), and
  `IMPLEMENTATION_PLAN.md` §12 (Token Accounting Strategy, decision 8).

## Change Log

- Revised per `milestone-review` session `rev-41930528ad65` (architect +
  devops roles, `revision_requested`): AC002 now specifies a named refusal
  when the completion commit is unreachable from current HEAD, replacing
  the original draft's incorrect plan to reuse `assertOnMilestoneBranch`
  wholesale (would have broken AC005's legitimate post-merge idempotent
  re-run); AC004 gained an explicit source-branch-existence check,
  `MERGE_HEAD`-aware interrupted-merge detection, and a try/finally
  restore-on-any-error guarantee; AC009/T003 corrected a stale hardcoded
  file count; a Design Decision now discloses that T006's `backlog promote`
  calls need no `write_scope` entry, mirroring M018's own precedent.
- Added AC021 at confirm time: `milestone-confirm` refused on an unrelated
  dirty-tree blocker (`docs/assets/workflow.mmd`/`.svg`, a pre-existing
  developer edit). Per explicit developer decision, folded into T006's
  scope rather than committed separately — stashed before the baseline
  commit, reapplied and committed as part of T006.
- Amended post-confirm: added AC022/AC023 and T007, a driver-agnostic
  MUST-level runtime-usage-propagation requirement, per explicit developer
  instruction following a dedicated investigation that found the
  usage-persistence pipeline already correct and the real gap to be a
  missing driver-protocol instruction. T007 is inserted at the top of the
  task graph by developer request; `depends_on: []` per the disclosed
  `task-add`/`task-amend` tooling constraint (see Design Decisions) — its
  "first" priority is a driver-discipline instruction in its own
  objective, not a state-machine-enforced dependency. No change to the
  existing usage schema/persistence/aggregation/CLI contract.
