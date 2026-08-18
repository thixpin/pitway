---
schema_version: 1
id: M005
title: "Workflow Hardening: checkpoint semantics, task amendments, and slugged
  directories"
status: in_progress
requirement: null
confirmed_at: 2026-08-18T18:29:51Z
verification_approved_hash: sha256:e637335476d65cb930e435dbce38a55777f747ab5d74938321cbc81b2db80b67
acceptance_criteria:
  - id: AC001
    text: "A resumable, git-invisible runtime journal exists at a path resolved
      through the Git module — equivalent to `git rev-parse --git-path
      pitway/journal.yaml` — never a hard-coded `.git/pitway/journal.yaml`
      string, so it resolves correctly when `.git` is a file pointing at a
      linked worktree's real gitdir. The resolved path is passed into the State
      layer, which owns the actual read/write. The journal is local/untracked by
      construction (inside the git-private directory, never part of what `git
      status` sees), so it never introduces its own commit and never leaves the
      tracked tree dirty between checkpoints; disclosed limitation: journal
      durability covers only the current local git repository/worktree — it does
      not survive deleting `.git` or checking out a fresh clone, by the same
      construction that makes it commit-invisible. It is append-only: entries
      are never cleared or deleted. Every entry carries, at minimum: milestone
      id, operation type (usage_recording | contract_amendment | task_amendment
      — the three kinds that, before this milestone, either created their own
      standalone commit or have no supported command at all), an operation
      identity, a target identifier where applicable (e.g. the task id for a
      task_amendment), and the validated payload (field diff or re-approved
      hash). A checkpoint is recorded by appending a distinct
      checkpoint/reconciliation marker entry referencing the original entry's
      identity and the commit SHA that captured it — never by rewriting or
      removing the original entry; a single commit SHA may be referenced by more
      than one checkpoint marker when several pending entries were materialized
      before that commit (tested explicitly). A read-pending query derives
      pending entries as those with no matching checkpoint marker (a computed
      view over the append-only log, not a stored deletion). Recovery for the
      crash window after a checkpoint commit succeeds but before its marker is
      written: on resume, before trusting 'pending', re-derive checkpoint status
      by checking (in order) for an existing checkpoint marker, then — reusing
      the same commit-identity lookup already used throughout M001-M004
      (resolveCommitSha / commitOrResume's findExistingCommit pattern) — whether
      a commit already exists whose content matches the entry's payload; if so,
      the marker is appended now (self-healing, idempotent) rather than the
      operation being re-applied. task_transition (ready/in_progress/review) and
      verification_result writes stay entirely outside this journal — their
      existing tracked, uncommitted `.pitway/` state-file behavior (unchanged
      since M001) is sufficient and already folds into whatever commits next
      without any new machinery."
  - id: AC002
    text: "Working-tree dirty-path classification distinguishes PitWay-expected
      dirty state from unexpected user changes, built on a verified clean
      baseline: a path is expected only if (a) the task currently in_progress
      started from a confirmed clean tree (the existing task-start invariant,
      unchanged) and the path falls within that task's write scope, or (b) the
      path is a state file associated with a pending journal entry (AC001) or an
      ordinary pending task_transition/verification_result write. A path is
      never classified expected merely because it is declared in a task's
      write_scope while no task is actually in_progress, or before the
      clean-start check has run — declaration alone grants no expectation.
      Disclosed limitation: PitWay cannot distinguish a worker's own edit to a
      permitted file from a concurrent developer edit to that same file made
      while the task is in_progress — both are equally 'expected dirty' by path,
      and this is a known, accepted limitation, not silently hidden."
  - id: AC003
    text: "tasks.yaml gains two additive-optional schema-v1 fields, context_files (a
      declarative list of files a worker may read — schema boundary only in
      M005, with no runtime read-enforcement; bounded-worker enforcement is M006
      Claude-integration scope) and write_scope (files a worker may
      create/modify — the real, enforced dirty-subset and completion-staging
      boundary, exactly as relevant_files enforces today), with the complete
      field-combination rule, validated at load/schema time: relevant_files only
      -> legacy behavior, unchanged (readable and writable,
      write_scope-equivalent). write_scope only -> unrestricted task-relevant
      reads (context_files unset, no read restriction declared), write_scope is
      still the enforced write/ completion boundary. context_files + write_scope
      together -> declared reads plus enforced writes; every path in write_scope
      must also appear in context_files (a task is never declared writable
      somewhere it wasn't declared readable) — a write_scope path absent from
      context_files is rejected at validation, naming the offending path.
      context_files alone (no write_scope, no relevant_files) -> rejected as
      incomplete: declaring readable paths without ever declaring the write
      boundary leaves completion staging undefined. relevant_files together with
      either context_files or write_scope on the same task -> rejected as
      ambiguous, naming the conflicting fields. No task ever carries both an
      old-style and new-style scope declaration, and no task's declared reads
      are ever narrower than its enforced writes."
  - id: AC004
    text: "usage-add and milestone-confirm --amend no longer create a standalone or
      ancillary commit of their own. Corrected materialization sequence,
      applying identically to usage recording and contract amendments (and, per
      AC005, task amendments): (1) validate the input; (2) append the validated
      pending operation to the journal (AC001, type usage_recording or
      contract_amendment); (3) immediately and idempotently write the validated
      change to the real authoritative .pitway/ file — materialization is not
      deferred to checkpoint time; (4) as a direct consequence, every subsequent
      read — resume, verify, task-status, task-context, another usage-add/amend
      invocation — sees the amended state immediately, because it is reading the
      real file, already updated; (5) the next checkpoint of any kind (normally
      the next task-completion checkpoint, otherwise the milestone-terminal
      checkpoint) commits this already-materialized state exactly as it would
      commit any other dirty PitWay-expected file (AC002) — the
      checkpoint-creating code does not re-materialize anything, it only
      recognizes the file as expected-dirty and includes it; (6) only after that
      commit succeeds does the checkpoint-creating code append the checkpoint
      marker(s) for whichever pending entries the commit covered (possibly more
      than one, per AC001). Recovery covers three interruption windows
      distinctly: (a) interrupted before the authoritative write (a pending
      journal entry exists but the .pitway/ file was never updated) — resume
      re-applies the write from the journal entry's payload, idempotently; (b)
      interrupted after the authoritative write but before the next checkpoint
      commit (the file is dirty, matching AC002's expected-dirty classification,
      no different from any other pending state) — the next checkpoint simply
      picks it up as usual; (c) interrupted after the checkpoint commit but
      before its marker is written — AC001's self-healing recovery applies.
      Since a direct hand-edit of contract.md is prohibited, milestone-confirm
      --amend accepts a supported amendment-input path — a validated draft
      contract file, or structured field-level changes passed as command input —
      rather than depending on an untracked edit of authoritative state;
      validated PitWay command writes are the only writes ever made to
      contract.md; developer approval and hash re-approval remain mandatory
      regardless of which input form is used. Folding into the next checkpoint
      never depends on whether a task happened to already be in progress when
      the entry was recorded. Ambiguous journal recovery (AC001) blocks
      execution with a precise diagnostic rather than guessing. M004's
      historical AC008 ancillary-usage-commit behavior and its actual commits
      are unchanged by this. M005's own task-completion commits (T001-T009) use
      the existing, unchanged M004-era checkpoint mechanism throughout — this
      criterion's mechanism only becomes usable once T004 lands within M005, and
      is authoritative for every milestone starting with M006; it is not
      retroactively true of M005's own earlier history."
  - id: AC005
    text: "A validated, developer-approved task-definition amendment command exists:
      it validates the proposed change (schema, referential integrity, AC003's
      field-combination rule), requires explicit developer approval, and follows
      AC004's exact materialization sequence with journal type task_amendment:
      append the validated pending operation (operation identity, the validated
      field diff, and Change Log evidence to append to the contract body), then
      immediately and idempotently write the change to tasks.yaml — never as a
      standalone commit, never as a direct tasks.yaml hand-edit; validated
      command writes are the only writes ever made to tasks.yaml. The amendment
      folds into the next checkpoint and blocks on ambiguous recovery exactly as
      AC004 describes, including AC004's three-window interruption recovery.
      This command is the durable fix for the M004/T006 and M004/179491c gaps
      (see IMPLEMENTATION_PLAN.md §16 risk 8)."
  - id: AC006
    text: "A write-ms-artifacts command (new top-level CLI command, not a
      subcommand) writes a draft contract and task graph as non-authoritative
      artifact files without confirming the milestone, committing, dispatching
      any task, or mutating any authoritative .pitway/ state — reusing
      milestone-add's existing input validation (schema, criterion-reference,
      dependency-graph checks) without its state-mutating half — supporting a
      'write artifacts only, I will review/edit them myself' path distinct from
      milestone-add's normal draft-then-confirm flow. Output safety: the
      destination is an explicit, required argument (never an implicit or
      inferred location); the command refuses to write inside authoritative
      .pitway/ (a destination under .pitway/ is rejected before anything is
      written, naming the conflict); and it refuses to overwrite an existing
      file at the destination unless overwrite is explicitly requested, naming
      the pre-existing path rather than silently replacing it. Registered on the
      single CLI entry point (buildCli + registerAllCommands) and covered by the
      same registration/reachability test pattern as every other command
      (M004/T007)."
  - id: AC007
    text: "Newly created milestones from M006 onward use directory MNNN-<slug>: the
      slug is derived once from the contract title (lowercase; runs of
      non-alphanumerics collapse to single hyphens; trimmed of leading/trailing
      hyphens; truncated at a word boundary to at most 40 characters; empty
      result falls back to the bare id), never regenerated or renamed; the bare
      MNNN id remains the sole canonical identifier in CLI arguments,
      state.yaml, contract frontmatter, depends_on, and git trailers. Directory
      resolution by canonical id lives only in the state store and succeeds only
      when exactly one candidate exists (a bare MNNN directory, grandfathering
      M001-M005, or a single MNNN-* directory); zero candidates, multiple
      slugged candidates, or a bare-and-slugged directory coexisting all refuse
      with a diagnostic naming the candidates. M005 itself is created and stays
      a grandfathered bare directory: slug support does not exist yet when M005
      is created (this milestone is what builds it)."
  - id: AC008
    text: "M001-M004 history keeps working unmodified under every change above:
      existing bare milestone directories, existing relevant_files-only task
      definitions, and the pre-journal commit shapes already in this
      repository's git history all continue to load, resolve, and resume
      correctly. No historical file or commit is rewritten."
  - id: AC009
    text: A roadmap-reconciliation review confirms IMPLEMENTATION_PLAN.md's stated
      command surface (13 commands once task-amend and write-ms-artifacts land —
      11 through M004 plus these two), milestone table, and M005-M011 roadmap
      section accurately describe the repository's actual state as of M005's
      completion, with any discovered drift corrected in the plan through this
      task rather than left stale. The M005-vs-M006 authoritative-checkpoint
      wording was already corrected before M005's baseline (see Change Log) —
      this review verifies that correction remains accurate against what M005
      actually delivered, it does not need to author it.
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npm test -- tests/unit/journal.test.ts
  - id: CT002
    criterion: AC002
    type: command
    command: npm test -- tests/unit/journal.test.ts tests/unit/git-safety.test.ts
  - id: CT003
    criterion: AC003
    type: command
    command: npm test -- tests/unit/schemas.test.ts
  - id: CT004
    criterion: AC004
    type: command
    command: npm test -- tests/integration/usage-add.test.ts
      tests/integration/milestone-confirm.test.ts
      tests/integration/task-update.test.ts
      tests/integration/milestone-complete.test.ts
  - id: CT005
    criterion: AC005
    type: command
    command: npm test -- tests/integration/task-amend.test.ts
  - id: CT006
    criterion: AC006
    type: command
    command: npm test -- tests/integration/write-ms-artifacts.test.ts
      tests/integration/cli.test.ts
  - id: CT007
    criterion: AC007
    type: command
    command: npm test -- tests/integration/milestone-add.test.ts
      tests/unit/state-store.test.ts
  - id: CT008
    criterion: AC008
    type: command
    command: npm test
  - id: CT009
    criterion: AC009
    type: review
    instruction: Before completion, re-read IMPLEMENTATION_PLAN.md's §7 command
      table, the Bootstrap delivery table, and the M005-M011 roadmap section
      against the actual repository state and correct any drift found, then
      record what was checked and what (if anything) was corrected. Specifically
      re-verify the M005-vs-M006 authoritative-checkpoint wording (already
      corrected pre-baseline, commit 87eb6bb) is still accurate against what
      M005 actually delivered.
