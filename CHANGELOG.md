# Changelog

## [1.5.0] — 2026-08-31

### Highlights

- **Usage readings by role.** `usage.yaml` gains an append-only `readings`
  list and `pitway usage-add <milestone> --reading <json>` records one
  measured reading — `bucket` (main / orchestrator / worker / auxiliary),
  an opaque `count`, and its `semantics` (`per-turn` or `undetermined`),
  plus optional dimensions, model, provider, instance id, and the raw
  provider envelope. Readings are stored as readings: two calls are two
  entries, never a sum, and a total or percentage key is rejected by the
  schema itself. This gives figures like an Orchestrator session's own
  runtime readings a durable home for the first time, on exactly the terms
  PitWay's token-telemetry spike (`docs/evidence/M042/`) showed are
  measurable
- **Per-bucket usage in `milestone-status`.** When any usage or reading is
  recorded, the token breakdown lists one line per role bucket — measured
  segments plus a missing count, with readings *counted*, never summed.
  Existing usage keeps its meaning: the bucket mapping (dispatched task →
  worker, inline → main, planning/qa → main, review → worker) is computed
  on display, never stored. No milestone total, no percentages — the M009
  measured-only discipline, unchanged
- `dispatch.md` now directs an Orchestrator session's own runtime readings
  to `usage-add --reading`; a dispatched worker's figure still goes to the
  completing `task-update --usage`, exactly as before

Existing installs will report configuration drift for the updated command
docs until `pitway init --reconfigure` is run.

## [1.4.0] — 2026-08-29

### Highlights

Five workflow frictions PitWay's own dogfooding ranked highest, each fixed
at its smallest architecture-consistent point, plus two structural
cleanups. No human gate changes.

