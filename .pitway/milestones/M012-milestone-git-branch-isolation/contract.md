---
schema_version: 1
id: M012
title: Milestone Git branch isolation
status: in_progress
requirement: null
confirmed_at: 2026-08-20T08:35:09Z
verification_approved_hash: sha256:8d70813bfbb5ea919328240257d2ff0824af01182ef491b55039843e868d909b
acceptance_criteria:
  - id: AC001
    text: "`config.yaml` gains its first real (non-`schema_version`) field: an
      additive-optional nested `git` object with `branch_strategy: 'main' |
      'milestone'`, added to `configSchema` (`src/state/schemas.ts`). Absent
      `git` (every existing `config.yaml` written before this milestone, and
      every fresh `pitway init` output -- `init` does not write this field) is
      treated as `branch_strategy: 'main'`, byte-for-byte the same resolved
      behavior as today. `loadConfig`/`saveConfig` (`src/state/store.ts`) keep
      their existing signatures; only the schema the value is validated against
      changes. A real test loads an M001-style bare `{schema_version: 1}`
      config.yaml and confirms it still parses and resolves to `main` strategy,
      proving this is additive, not breaking."
  - id: AC002
    text: >-
      `milestone-confirm`, under `branch_strategy: milestone`, handles exactly
      two cases, and performs at most one branch mutation across both -- a
      single create-and-checkout in the fresh case; never in the resumed case.
      `contractFrontmatterSchema` gains two additive-optional, nullable fields,
      `base_branch` and `base_revision` (a branch name and a full commit SHA
      respectively), null on every milestone confirmed before this ships and on
      every `main`-strategy confirm.

      **Case 1 -- fresh confirm** (`status: draft`, `base_branch`/
      `base_revision` not yet recorded): after the existing
      `assertNoUnexpectedDirtyPaths` safety check has already passed -- branch
      creation is never attempted on an unexpectedly dirty tree -- compute the
      deterministic branch name (`pitway/<id>-<slug>`, reusing the existing
      `slugifyTitle` (`src/state/store.ts`) so branch and milestone-directory
      naming stay consistent). If a branch with that exact name already exists,
      refuse immediately with a diagnostic naming it -- never reuse, reset, or
      force-create over it, and never attempt to distinguish a genuine foreign
      collision from PitWay's own leftover half-created branch from an earlier
      crashed attempt; both refuse identically and require manual developer
      inspection/cleanup before retrying (a disclosed, narrow, non-bootstrap
      window: a crash between this branch-creation step and the frontmatter
      write below leaves an orphaned branch with no recorded owner). Otherwise:
      `base_branch` is the branch currently checked out (never hardcoded `main`)
      and `base_revision` is its HEAD SHA at this exact moment; create and check
      out the new branch from there, then persist `base_branch`/`base_revision`
      in the same frontmatter write that already records
      `confirmed_at`/`verification_approved_hash`. The baseline commit lands on
      the new branch as a natural consequence of the checkout, not a separate
      mechanism.

      **Case 2 -- resumed confirm** (`status: in_progress`, `base_branch`/
      `base_revision` already recorded from a prior attempt, no baseline commit
      found yet -- the existing AC012 resume shape): confirm performs no branch
      mutation of any kind. It refuses with a diagnostic naming both the
      expected branch (the milestone's own deterministic name, derived from the
      recorded `base_branch`-having state, not `base_branch` itself) and the
      branch actually checked out, unless the currently checked-out branch is
      exactly that expected milestone branch; on a match it proceeds directly to
      the existing baseline-commit-recreation call. If the expected branch does
      not exist at all at this point (deleted between attempts), that is the
      same refuse-with-diagnostic outcome, never a silent recreation. The
      developer switches branches manually to resolve either case -- confirm
      itself never runs a checkout in this path.

      Under `branch_strategy: main`, confirm's behavior is completely unchanged:
      no branch is ever created, switched, inspected, or required to match
      anything, and `base_branch`/`base_revision` stay null. Every existing Git
      safety rule is preserved without exception: no stash, reset, force-push,
      destructive branch deletion, or automatic conflict resolution is ever
      performed as part of this AC, in either case.
  - id: AC003
    text: "Every commit-producing operation for an active `milestone`-strategy
      milestone -- a task's completion commit and `milestone-complete`'s own
      commit -- verifies, immediately before committing, that the currently
      checked-out branch matches that milestone's persisted `base_branch`-
      derived branch name (resolved the same deterministic way AC002 constructs
      it, never re-read from a separately duplicated value), via one shared
      guard function (not reimplemented at each call site).  A mismatch refuses
      the operation before anything is staged or committed, naming both the
      expected and the actually-checked-out branch in the diagnostic. The guard
      never auto-checks-out to correct a mismatch -- that is a human decision.
      Under `branch_strategy: main` (or for any milestone with `base_branch:
      null`), the guard is a no-op and behavior is unchanged."
  - id: AC004
    text: "`pitway resume`'s view (`buildResumeView`/`renderResumeHuman`,
      `src/cli/commands/resume.ts`) surfaces, for an active `milestone`-
      strategy milestone, its tracked branch name and whether the currently
      checked-out branch matches it -- both in the human-readable text and the
      `--json` shape. On a mismatch, the human output states plainly which
      branch is expected and which is currently checked out and that the
      developer must switch manually; `resume` itself never runs a `git
      checkout` or any other working-tree-mutating command -- it is a read-only
      orientation view, unchanged in that respect from its current design. For
      `main`-strategy milestones (and the `git: null`/absent case), this
      surfacing is entirely absent from the view, not merely blank -- proving
      `main`-strategy `resume` output is byte-for-byte unaffected."
  - id: AC005
    text: >-
      `resolveCommitSha` (`src/git/trailers.ts`) gains an additive-optional
      range-scoping parameter that, when a milestone's persisted `base_revision`
      is available, bounds the underlying `git log` scan to
      `<base_revision>..HEAD` instead of the full unbounded history scan used
      today. Every call site that has a milestone in scope (baseline- commit
      lookup, task/verification-repair commit lookups) passes the milestone's
      `base_revision` when present (`milestone` strategy) and omits it otherwise
      (`main` strategy, or no `base_revision` recorded), preserving today's
      unbounded-scan behavior exactly, byte-for-byte, in both of those cases --
      this AC changes no behavior at all when no range is passed.

      If the bounded range itself fails to resolve at git's level (`base_
      revision` is no longer reachable -- for example after a history rewrite;
      this session's own accidental `git reset` during M011 is a live, real
      instance of exactly this condition), the lookup does **not** fall back to
      an unbounded scan. An unbounded fallback would undermine the
      branch-isolation guarantee `base_revision` exists to provide: it is the
      milestone branch's own integrity anchor, and silently widening the search
      the moment that anchor turns out to be invalid would mask a genuine
      corruption of the milestone's tracked git state behind an
      apparently-successful lookup -- worse, once completed milestone branches
      are eventually merged (a real future state this project's own roadmap
      anticipates, even though no automatic merge exists yet), an unbounded scan
      from a corrupted anchor could walk into a different, unrelated milestone's
      own merged history entirely, precisely the cross-milestone leakage branch
      isolation exists to prevent. Instead, `resolveCommitSha` throws a
      `GitError` naming the unreachable `base_revision` explicitly,
      distinguishing this from its own ordinary "no match in range" outcome (a
      valid range that legitimately contains no matching commit still returns
      `undefined`, exactly as today -- expected and harmless, e.g. during
      AC012-style resume before a baseline commit exists). Every call site that
      receives this thrown error surfaces it as a clear, actionable diagnostic
      naming the corrupted `base_revision` rather than silently recovering or
      guessing -- for the baseline-commit lookup specifically, this composes
      directly with AC002's own Case 2 resumed-confirm handling, which already
      refuses on any ambiguity rather than recreating state.
      `resolveChangeCommitSha` (quick- change's own lookup, structurally
      milestone-less) is not touched by this AC, never receives a range, and
      stays fully unbounded -- `main`-strategy behavior and every pre-existing
      unbounded call site are unaffected in every respect.
  - id: AC006
    text: "`milestone-complete`, for a `milestone`-strategy milestone, reaches a
      merge-ready/PR-ready state on completion without ever performing an
      automatic merge, and this is verified by concrete, falsifiable assertions
      (not merely asserted in prose): the milestone's branch contains exactly
      the baseline, task, and completion commits reachable forward from
      `base_revision` (no unexpected commits, no commits missing); the working
      tree is clean; the persisted `base_branch`'s own tip does **not** contain
      any of those milestone commits (`git merge-base`/`git branch --contains`
      used to prove this, not assumed); no merge commit exists anywhere in the
      milestone branch's history since `base_revision`; the base branch itself
      is left completely untouched -- not checked out, not advanced, not
      rebased. PitWay never force-pushes, deletes a branch, or performs any
      other destructive Git operation as part of completion. Under
      `branch_strategy: main`, `milestone-complete`'s behavior is completely
      unchanged from today."
  - id: AC007
    text: "A real, end-to-end integration test in a temporary git repository
      exercises the full `milestone`-strategy lifecycle against actual Git
      state, not mocked: `branch_strategy: milestone` configured ->
      `milestone-add` -> `milestone-confirm` (branch created with the
      deterministic name, baseline commit lands on it, `base_branch`/
      `base_revision` recorded correctly) -> at least one task's full
      `in_progress -> review -> completed` cycle (its commit verified to land on
      the milestone branch, per AC003's guard) -> a deliberate manual `git
      checkout` away from the milestone branch, followed by `pitway resume`,
      proving the mismatch is surfaced per AC004 without any auto-checkout ->
      checkout back onto the milestone branch -> `milestone-complete`
      (merge-ready assertions per AC006 all verified directly against real git
      plumbing output). A second, equally real regression pass proves
      `branch_strategy: main` (both explicitly configured and the config-absent
      default) is completely unaffected end-to-end: no branch is ever created or
      switched, `base_branch`/ `base_revision` stay null throughout, and every
      existing `main`- strategy test in the suite continues to pass unmodified.
      Disclosed, non-bootstrap gap (mirroring M011/AC001's own required_skills
      disclosure): this milestone's own development happens under
      `branch_strategy: main`, since the `milestone` strategy this milestone
      builds does not exist yet at its own confirm time -- M012 cannot dogfood
      its own feature for its own delivery, only for the AC007 test fixture's
      synthetic repository."
  - id: AC008
    text: "`protocol-driver.md` gains a new \"Verification discipline\" section
      stating plainly, as a driver rule: task execution runs only that task's
      own declared verification command (directly, or via `task-verify`) --
      never the full `npm test` suite or `tsc --noEmit` ad hoc \"just to check\"
      after an individual task; full-suite/typecheck runs are reserved for a
      milestone's own explicit `command`-type verification checks (already the
      pattern in use, e.g. a milestone's own full-suite CT) or a genuinely
      cross-cutting investigation where a task's own narrow declared scope
      cannot rule out a wider regression -- never a routine per-task sanity
      habit. The same section states that once a manual/review verification
      result has been recorded via `pitway verify <id> --check <ct-id>
      --pass|--fail`, that record is authoritative in
      `verification-results.yaml`; re-invoking bare `pitway verify <id>` a
      second time to \"see the result\" reruns every command-type check fresh
      and, by the tool's own design, always displays non-command checks as
      pending regardless of what is already recorded -- so a driver session
      should read `verification-results.yaml` directly (or trust its own prior
      `--check` write) rather than re-invoking bare `verify` expecting it to
      reflect already-recorded manual results. This codifies, as a real
      installed PitWay asset, the developer's explicit 2026-08-20 correction
      during M011's own execution (this session ran the full suite ad hoc after
      T001/T002 before being corrected) -- see this session's own
      verification-granularity-discipline memory record. Scope-purity note,
      disclosed rather than silently resolved: this AC is unrelated to branch
      isolation, PitWay's own driver-workflow-discipline concern rather than a
      Git mechanism; it rides this milestone only because the developer's own
      instruction was to \"put it to pitway in next milestone,\" and the
      developer may strike it at contract review if a dedicated corrective
      milestone is preferred instead."
  - id: AC009
    text: "`IMPLEMENTATION_PLAN.md` is reconciled to this milestone's actual
      delivery, mirroring every prior milestone's own closing reconciliation
      task: the revision header gains a new dated entry; §7 documents the
      command surface (unchanged count unless a genuinely new command is added
      -- name any that is); §9's Claude-asset inventory is updated only if this
      milestone changes it (expected: no new asset, since AC008 is a targeted
      insertion into an existing file, not a new one); §10's Git Strategy
      section is rewritten to describe the real, delivered `branch_strategy:
      main | milestone` behavior in place of today's \"single-branch by
      default... deliberately deferred -- see §15\" text, and its own
      range-bounded-trailer-lookup sentence is updated from \"scheduled with
      milestone branch isolation (M012...)\" to reflect actual delivery; §15's
      \"Deferred: milestone-level Git branch strategy\" subsection is updated to
      state the feature shipped in M012, pointing at §10 rather than restating
      the design; the Bootstrap section's delivery table gains M011's row
      (M012's own row correctly omitted, left for whichever milestone next runs
      its own reconciliation task, per the established self-referential-omission
      precedent); the Revised Roadmap's M012 entry is rewritten from its current
      not-yet-drafted placeholder to reflect actual delivery; the Status
      paragraph/snapshot is updated. Additionally, and separately from the above
      reconciliation, this task resolves the roadmap numbering collision the
      developer explicitly flagged when directing this milestone's own drafting
      (2026-08-20): \"PitWay Driver UX\" (recorded only as an unscheduled
      candidate in memory, never before given a real roadmap entry) is inserted
      as the new **M013**, immediately following this M012, and the existing
      M013 (parallel task worktrees) and M014 (extended dogfood validation) both
      shift down by one to **M014** and **M015** respectively -- the identical
      renumbering mechanic M009/T006 already applied twice, updating every
      cross-reference to the old numbers throughout the document (§10, §15's
      closing paragraph, the Revised Roadmap section itself), not just the
      Revised Roadmap headings."
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npm test -- tests/unit/schemas.test.ts tests/integration/init.test.ts
  - id: CT002
    criterion: AC002
    type: command
    command: npm test -- tests/unit/git-branch.test.ts tests/unit/schemas.test.ts
      tests/integration/milestone-confirm.test.ts
  - id: CT003
    criterion: AC003
    type: command
    command: npm test -- tests/unit/git-branch.test.ts
      tests/integration/task-update.test.ts
      tests/integration/milestone-complete.test.ts
  - id: CT004
    criterion: AC004
    type: command
    command: npm test -- tests/integration/resume.test.ts tests/unit/git-branch.test.ts
  - id: CT005
    criterion: AC005
    type: command
    command: npm test -- tests/unit/trailers.test.ts
  - id: CT006
    criterion: AC006
    type: command
    command: npm test -- tests/integration/milestone-complete.test.ts
  - id: CT007
    criterion: AC007
    type: command
    command: npm test -- tests/integration/branch-isolation-lifecycle.test.ts
  - id: CT008
    criterion: AC007
    type: command
    command: npm test
  - id: CT009
    criterion: AC008
    type: manual
    instruction: Confirm protocol-driver.md's new "Verification discipline" section
      exists, states plainly that task execution runs only the task's own
      declared command (never an ad hoc full-suite/typecheck run after an
      individual task), reserves full-suite/typecheck runs for a milestone's own
      explicit command-type CT or a genuine cross-cutting investigation, and
      states that recorded manual/review verification results in
      verification-results.yaml are authoritative and should not be re-derived
      by re-invoking bare `pitway verify <id>`. Confirm no other file in this
      milestone's write_scope was touched to satisfy this AC (a single targeted
      insertion, not a broader rewrite).
  - id: CT010
    criterion: AC009
    type: manual
    instruction: Confirm IMPLEMENTATION_PLAN.md's revision header, §7, §10, §15, the
      Bootstrap delivery table, the Revised Roadmap's M012 entry, and the Status
      paragraph all reflect this milestone's actual delivered scope (not the
      pre-drafting placeholder text); confirm §10/§15 no longer describe branch
      isolation as deferred; confirm the roadmap renumbering was actually
      applied -- "PitWay Driver UX" appears as a real M013 entry immediately
      after M012, the former M013 (parallel task worktrees) now reads M014, the
      former M014 (extended dogfood validation) now reads M015, and every
      cross-reference to the old numbers elsewhere in the document (§10, §15's
      closing paragraph) was updated too, not just the Revised Roadmap section's
      own headings.
  - id: CT011
    criterion: AC002
    type: manual
    instruction: Confirm config.yaml's git.branch_strategy is read correctly under
      milestone strategy; confirm the deterministic branch name
      (pitway/<id>-<slug>) reuses slugifyTitle rather than a second, independent
      slug implementation; confirm branch creation happens only after the
      existing dirty-tree safety check passes; confirm base_branch/base_revision
      are null for every historical milestone and for every main-strategy
      confirm; confirm a fresh confirm refuses -- never reuses or resets -- when
      the deterministic branch name already exists, for both a genuine foreign
      collision and a leftover PitWay-created orphan, with no attempt to
      distinguish the two; confirm the resumed-confirm path performs zero branch
      mutation and refuses with a diagnostic naming both the expected and actual
      branch whenever the currently checked-out branch is not exactly the
      milestone's own already-created branch, including when that branch no
      longer exists at all; confirm no stash/reset/force-push/ destructive
      branch deletion or automatic checkout is ever performed anywhere in this
      AC's code paths.
  - id: CT012
    criterion: AC003
    type: manual
    instruction: Confirm the branch guard is implemented once and shared (not
      duplicated per call site) and is wired into both the task completion
      commit path and milestone-complete's own commit path; confirm a deliberate
      mismatch (manually checked out to a different branch) refuses cleanly with
      a diagnostic naming both branches before anything is staged; confirm the
      guard never itself runs a checkout; confirm main-strategy/base_branch-null
      milestones are a true no-op.
---

# Contract — M012: Milestone Git branch isolation

## Objective

Implement the `git.branch_strategy: milestone` policy this project's own design record
(`IMPLEMENTATION_PLAN.md` §15, "Deferred: milestone-level Git branch strategy") has
carried as a fully specified, deliberately deferred design sketch since M009/T006 first
renumbered it into the roadmap. Today `branch_strategy` does not exist as a real
mechanism at all -- every milestone, PitWay's own eleven completed ones included,
develops directly on whatever branch is checked out (`main` in every real case so far),
and `IMPLEMENTATION_PLAN.md` §10 explicitly documents this as the current MVP default
with the alternative "designed but deliberately deferred." This milestone builds that
alternative for real: a repository-level policy that, when opted into, isolates each
milestone on its own deterministically-named branch, created only after PitWay's
existing dirty-tree safety check passes, with the branch's originating branch and
revision persisted so nothing is ever hardcoded to `main` and so a future resume can
detect (never silently fix) a mismatch. The durable architectural principle §15 already
states governs this milestone's own design: milestones may own branches, tasks own
commits -- branch isolation is a milestone-level concern only, never per-task, and this
milestone introduces no per-task branch of any kind. Every one of §15's own candidate
acceptance criteria is carried forward here nearly one-to-one (AC001-AC007 below map
directly onto that list); none is silently dropped or narrowed. `branch_strategy: main`
remains the default in every case where `git` is absent from `config.yaml` -- this
milestone is purely additive, and every existing test, command, and workflow that never
opts into `milestone` strategy must continue to behave byte-for-byte as it does today.

Two smaller, unrelated pieces of scope ride this milestone at the developer's explicit
direction rather than each consuming a dedicated milestone of their own: AC008 codifies,
as a real installed `protocol-driver.md` section, a verification-discipline correction
the developer gave live during M011's execution ("put it to pitway in next milestone");
and AC009's own reconciliation task additionally resolves a roadmap-numbering collision
the developer identified when directing this milestone's drafting -- a candidate
milestone, "PitWay Driver UX," previously recorded only in session memory with no real
roadmap slot, is given one here (the new M013), with the pre-existing M013/M014 chain
renumbered down to M014/M015 to make room, the same mechanic M009/T006 already used
twice for exactly this kind of insertion.

## Scope

- `config.yaml` gains an additive-optional `git.branch_strategy: 'main' | 'milestone'`
  field; absent resolves to `main`, byte-identical to today's only behavior.
- `milestone-confirm` creates a deterministically-named branch
  (`pitway/<id>-<slug>`, reusing the existing `slugifyTitle`) under `milestone`
  strategy, only after the existing safety check passes, and records `base_branch`
  (never hardcoded) and `base_revision` in contract frontmatter -- two new
  additive-optional, nullable fields, null for every historical milestone and every
  `main`-strategy confirm. A fresh confirm refuses outright if the deterministic
  branch name already exists (foreign collision or PitWay's own orphaned attempt
  alike -- never reused, reset, or force-created over); a resumed confirm performs
  no branch mutation at all and refuses unless the currently checked-out branch is
  exactly the milestone's own already-created branch.
- A shared branch guard, wired into every commit-producing operation for an active
  `milestone`-strategy milestone (task completion, milestone-complete), refuses on a
  checked-out-branch mismatch before committing anything -- never auto-checkouts.
- `pitway resume` surfaces a tracked branch and any mismatch, read-only, for
  orientation only -- it never runs a checkout itself.
- `resolveCommitSha` gains an optional range-scoping parameter bounding trailer lookup
  to `<base_revision>..HEAD` when available; an unreachable `base_revision` throws a
  clear diagnostic rather than silently widening to an unbounded scan (a silent
  fallback would undermine the branch-isolation guarantee `base_revision` exists to
  provide -- see AC005). `main`-strategy behavior stays fully unbounded and unchanged.
  `resolveChangeCommitSha` (quick-change) is untouched.
- `milestone-complete` reaches a verified merge-ready/PR-ready state under `milestone`
  strategy -- proven by concrete git-plumbing assertions, not asserted in prose --
  without ever performing an automatic merge, force-push, or branch deletion.
- A real end-to-end lifecycle test against an actual temporary git repository, plus a
  full regression pass proving `main`-strategy behavior is completely unaffected.
- A new `protocol-driver.md` "Verification discipline" section (AC008).
- `IMPLEMENTATION_PLAN.md` reconciliation, including the roadmap-numbering fix that
  inserts "PitWay Driver UX" as the new M013 and shifts the existing M013/M014 chain to
  M014/M015 (AC009).

**Out of scope**: no automatic merge, rebase, or conflict resolution of a completed
milestone branch back into its base branch -- completion reaches merge-ready state and
stops; a human (or a future, separately proposed milestone) decides when and how to
merge. No parallel task worktrees or concurrent task execution -- that remains M014 (per
this milestone's own AC009 renumbering) and depends on this milestone's own branch work
existing first, per §15's stated sequencing. No per-task branch of any kind -- the
durable principle stays milestone-owns-branch, task-owns-commit. No change to how
`quick-change` operates -- it stays explicitly milestone-less and continues to commit
directly wherever it is invoked, unaffected by `branch_strategy`. No retroactive branch
creation for any of PitWay's own eleven already-completed milestones. No UI, dashboard,
or any mechanism for actually opening a PR -- "PR-ready" means the branch and its commit
history are in a mergeable, clean state; PitWay itself never talks to a Git hosting
service. "PitWay Driver UX" (AC009's roadmap-numbering fix) gains a real roadmap slot and
short description only -- it is not drafted, scoped into tasks, or implemented by this
milestone.

## Change Log

(none yet)