---

# Contract — M005: Workflow Hardening

## Objective

Close the task/contract-amendment integrity gap discovered during M004
(commit 179491c's hand-edit, T006's forced cancellation) with a validated,
journal-backed amendment mechanism; replace M004's usage-add and
milestone-confirm --amend ancillary/standalone commits with a
three-checkpoint Git model (milestone started/confirmed, task completed,
milestone completed/cancelled) backed by a resumable, git-invisible runtime
journal for pending usage/amendment operations; split task scope into a
declarative `context_files` read boundary and an enforced `write_scope`
write boundary; add a draft-artifacts-only command; and implement the
slugged-directory design originally scoped for M004/T006, effective from
M006 onward. M005 itself is the transition milestone: it is built and
completed under the existing M004 checkpoint mechanics throughout its own
task-completion commits, and stays a grandfathered bare directory.

## Scope

- Resumable, git-invisible runtime journal (path resolved via the Git
  module, `git rev-parse --git-path pitway/journal.yaml`-equivalent, never
  hard-coded — works under linked worktrees): append-only, milestone id +
  operation type + operation identity + target id + validated payload per
  entry, checkpoint-marker-based (one commit may cover several pending
  entries), durable across interruption, self-healing recovery via
  existing commit-identity lookups. Local to this git repository/worktree
  only — does not survive `.git` deletion or a fresh clone.