- **Per-task verification timeout.** A task may declare
  `verification.timeout_ms` (same bounds as a contract check's timeout);
  `task-verify` honors it when `--timeout` is omitted, so a full-suite gate
  task no longer false-fails at the 120 s default. An explicit `--timeout`
  still wins; undeclared tasks are unchanged
- **Directory-form scope entries are refused at draft time.**
  `milestone-add`, `--replace`, and `task-add` reject a `write_scope` /
  `context_files` / `relevant_files` entry that is a directory (trailing
  `/` or an existing directory), naming the task, field, and path — Core
  matches dirty paths exactly, so such an entry could never be satisfied
  at execution. Files that do not exist yet are still fine
- **A first `in_progress` attempt tolerates the task's own in-scope dirt.**
  Evidence or files prepared inside the task's declared scope no longer
  block it from starting (the allowance retries already had). Every path
  outside the declared scope still refuses, and completion's write-scope
  enforcement is untouched
- **`milestone-confirm` absorbs a pending `backlog.yaml`.** A backlog item
  added while no milestone was active rides the baseline commit instead of
  forcing a chore commit; all other unexpected dirt still refuses
- **`task-status --json` exposes scope and verification.** `relevantFiles`
  or `contextFiles` + `writeScope` (whichever the task declares) and
  `verification` (`strategy`, `detail`, `timeoutMs` when declared) — the
  fields a `task-amend` file must restate. Human output unchanged
- **Cleanup:** the one-time M023 asset-manifest check is retired (doc edits
  no longer need a hand-regenerated hash; every durable content invariant
  still has its own suite), and the journal's schemas now live in
  `src/state/journal-schemas.ts` behind a re-export — a pure move, no
  importer changes

Existing installs will report configuration drift for the six updated
command docs until `pitway init --reconfigure` is run.

## [1.3.0] — 2026-08-29

### Highlights

- `pitway resume` now lists two recovery inputs it used to tolerate
  silently: **pending journal entries** for the active milestone (an
  approved amendment or usage recording awaiting its checkpoint commit,
  with the file it will land in) and a **pending verification repair**
  (its VR id, files, and checks). Both appear only when present, so
  existing `--json` output is unchanged when nothing is pending
- **`verification-repair` accepts manual and review checks.** A repair
  scoped to a review-type check no longer has to borrow an unrelated
  command check. At `commit`, command checks rerun as before; a manual or
  review check is satisfied only by a developer verdict recorded with
  `verify <milestone> --check <id> --pass` *after* the approval — the
  honest equivalent of a rerun — and the refusal names the exact command
  to run
- **`quick-change commit` writes a bounded subject line**: the objective's
  first sentence, cut at a word boundary to fit 72 characters, with the
  full objective carried in the commit body when the subject cannot hold
  it verbatim. Short objectives commit exactly as before
- The Orchestrator role's protocol (`protocol-orchestrator.md`) gains its
  lifecycle rules: what must already be durable before a session's context
  is disposable, a six-step restart procedure keyed to `pitway resume`,
  and two decided rules from PitWay's own split-role dogfood — the
  Orchestrator never runs `git` against the working tree (RED checks move
  files aside with its own tools, like a worker), and it owns the
  `blocked → ready` recovery transition after a developer-approved
  amendment. Decisions: `docs/architecture/orchestrator-role.md`
  (Addendum); audit: `docs/architecture/orchestrator-flush-audit.md`

Existing installs will report configuration drift for
`protocol-orchestrator.md` until `pitway init --reconfigure` is run.

## [1.2.0] — 2026-08-29

### Highlights

- **The Orchestrator role.** PitWay's driver protocol is now written for
  three roles: the *Main Agent* (developer conversation and every approval
  gate — `protocol-driver.md`), the *Orchestrator* (task execution planning,
  dispatch, verification and reporting — the new `protocol-orchestrator.md`,
  installed for every driver), and the *Worker* (`protocol-worker.md`,
  unchanged). One session may play Main Agent and Orchestrator together
  (the default) or two sessions may split them. The Orchestrator is a
  protocol role, never a runtime component: PitWay ships no orchestrator,
  scheduler, or agent framework, and the boundary is protocol-enforced —
  installed and pinned as instruction text, detected in review, never
  blocked at runtime — exactly like every other approval gate. Decisions and
  rationale: `docs/architecture/orchestrator-role.md`
- Every installed command doc now carries a one-line **role annotation**
  (Main Agent / Orchestrator / either), and `dispatch.md`,
  `coordination.md`, and `report-format.md` name which role performs each
  step. README and USAGE gain a Driver Roles section
- `pitway init --reconfigure` now **migrates the managed block** in an
  existing `AGENTS.md` / `CLAUDE.md` in place when it matches the exact
  block a previous version installed — only the block is replaced, your own
  content is untouched — so existing projects pick up the
  `protocol-orchestrator.md` pointer. Any other differing block is still
  preserved, as before
- Evidence records from PitWay's own dogfooding: a real two-session
  Main/Orchestrator milestone run (`docs/evidence/M041/`) and a token
  telemetry spike across the Claude, OpenCode, and Codex drivers
  (`docs/evidence/M042/`) — measured facts only, informing the future
  usage-attribution work; no usage schema or accounting behavior changes in
  this release

Existing installs will report configuration drift for the touched protocol
documents until `pitway init --reconfigure` is run.

## [1.1.2] — 2026-08-28

### Highlights

Internal architecture corrections from the post-v1.1.1 review — no CLI
output, workflow semantics, or installed driver assets change in bytes.

- Driver command docs now ship once, from a shared common tier
  (`src/integrations/common/commands/`); Codex and OpenCode resolve them
  from there, and Claude Code keeps only its frontmatter-bearing overrides.
  A repo initialised on 1.1.1 reports no configuration drift after
  upgrading
- The declared `CLI → Core → State + Git` layering now holds everywhere:
  the journal's pure helpers moved into the State layer (removing a
  State↔Core import cycle), `git/safety.ts` is a pure Git classification
  module fed by Core, and the `resume` / `milestone-status` view assembly
  moved from the CLI into Core view modules, all guarded by import-direction
  tests
- `core/tasks/update.ts` split by responsibility (evidence resolution,
  `--usage` handling, `--result` parsing, completion-commit lookup), with
  focused unit tests for each; `task-verify` and task completion now share
  one fingerprint implementation instead of two byte-mirrored copies
- One shared CLI footer helper replaces sixteen hand-repeated racing-footer
  blocks across the mutating commands

## [1.1.1] — 2026-08-27

### Highlights

- New `pitway milestone-current [--json]` command: a fast, read-only check
  for whether a milestone is active and, if so, its id/status — no more
  reaching for the heavier `resume` view just to answer that
- `pitway milestone-status` no longer has a separate `--report` flag — the
  full status report (workload, task table, critical path, active/next
  task, token breakdown, racing footer) is now the only output. `[id]` is
  now optional: omit it to see the active milestone, or pass one to check
  any milestone regardless of status
- README/USAGE now include a concise "Which Workflow Should I Use?" guide
  (Milestone / Task-or-Backlog / Quick Change, with execution mode called
  out as an orthogonal setting, not a separate lane) and drop a couple of
  stale doc claims (backlog no longer requiring an active milestone, the
  removed `--report` flag)

