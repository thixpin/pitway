---
schema_version: 1
id: M006
title: Verification Hardening, Claude Integration, and Context Efficiency
status: completed
requirement: null
confirmed_at: 2026-08-19T08:05:12Z
verification_approved_hash: sha256:dcdb7510bc0a1e48976256eaae92996b13eb6b8df038e437a23fe1951e72adac
acceptance_criteria:
  - id: AC001
    text: "Verification-execution hardening — the confirmed defect from M005
      report.md §7/§13: no per-check timeout, and an unguarded recursion path
      that produced a multi-hour hang with zero persisted results (see that
      report for the full incident narrative). Command-type checks gain an
      additive-optional `timeout_ms` field in contract frontmatter
      (verificationCheckSchema's command variant only — adding it to a
      manual/review check is rejected by the existing strictObject
      discrimination, no new code needed to enforce this), validated as a
      positive integer between 1 and 3,600,000 (one hour); a safe default
      (120000ms, the same bound this session's own diagnostic isolation testing
      used successfully) applies when omitted; both the bounds and the default
      are covered by dedicated schema tests. Because computeVerificationHash
      already hashes the raw text of the entire `verification:` frontmatter
      block, timeout_ms is included in the approved hash by construction the
      moment it appears in that block — no separate change to the hashing
      function is needed, and every M001-M005 contract (with no timeout_ms on
      any check) continues to hash and load unchanged. A new process-execution
      helper (src/core/verification/ process-exec.ts) runs a command check
      bounded by its configured (or default) timeout and, on timeout, terminates
      the full descendant process tree — platform-aware: POSIX spawns the check
      detached so it becomes its own process-group leader, and a timed-out or
      otherwise- still-alive group is killed via the negative-pid group-kill
      convention (process.kill(-pid, 'SIGKILL')); Windows has no equivalent
      process-group primitive, so cleanup there is implemented via `taskkill
      /pid <pid> /t /f` as a best-effort follow-up. Both paths are implemented
      and both are tested: the POSIX path by a real fixture process (spawned
      detached, ignoring SIGTERM, forking an also-ignoring child) asserting zero
      survivors, exercised natively since this repository's CI runs
      Darwin/Linux; the Windows path by a platform-mocked decision-path test
      (process.platform forced to 'win32', child_process execution mocked)
      asserting taskkill is invoked with the expected arguments — a test of the
      branch taken, not of live Windows process termination, and this
      distinction is stated explicitly: the Windows cleanup code is implemented
      and its decision path is unit-tested, but its actual real-world
      termination behavior is not verified in this milestone, because no Windows
      CI environment is available here. Every check outcome records a
      termination_reason of exited | timeout | signal | spawn_error —
      spawn_error covers a command that could never be spawned at all (missing
      binary, permission denied, shell unavailable), distinct from a normal
      nonzero exit or a timeout-triggered kill, closing the gap in run.ts's
      current comment ('a signal kill or spawn failure has no exit code; both
      count as fail') by actually distinguishing them for diagnostics rather
      than collapsing both into one undifferentiated failure. Captured
      stdout/stderr is bounded (a fixed character cap, tail-preserved) via one
      shared tail-truncation helper (src/core/verification/text-trim.ts) built
      and unit-tested standalone first, matching run.ts's existing private
      trimEvidence behavior without yet touching run.ts; run.ts's own private
      trimEvidence is then removed and run.ts switched to the shared helper as
      part of wiring this AC into run.ts, so the logic is defined once and
      reused — by process-exec.ts's own bounded capture, by run.ts's evidence
      trimming, and by AC006's worker-report capping — rather than three
      independent copies of the same truncation scheme. Whether the
      process-execution helper stays synchronous is evidence-gated, not a
      preference for convenience: spawnSync supports a timeout option natively,
      so it may remain synchronous ONLY if the real POSIX descendant-process
      fixture test (a detached child ignoring SIGTERM, forking an also-ignoring
      child) proves bounded termination and zero survivors using a synchronous
      implementation; if that cannot be achieved synchronously, the execution
      primitive converts to async, and the ripple below follows as a required
      consequence, not an optional one. A recursion guard prevents a
      verification command from re-entering runVerification for the SAME live
      repository and milestone, while explicitly PERMITTING nested verification
      of an unrelated repository or milestone (this repository's own integration
      tests routinely spin up synthetic temp git repos and run real `pitway
      verify` invocations inside them from within the outer suite — that must
      keep working). The guard is scoped to canonical repository/gitdir identity
      plus milestone id, not milestone id alone: an environment variable (e.g.
      PITWAY_VERIFY_ACTIVE) carries an accumulating list of
      `<canonical-git-dir>::<milestoneId>` tokens already in progress up the
      call stack; runVerification resolves the current repo's canonical git-dir
      (a new resolver in src/git/paths.ts, the Git module — Core is permitted to
      depend on it) plus the target milestone id, refuses loudly if that exact
      token is already present, and otherwise extends the environment passed to
      every spawned check with its own token appended before proceeding — so two
      different temp repositories (or the same repository at two different
      milestones) never trip each other's guard, only genuine
      same-repo-same-milestone re-entry does. Normal verification-driver or
      diagnostic-harness files live outside the tests/**/*.test.ts glob, and a
      test asserts that glob does not pick one up; separately, if a test file
      that WOULD recursively invoke verification for the same live
      repo/milestone is deliberately introduced as a fixture (proving the fix,
      not describing normal practice), the outer verification run terminates in
      bounded time via the recursion guard's immediate refusal — not the
      timeout, and not a hang — records the affected check as failed with a
      clear reason, preserves every already-completed check's result (via the
      incremental persistence below), and leaves zero orphan processes; it must
      never silently continue, hang, or report a false pass. runVerification
      persists each check's outcome incrementally, immediately after that check
      completes, not only once after the entire loop finishes, so a hang,
      timeout, or recursion refusal on one check never discards
      already-completed checks' results (the second root cause named in
      report.md §7). verification-results.yaml gains two further
      additive-optional fields per result entry: duration_ms (elapsed wall time)
      and the termination_reason above, without changing existing
      token-accounting semantics or breaking any historical result entry lacking
      them. If the sync-vs-async evidence above requires converting to async,
      the ripple is confined to run.ts's exported functions and verify.ts's CLI
      action handler (commander supports async actions natively) — already
      declared here so T002 has no ambiguity about scope if that conversion is
      needed."
  - id: AC002
    text: "Post-timeout recovery discipline draws a hard line between what Core does
      and what the Claude driver decides — Core never performs automatic
      retry-then-force-a-pass 'agent judgment'. Core's contribution (AC001) is
      exactly: record the timeout with duration/termination_reason, terminate
      the process tree, persist the result immediately, and support re-running
      one already-approved command check in isolation on demand (pitway verify
      <id> --check CTnnn, invoked without --pass/--fail/ --evidence, executes
      and persists that single command check through the same hash-gated,
      timeout-protected path as a full run — a real, bounded extension of the
      existing --check flag's meaning for command-type checks specifically; its
      manual/review recording behavior is unchanged). Retry-or-diagnose policy —
      whether to retry at all, whether a passing retry is trustworthy, whether
      to keep investigating a still-failing check — is applied by the Claude
      driver via the protocol assets (AC003) and the interactive decision UX
      (AC010), never by Core. Because verification-results.yaml is append-only
      (existing convention, unchanged), both the original timed-out attempt and
      a subsequent isolated-rerun attempt are preserved as distinct entries
      automatically — no new persistence mechanism is needed for this. A passing
      isolated rerun that follows a prior timeout is treated as one of AC010's
      decision gates: the driver must not auto-continue toward
      milestone-complete on the strength of that pass alone without an explicit
      developer completion decision."
  - id: AC003
    text: "Claude Code integration text assets exist for the complete operational
      lifecycle the driver actually exercises, not only the six read-oriented
      commands originally scoped in IMPLEMENTATION_PLAN.md §9 — thin .md assets
      under src/integrations/claude/commands/ for milestone-add,
      milestone-confirm, milestone-status, milestone-list, task-status,
      task-update, task-amend, resume, verify, milestone-complete, usage-add,
      and write-ms-artifacts (12 of the 13 commands through M005; init is
      developer-run once at setup and already self-documents via --help, so it
      gets no slash-command asset; auto-run gets its own asset under AC009/AC010
      since it does not exist until that capability lands). The driver protocol
      is split at authoring time into two documents —
      src/integrations/claude/protocol-driver.md (main-session-facing: dispatch
      discipline, state-mutation-only-via-CLI, decision gates) and
      src/integrations/claude/protocol-worker.md (the fixed wrapper text
      accompanying a --context bundle to a dispatched subagent, and nothing
      else) — so a dispatched worker's installed instructions never include the
      full driver document. This same task also covers dispatch honesty (AC004),
      worker-report capping (AC006), LSP guidance (AC007), and shared-worktree
      coordination guidance (AC008) — all of it edits to the same
      src/integrations/claude/ asset tree, delivered together rather than as
      separate single-file tasks, while each capability keeps its own AC and CT
      (see Design Decisions). init installs every .md file that exists under
      src/integrations/claude/ at install time — the installer (a new
      State-layer module, src/state/claude-assets.ts) globs the bundled tree
      rather than copying a hardcoded file list, so a later task (AC009/AC010)
      adding auto-run.md and interactive-ux.md is installed automatically, with
      no separate wiring step and nothing to keep in sync; a final integration
      test, added once every M006 asset-creating task has landed, asserts init
      installs the complete current set, not merely the subset that existed when
      the installer was first written. Installation is default, opt-out
      --no-claude (IMPLEMENTATION_PLAN.md §17 Q4); src/integrations/claude/
      itself contains only text assets, zero .ts files and zero runtime code,
      matching IMPLEMENTATION_PLAN.md §9's 'no runtime code' description
      literally, verified by a test asserting that directory contains no .ts
      file. Explicit clarification (item 7): PitWay does not programmatically
      spawn Claude agents anywhere in this codebase — no Anthropic/Claude SDK
      import exists or is added in Core, State, the Git module, or
      src/integrations/claude/ itself; the installed protocol documents instruct
      whatever agent driver is already running (Claude Code today, any
      compatible driver in principle) on how to use its own tooling to dispatch
      subagents and how to call the pitway CLI — PitWay supplies instructions
      and, where a genuinely provider-neutral pure function is useful (AC004's
      checkWriteScope helper), a small Core utility any driver or a human could
      call directly; it never supplies an agent-spawning mechanism of its own."
  - id: AC004
    text: "Dependency-aware bounded dispatch, honestly scoped. The driver dispatches
      exactly the tasks resolveReadyTasks marks ready, respecting depends_on,
      never in parallel (sequential MVP, unchanged). For each dispatched task,
      the existing task-status <id> --context --json bundle (already minimal by
      construction — no milestone history, no other tasks' full detail, only
      each dependency's concise result.summary) is generated once per attempt
      and passed verbatim with the fixed worker wrapper (AC003) — the driver
      never re-plans or reconstructs the task, never duplicates a per-task
      PLAN.md-style file. Before dispatch, a new pure Core helper,
      checkWriteScope(writePaths, task) (src/core/tasks/write-scope-check.ts),
      mechanically compares a STRUCTURED list of file paths the driver is about
      to authorize a worker to WRITE — data the driver assembles, never text
      inferred from arbitrary prose — against the task's declared write_scope
      when present, falling back to legacy relevant_files when it isn't, naming
      any path outside that boundary; this directly targets the M005 T001
      incident (a driver prompt, not this mechanism, authorized an out-of-scope
      edit that only the completion gate caught after the fact). The helper is
      explicitly write-only, by name and by behavior: it never validates
      against, and makes no claim about enforcing, context_files or any other
      read boundary — context_files remains exactly what the honesty boundary
      below states, declarative supplied-context metadata with no runtime
      read-enforcement. Honesty boundary, stated precisely: PitWay claims only
      that the SUPPLIED context bundle is bounded — it does not and cannot claim
      that the subagent's total context is bounded, because the harness spawning
      that subagent independently injects its own system prompt, tool
      definitions, skills, and memory, none of which PitWay controls or can see
      (this is decision 1's 'session context bleed' limitation, extended
      explicitly to subagents, which was previously only disclosed for the main
      session). PitWay does not claim, and this milestone does not build, any
      runtime prevention of a worker reading a file outside context_files — a
      subagent with filesystem/shell tools can read anything on disk regardless
      of what PitWay declares; only the WRITE boundary (write_scope) is
      enforced, and only at commit time, by the existing M005
      classifyDirtyPaths/assertDirtySubset mechanism, unchanged by this
      milestone. Whether and how to build actual read enforcement (e.g.
      restricted tool permissions, a sandboxed worktree) is explicitly preserved
      as an M007 decision, not decided or implemented here."
  - id: AC005
    text: Context-efficiency measurement separates what PitWay's own assets and
      process control (installed asset size — including the AC003 driver/worker
      split, bundle size, duplicated text, repository-read count, output/report
      size per AC006, full-suite invocation count) from what it does not (the
      harness's inherited system/tool/skill/memory context). Before/after token
      comparisons are made only under comparable model/configuration conditions
      between the two measurements — a comparison across different models or
      harness versions is not treated as evidence of a PitWay-caused change.
      Recorded against the M004/M005 measured baseline (main-loop
      dispatch/planning ~12K tokens, worker startup >30K tokens, worker growth
      ~22K-52K tokens over a run, main-loop growth +51.2K tokens per dispatch —
      M005 report.md §8) with an explicit statement of which factors this
      milestone can and cannot claim credit for reducing. This comparison is a
      real, committed deliverable of the milestone — recorded at docs/evidence/
      M006-context-efficiency.md, not a draft — since it is evidence the
      milestone's own completion depends on, not a working note.
  - id: AC006
    text: "Worker reports stay concise and machine-readable: task-update's --result
      input caps the summary and evidence fields at a fixed character length,
      truncating to a preserved tail with a truncation marker when exceeded —
      reusing the AC001 shared text-trim helper rather than a second truncation
      scheme — so a report exceeding the cap is bounded, not silently dropped,
      and the cap applies only to new writes; no historical result is rewritten
      or invalidated. The driver protocol document states the
      targeted-tests-during-implementation, full-suite-only-at-the-final-gate
      discipline; this is a protocol convention PitWay cannot enforce in code
      (it does not control what commands a subagent runs mid-task), so it is
      documented as guidance, not claimed as an enforced behavior."
  - id: AC007
    text: "LSP usage guidance: a provider-neutral text asset instructs the driver to
      use a relevant language's LSP only when a compatible LSP capability is
      already available to it, and to proceed with standard filesystem/search
      tools otherwise, never installing or reconfiguring anything, treating any
      LSP diagnostic as advisory only alongside authoritative
      tests/lint/typecheck. This is guidance only — PitWay has no LSP detection
      or integration code of its own (per AC003's no-agent-spawning
      clarification, PitWay does not manage a driver's tool availability), so
      this AC's verification is a text review, not a test suite."
  - id: AC008
    text: "Shared-worktree coordination guidance: a text asset instructs the driver
      to take a fresh git status/diff snapshot — via the existing git-safety
      primitives (src/git/safety.ts), unchanged by this milestone — after each
      dispatched subagent completes, never trusting a snapshot taken before or
      during dispatch (the M004/T003 finding: a pre-dispatch snapshot went stale
      while a subagent wrote files). No new PitWay code is needed or added for
      this; the mechanism already exists, this AC is entirely about documenting
      its mandatory use in the dispatch sequence."
  - id: AC009
    text: "An agent-agnostic auto-run authorization mechanism exists in
      Core/CLI/State — not written directly by the Claude integration layer,
      which the current architecture forbids (the driver never touches .pitway/,
      or any git-invisible PitWay-owned state, directly; every mutation goes
      through a validated CLI command). A new top-level CLI command, `pitway
      auto-run`, with three subcommands each following the syntax `auto-run
      <subcommand> [milestone-id]` — `auto-run enable [milestone-id]`, `auto-run
      disable [milestone-id]`, `auto-run status [milestone-id]` (the milestone
      id is optional on every subcommand, defaulting to the active milestone,
      the same convention task-status and bare verify already use; `--json`
      supported on each) — is the 14th top-level command (program.commands gains
      exactly one new entry, `auto-run`; its three subcommands nest under it,
      not the top level), extending the count IMPLEMENTATION_PLAN.md recorded as
      13 through M005 — the roadmap-reconciliation task updates that document.
      `auto-run` manages authorization only — it never dispatches, executes, or
      transitions a task itself. `enable` requires the target milestone be
      in_progress (authorizing auto-run on a draft or already-finished milestone
      is meaningless) and appends a new, distinct journal record kind (auto_run)
      carrying the milestone id, the action, the contract's current
      verification_approved_hash, and an operation id — modeled as a sibling of,
      never a variant of, the existing entry/checkpoint kinds. `disable` and
      `status` work safely for any known milestone regardless of its current
      status — checking or revoking authorization must never itself require the
      milestone still be in progress, since a milestone can complete, get
      cancelled, or need its authorization inspected long after. This exclusion
      from the existing journal machinery is structural, not conventional:
      derivePending's type predicate (kind === 'entry') and resolveTargetPath's
      parameter type (Pick<JournalEntry, 'type'>, a field that exists only on
      entry-kind records) make it impossible, not merely discouraged, for an
      auto_run record to be returned by derivePending, resolved by
      resolveTargetPath, folded into a checkpoint marker, or touched by
      reconcilePending's self-healing recovery loop — no change to any of those
      four existing functions is needed or made; a dedicated test appends an
      auto_run record and asserts each of the four is unaffected, turning this
      structural claim into a verified fact. auto_run is never added as a fourth
      value of the existing entry-kind's operation-type enum (usage_ recording |
      contract_amendment | task_amendment) — it is a new top-level kind
      precisely because, unlike those three, it must never be folded into a
      checkpoint commit: auto-run authorization is repository/worktree-local and
      resumable — the exact same durability class as the rest of the M005
      journal it extends (persists across sessions within this repository, does
      not survive .git deletion or a fresh clone) — while still never being
      folded into a git commit, which is a separate, orthogonal property from
      its durability. `disable` and any future invalidation are always new
      appended records — journal history is never rewritten, mirroring the
      append-only discipline already established for entries and checkpoint
      markers. Authorization is scoped to milestone id + the contract's approved
      verification hash and is valid only when: the latest auto_run record for
      the milestone is an 'enable' (not superseded by a later 'disable'); its
      recorded hash matches the CURRENT approved hash (a hash change invalidates
      it, computed from a direct comparison, not an appended event); and no
      contract_amendment or task_amendment journal entry for that milestone —
      either kind of amendment — has been appended after it (computed from the
      append-only log's existing order, again no new write required for this
      check). `auto-run status` reports the specific reason when not authorized
      (never enabled | explicitly disabled | hash changed since | amendment
      recorded since)."
  - id: AC010
    text: "Interactive arrow-key decision UX, owned entirely by the Claude
      integration layer (Core and the CLI remain structured and non-interactive
      throughout, rendered via the driver's own interactive capability, not a
      PitWay-built TUI). Milestone approval: 'Confirm milestone <id>?' with
      options Yes (confirm and start) / No (leave unconfirmed, default) / Write
      artifacts only (write-ms-artifacts, never confirms/commits/dispatches);
      milestone id, title, and exact contract hash are shown before asking. Task
      continuation: 'Continue with next ready task <id>?' with options Yes - run
      this task only (default) / Auto-run - continue to milestone end / No -
      pause work (never cancels or fails anything). Selecting Auto-run calls
      `pitway auto-run enable`; every subsequent auto-continue step first calls
      `pitway auto-run status` (necessary but not sufficient) and additionally
      performs, before acting, EVERY one of the following live checks, none of
      which Core can precompute: unexpected dirty files (a fresh git-safety
      snapshot per AC008), a verification failure needing a decision (including
      AC002's flaky-pass-after-timeout case), missing manual/review evidence,
      ambiguity (including any Core ambiguity refusal, e.g. task-amend's), a
      permission requirement, a merge conflict, or a destructive action; hitting
      any one of these, or AC009's hash/amendment invalidation, halts auto-run,
      calls `pitway auto-run disable` so the durable record matches reality, and
      falls back to per-task confirmation. Bootstrap disclosure: M006 is the
      first milestone whose entire lifecycle — baseline confirm, every
      task-completion commit, and its eventual milestone-complete — uses M005's
      three-checkpoint/journal model as the normal, authoritative mechanism (per
      M005's own contract, that model is authoritative starting with M006's
      baseline confirm onward); M006 does not use the old M004-era mechanism the
      way M005 itself had to for its own earlier history. The only genuine
      bootstrap gap is narrower and specific to this AC: the interactive
      confirmation UX this AC builds does not exist until this task lands
      partway through the milestone, so M006's baseline confirm necessarily
      happens through the pre-existing, non-interactive milestone-confirm CLI
      command (unchanged, already available) rather than through the arrow-key
      prompt this AC itself defines — mirroring M004 building milestone-complete
      and then legitimately using it on itself for a LATER lifecycle event,
      never for an earlier one that already happened. The prompts are
      behaviorally reviewed by manually walking through the documented procedure
      against a synthetic temporary repository (CT011) — a review of whether the
      driver's actual behavior matches what the text asset specifies, since no
      code enforces it deterministically (these are instructions, not a runtime
      mechanism) — not against this repository's own live milestone state. Once
      this task is committed (itself via the now-fully-available
      journal/checkpoint model), M006's own remaining tasks may dogfood the
      task-continuation prompt on themselves, but the first real end-to-end
      dogfood of the milestone-confirm prompt against a genuine milestone
      lifecycle is reserved for M007's own confirmation, not M006's."
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npm test -- tests/unit/verification-process-exec.test.ts
      tests/unit/verification-recursion-guard.test.ts
      tests/unit/text-trim.test.ts
  - id: CT002
    criterion: AC001
    type: command
    command: npm test -- tests/integration/verify.test.ts tests/unit/schemas.test.ts
  - id: CT003
    criterion: AC002
    type: manual
    instruction: Confirm the Core-mechanics-vs-driver-policy split is implemented
      exactly as specified — Core never auto-retries or auto-forces a pass, the
      isolated single-check rerun path exists and is hash-gated, and both a
      timed-out and a subsequent passing attempt are preserved as distinct
      append-only entries.
  - id: CT004
    criterion: AC003
    type: command
    command: npm test -- tests/integration/init.test.ts
  - id: CT005
    criterion: AC004
    type: command
    command: npm test -- tests/unit/write-scope-check.test.ts
  - id: CT006
    criterion: AC005
    type: manual
    instruction: Review docs/evidence/M006-context-efficiency.md and confirm it
      explicitly separates controllable-and-measured factors from
      inherited-and-not-promised ones, under comparable model/config conditions.
  - id: CT007
    criterion: AC006
    type: command
    command: npm test -- tests/integration/task-update.test.ts
  - id: CT008
    criterion: AC007
    type: manual
    instruction: Review the LSP guidance text for accuracy against the
      advisory-only, no-PitWay-code constraint.
  - id: CT009
    criterion: AC008
    type: manual
    instruction: Review the coordination guidance text and confirm it references
      only existing, unmodified git-safety primitives.
  - id: CT010
    criterion: AC009
    type: command
    command: npm test -- tests/unit/auto-run-authorization.test.ts
      tests/integration/auto-run.test.ts
  - id: CT011
    criterion: AC010
    type: manual
    instruction: Manually walk through both prompts' documented behavior against a
      synthetic temporary repository, confirming the text asset covers every
      listed invalidation gate and the bootstrap disclosure. This checks
      documented completeness and actual driver behavior when following the text
      by hand — no runtime mechanism exists to enforce it deterministically, and
      none is claimed. Full real milestone-confirm dogfood remains M007's own
      confirmation, not this review.
  - id: CT012
    criterion: AC001
    type: command
    command: npm test
---

# Contract — M006: Verification Hardening & Claude Integration

## Objective

Close the confirmed verification-execution defect found during M005's own
`pitway verify` attempts (missing per-check timeout, an unguarded recursion
path) before building anything else in this milestone, since M006's own
execution will rely on `pitway verify` staying safe. Then install the
Claude Code integration (§9): text-only assets covering the complete
operational lifecycle, a driver/worker instruction split, an honestly-scoped
bounded-dispatch mechanism, worker-report and LSP/shared-worktree guidance,
an agent-agnostic auto-run authorization mechanism, and the interactive
arrow-key decision UX built on top of it — with an explicit, repeated
clarification that PitWay does not itself spawn or manage agents anywhere in
this codebase.

## Scope

- Verification-execution hardening, landing first: additive-optional
  `timeout_ms` per command check (hash-covered by construction), a
  process-execution helper with platform-aware descendant-process cleanup
  (Windows path implemented and decision-tested via mocks, not
  live-verified), a repo+milestone-scoped recursion guard, incremental
  result persistence, duration/termination-reason (incl. spawn_error)
  schema fields, a shared tail-truncation helper, and CLI support for an
  isolated single-check rerun.
- Post-timeout recovery discipline: Core provides mechanism only
  (record/terminate/persist/isolated-rerun); retry-or-diagnose policy is the
  Claude driver's, documented in the protocol assets.
- One consolidated Claude integration task covering: text assets for the
  full operational lifecycle (12 commands), split into driver-facing and
  worker-facing documents, installed by `init` (glob-based, self-updating)
  with `--no-claude` opt-out; honestly-scoped bounded dispatch (structured
  pre-dispatch scope validation, bounded-supplied-context claim, no
  read-enforcement claim, deferred to M007); capped worker-report fields;
  LSP and shared-worktree guidance — all pure text plus the small
  provider-neutral code pieces (checkWriteScope, report capping) that directly
  support them. Zero agent-spawning code anywhere in PitWay.
- A separate context-efficiency measurement task, separating controllable
  from inherited costs under comparable model/config conditions, delivered
  as a committed evidence document.
- A separate auto-run mechanism and interactive-UX task: agent-agnostic
  `auto-run enable/disable/status [milestone-id]` command, a new journal
  record kind, hash- and amendment-computed invalidation, and the arrow-key
  decision UX built on top of it, with every listed invalidation gate and a
  bootstrap disclosure.
- Roadmap-reconciliation review against `IMPLEMENTATION_PLAN.md`.

## Non-Goals

- Dogfood validation and the Adaptive Workflow Intensity decision (M007).
- Actual runtime enforcement of `context_files` read boundaries, and the
  write-scope-boundary-shape decision (exhaustive file list vs.
  glob/directory + protected-path denylist) — both explicitly M007.
- A supported path to revise a completed task's deliverable, and a
  first-class recovery path for defects in already-completed PitWay tooling
  — both M007 (report.md §11.7, §11.8).
- README, packaging, npm publish, the real `pitway` bin's build step, and
  treating any temporary compile workaround as a distribution mechanism
  (M008 — see M005 report.md §14's note on `.git/pitway/verify-build/`).
- Milestone git branch isolation, parallel task worktrees (M009-M010).
- Any PitWay-built agent-spawning mechanism, LSP client, or interactive TUI
  renderer — all explicitly out of scope by architecture (§7 above).
- Live Windows verification of the descendant-process-cleanup path — the
  code and its decision-path tests exist; running it on real Windows CI
  does not, and this milestone does not claim otherwise.

## Non-Bootstrap Disclosure

M006 is the first milestone whose entire lifecycle — baseline confirm, every
task-completion commit, and its eventual milestone-complete — uses M005's
three-checkpoint/journal model as the normal, authoritative mechanism,
exactly as M005's own contract specifies (authoritative starting with M006's
baseline confirm onward). M006 does not use the old M004-era mechanism the
way M005 itself had to for its own earlier history — that transitional
disclosure was specific to M005 and does not carry over to M006. The only
genuine bootstrap gap in M006 is narrower: the new Claude interactive
confirmation UX (AC010) does not exist until its own implementing task lands
partway through the milestone, so M006's baseline confirm necessarily
happens through the pre-existing, non-interactive `milestone-confirm` CLI
command — not through the arrow-key prompt that same task defines — mirroring
M004 building `milestone-complete` and then legitimately using it on itself
for a later lifecycle event, never an earlier one that already happened.
AC010's prompts are behaviorally reviewed against a synthetic temporary
repository (CT011); once that task is committed, M006's own remaining tasks
may dogfood the task-continuation prompt on themselves, but the first real
end-to-end dogfood of the milestone-confirm prompt against a genuine
milestone lifecycle is reserved for M007's own confirmation.

## Design Decisions

- Verification hardening is ordered first (T001-T002) with every other task
  depending on it, directly or transitively, so that any interim or final
  `pitway verify` call made during M006's own development — or by any future
  milestone — is already safe. This is a scheduling decision for this
  milestone's own execution safety, not a claim that later tasks have a
  hard code dependency on the verification module.
- Guidance-only work that all modifies the same src/integrations/claude/
  asset tree (lifecycle command docs, the driver/worker split, dispatch
  honesty text, worker-report guidance, LSP guidance, shared-worktree
  guidance) is delivered as one task rather than several, since splitting
  purely by which AC it satisfies would fragment one coherent edit to one
  coherent asset tree into artificial pieces — and each split would still
  need its own sub-agent dispatch and commit for what is, in several cases,
  a single-file guidance edit. AC/CT coverage stays granular regardless —
  each capability keeps its own AC and CT, and each CT's targeted command
  still names the specific test file(s) or asset(s) proving that
  capability, even though several ACs are delivered and verified by the
  same task.
- The `init` installer is glob-based, not a hardcoded file list, precisely
  so that AC009/AC010's later assets (auto-run.md, interactive-ux.md) are
  installed automatically without a second wiring step — the final
  integration assertion (AC003) exists to verify this is actually true
  once every asset exists, not to serve as the only thing making it true.
- src/integrations/claude/ contains text assets only — this is verified
  structurally (a test asserts zero .ts files in that directory) as well as
  by review, so "no runtime code" stays true by construction, not by
  convention alone.
- The auto-run journal record is a new sibling `kind` (`auto_run`), not a
  new `type` under the existing `entry` kind, because it must never be
  folded into a checkpoint commit — reusing `entry`'s checkpoint-folding
  machinery for state that should never be committed would be a category
  error, not a simplification. Its exclusion from derivePending,
  resolveTargetPath, checkpoint folding, and reconciliation is structural
  (the discriminated union and its existing type signatures make the
  alternative impossible), not merely a convention this milestone commits
  to following. Its durability is repository/worktree-local and resumable —
  the same class as the rest of the journal — which is a separate property
  from never being committed; the two are not in tension.
- `auto-run` is a pure authorization switch — it never dispatches or
  executes a task itself; that stays the driver's job via the existing
  task-status/task-update commands, unchanged by this milestone.
- The interactive UX and the auto-run mechanism it depends on are one task,
  not two, since the UX asset has no meaningful content independent of the
  command it wires to; AC009 and AC010 stay separate ACs with separate CTs.
- The recursion guard's canonical-identity resolution (repo/gitdir) lives in
  the Git module (src/git/paths.ts), an allowed Core dependency; the guard's
  own accept/refuse decision logic is kept pure and independently testable
  with plain string tokens, matching the project's general preference for
  pure Core logic over logic entangled with I/O.
- Within any single CLI invocation's own process, Core code should reuse a
  structured value it already parsed rather than re-parsing the same file
  redundantly — an ordinary code-quality expectation applied where M006's
  own tasks touch Core code, not a new acceptance criterion, and never in
  tension with the load-bearing rule that authoritative `.pitway/` state
  is correctly reread from disk on every resume or fresh session (proven by
  M005/T008; this milestone does not weaken that).
- No task or AC claims a capability PitWay's architecture forbids (spawning
  agents, enforcing filesystem reads, rendering its own interactive UI) —
  every such claim in this contract is phrased as guidance the driver
  follows, not a PitWay-enforced behavior, per item 7's clarification.
- Windows descendant-process cleanup is implemented and its decision path
  is unit-tested via platform/mocking; it is not claimed to be verified
  against real Windows process behavior, because no Windows CI exists for
  this repository. Claiming cross-platform verification without that
  evidence would misstate what was actually checked.

## References

- IMPLEMENTATION_PLAN.md §7 (CLI commands), §8 (Agent Interface), §9 (Claude
  Code Adapter), §10 (Git Strategy), Revised Roadmap M006 entry.
- M005 report.md §7, §8, §9 (M006 carried-forward backlog), §11
  (verification-hardening defect background, architectural findings detail),
  §13 (full verification-hardening task requirement), §14 (M008's
  build/distribution note).
- Claude integration requirements and the measured M004/T005 dispatch-cost
  baseline (12K driver planning, ~30K worker startup, 22K-52K worker growth,
  +51.2K driver growth per dispatch), recorded 2026-08-18 and reaffirmed in
  M005 report.md §8.
- src/core/verification/run.ts (existing, the file this milestone hardens);
  tests/integration/verify.test.ts's existing "never npm — would recurse"
  fixture comment, which this milestone's recursion guard is meant to make
  obsolete as a workaround, not merely document around.
- src/core/journal/operations.ts and src/state/journal.ts (existing,
  unmodified by AC009 — their existing type signatures are what make
  auto_run's exclusion structural).

## Change Log

- (none yet — draft, not confirmed.)