- Working-tree classification: PitWay-expected dirty (verified-clean-start
  task write scope, or a pending journal/ordinary-transition entry) vs.
  unexpected user dirty; concurrent-edit-in-permitted-file limitation
  disclosed, not hidden.
- `context_files` (declarative-only in M005) / `write_scope` (enforced)
  additive-optional schema-v1 fields, full 5-case combination rule.
- Checkpoint-model revision: `usage-add` and `milestone-confirm --amend`
  stop creating their own commits; both journal-record then immediately
  and idempotently materialize the change into the real `.pitway/` file
  (not deferred to checkpoint time — reads see it right away); the next
  checkpoint of any kind commits the already-materialized state and only
  then appends the checkpoint marker(s); three-window interruption
  recovery (before/after materialization, before the marker); ambiguous
  recovery blocks execution. `milestone-confirm --amend` gains a supported
  amendment-input path.
- Validated task-amend CLI command (new top-level command, wired into the
  single entry point), following the identical journal-then-materialize
  sequence with journal type task_amendment.
- `write-ms-artifacts` (new top-level CLI command, wired into the single
  entry point) draft-artifact command with explicit-destination,
  no-write-inside-.pitway/, no-silent-overwrite safety.
- Slugged milestone directories, effective M006 onward.
- Migration/compatibility verification for M001-M004 history.
- Roadmap-reconciliation review against `IMPLEMENTATION_PLAN.md`.

