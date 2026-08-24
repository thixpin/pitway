# Changelog

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