## [1.1.0] — 2026-08-27

### Highlights

- `pitway resume` now detects and surfaces installed driver configuration
  drift (Claude/Codex/OpenCode asset mismatches against what the repo
  expects), pointing at `pitway init --reconfigure` to fix it
- New `quick-change create --closes <backlog-id>`: a quick-change can now
  close the backlog item it fixes in the same atomic commit as the fix
  itself, instead of needing a separate manual archive commit
- `pitway backlog add` no longer requires an active milestone — it records
  `source.milestone: null` and works standalone; `promote` still requires
  one, since it targets a milestone-scoped task
- `pitway resume` now names ready tasks eligible for parallel dispatch
  today when `execution.strategy: parallel_worktrees` is set — advisory
  only, it never dispatches anything itself
- `milestone-complete`'s own output now states plainly that
  `milestone-merge` requires separate, explicit developer approval and is
  never run automatically
- Next-step navigation: `task-verify`, `task-amend`, `usage-add`, `verify`,
  `verification-repair`, `auto-run`, and `milestone-complete` now suggest
  the right next command or name accurate recovery steps directly in their
  own output
- Fixed: a dispatched reviewer subagent's usage could go unrecorded in
  `milestone-review record` with no on-screen reminder to forward it
- Fixed: `usage-add`'s fallback help text pointed at a `task-update`
  retroactive-usage path that doesn't exist
- Fixed: a crash between a backlog item's journal write and its state
  write, followed by a retry, could double-write its archive journal
  record (state was always correctly archived exactly once; only the
  audit trail could duplicate)
- Docs: quick-change protocol and workflow diagram now document
  investigation, root-cause, approval, and `--closes` across all three
  drivers (Claude, Codex, OpenCode)

## [1.0.6] — 2026-08-26

### Highlights

- `milestone-review`'s Record step now spells out the reviewer-usage
  capture rule directly, instead of relying on a cross-referenced doc, so
  recorded review usage stops silently coming back `null`

## [1.0.5] — 2026-08-25

### Highlights

- Actually fixed this time: `milestone-status --report`'s review-usage
  total and execution-mode column, and `task-update`'s tolerance for a
  dirty `verification-results.yaml`/`verification-repairs.yaml` — these
  were reverted right before 1.0.3 shipped despite that changelog entry
  listing them as included

## [1.0.4] — 2026-08-25

### Highlights

- The workflow journal (`.git/pitway/journal.yaml`) now writes atomically
  (temp-file-then-rename), so a process killed mid-write can no longer
  leave it corrupted
- Fixed `milestone-confirm --amend` silently nulling out a milestone's
  recorded `base_branch`/`base_revision` when the submitted amendment
  omitted them, which could break `milestone-merge` for a
  `branch_strategy: milestone` milestone

## [1.0.3] — 2026-08-24

### Highlights

- PitWay now has an official website (pitway.thixpin.me): 
- `milestone-status --report` now shows each task's real execution mode
  (inline/worktree) instead of always an em dash
- `milestone-status`'s token total/breakdown now folds in recorded
  milestone-review usage, not just task/planning/qa usage
- `task-update` to `in_progress`/`completed` no longer refuses on a dirty
  `verification-results.yaml`/`verification-repairs.yaml` left behind by
  an earlier `pitway verify` run
  

## [1.0.2] — 2026-08-24

### Highlights

- Task-verify evidence resolution hotfix: implicit evidence selection now
  skips a failing record to find the newest passing one for the same
  task, instead of trusting whichever record is newest regardless of
  pass/fail
- New `review → in_progress` task recovery path, with the retry dirty-tree
  check unified onto the same write-scope-aware check used elsewhere
- Sequential subagent dispatch protocol: an optional, driver-agnostic
  pattern for resuming a subagent across a dependency chain to cut
  re-briefing overhead, with an explicit context-isolation trade-off
  disclosure

## [1.0.1] — 2026-08-23

### Highlights

- `pitway init` now generates `config.yaml` with explicit `branch_strategy:
  milestone` and `execution.strategy: parallel_worktrees` defaults,
  including explanatory comments

## [1.0.0] — 2026-08-23

Initial release of PitWay — the pit crew for agentic coding.

### Highlights

- Milestone & contract-based workflow
- Controlled AI agent execution
- Dependency-aware parallel tasks
- Git worktree isolation
- TDD & verification gates
- Evidence & backlog tracking
- Multi-agent resume
- Human-controlled completion & merge
- Automatic workflow documentation