## Non-Goals

- Claude integration assets, driver protocol, interactive arrow-key UX,
  context-efficiency measurement, and runtime enforcement of `context_files`
  read boundaries (all M006).
- Dogfood validation, Adaptive Workflow Intensity decision (M007).
- README, packaging, npm publish, the real `pitway` bin's build step (M008).
- Milestone git branch isolation, parallel task worktrees (M009-M010).
- No automatic merges, no parallel execution in M005 itself, no plugin
  framework.
- Moving task_transition or verification_result persistence off their
  existing plain uncommitted tasks.yaml/verification-results.yaml writes —
  those already satisfy the checkpoint model unmodified.

## Non-Bootstrap Disclosure

M005 cannot have used the journal/checkpoint model before T001 and T004
implement it. M005's own task-completion commits (T001 through T009) all
use the existing, unchanged M004-era mechanism — a plain
`task-update --status completed` atomic commit per task — throughout,
including for tasks that come after T004 in the sequence; nothing in this
contract requires or claims that M005 amends itself using the new
mechanism mid-milestone. The three-checkpoint model becomes the
authoritative, required mechanism starting with M006's own lifecycle
(M006's baseline confirm onward), the same way M004's `milestone-complete`
command was necessarily built and then used on M004 itself without that
being a contradiction — a milestone may use a command it just finished
building for its own *later* lifecycle events, never for earlier ones that
already happened under the prior mechanism.

## Design Decisions

- Three checkpoint kinds only (milestone start/confirm, task completion,
  milestone terminal); the journal exists specifically for the two
  operation kinds that currently violate this (usage recording, contract
  amendment) plus the new task-amendment kind — not for task_transition or
  verification_result, which already comply without new machinery.
- The journal lives inside the git-private directory (resolved through the
  Git module, not `.pitway/`), matching the existing rule that
  runtime-disposable data is never written into the version-controlled
  `.pitway/` tree (IMPLEMENTATION_PLAN.md §10) — this is what makes
  "local/untracked, no extra commits, never permanently dirty" true by
  construction rather than by convention. Resolving the path via
  `git rev-parse --git-path` rather than a hard-coded `.git/...` string is
  what makes this correct under linked worktrees, where `.git` is a file,
  not a directory — the same generality principle already applied to
  slugged-directory resolution and the field-combination rules.
- Materialization is immediate, not deferred to checkpoint time: an
  amendment or usage recording is real and readable the moment its
  command succeeds (journal entry appended, then the authoritative file
  written) — the checkpoint commit that follows is bookkeeping (attributing
  an already-true state change to a durable Git record), not the moment the
  change takes effect. This is also why the checkpoint-creating code needs
  no knowledge of journal payloads: it only needs AC002's expected-dirty
  classification and, after committing, AC001's marker-append step.
- The task-amendment and contract-amendment paths share the same
  journal-recording mechanics (operation identity, validated diff/hash,
  Change Log evidence, ambiguous-recovery blocking, checkpoint-folding)
  rather than each inventing its own.
- `context_files` is declarative-only in M005 deliberately — runtime
  read-enforcement requires the Claude-integration bounded-dispatch
  mechanism that doesn't exist until M006; shipping an unenforced
  read-restriction claim now would be dishonest about what M005 actually
  guarantees.
- `context_files`/`write_scope` are additive-optional specifically so
  M001-M004's `relevant_files`-only tasks need no migration; ambiguous or
  incomplete combinations are rejected rather than silently resolved,
  matching the project's "no candidate ever silently preferred" pattern.
- Slug rule applies to all newly created milestones from M006 onward with
  bare-id directories (through M005) grandfathered — no repository-specific
  threshold constant in generic tool code.

## References

- IMPLEMENTATION_PLAN.md §5 (milestone state machine), §10 (Git strategy,
  as revised 2026-08-19), Bootstrap → Revised Roadmap section (M005-vs-M006
  wording already corrected pre-baseline, commit 87eb6bb).
- M004 Change Log (AC012/AC013 deferral; AC014 self-hosting-boundary
  disclosure of commit 179491c) and M004 §16 risk 8.

## Change Log

- (none yet — draft; IMPLEMENTATION_PLAN.md's M005-vs-M006
  authoritative-checkpoint wording was corrected separately, before this
  milestone's baseline, as its own `docs:` commit (87eb6bb) — not a
  contract amendment, since the contract itself does not yet exist.)
