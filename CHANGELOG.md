# Changelog

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
