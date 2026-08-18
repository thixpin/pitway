---
schema_version: 1
id: M002
title: Git module and read-only status commands
status: completed
requirement: null
confirmed_at: 2026-08-18T08:43:39Z
verification_approved_hash: sha256:b01f43cf8cdfb28c39e4d1695c60c3bb2ef861f5ed1c1b6e26e07e2eb729e4d3
acceptance_criteria:
  - id: AC001
    text: >-
      A git safety check reports whether the working tree is clean and, when
      dirty, returns the list of dirty paths, without modifying anything
      (no stash, reset, or commit).
  - id: AC002
    text: >-
      Git operations produce a clear, distinguishable error when run outside
      a git work tree.
  - id: AC003
    text: >-
      A commit-message composer appends only the given PitWay trailers
      (PitWay-Milestone, PitWay-Task) to a driver-proposed message and
      strips only an explicit, closed set of provider/session metadata:
      trailer lines whose key exactly matches Claude-Session, Codex-Session,
      or Gemini-Session, and Co-Authored-By lines whose email address
      exactly matches a closed list of known AI-generated addresses (e.g.
      noreply@anthropic.com). It preserves every other trailer verbatim,
      including legitimate human Co-Authored-By lines, and never
      pattern-matches on a display name (a human co-author named "Claude"
      must not be stripped).
  - id: AC004
    text: >-
      A commit helper creates a commit from currently staged changes using
      the composed message, returns the resulting SHA, and refuses to
      create an empty commit.
  - id: AC005
    text: >-
      A baseline-commit helper stages the confirmed milestone's .pitway/
      artifacts, runs the safety check first and refuses on an unexpectedly
      dirty tree, composes the baseline message (e.g. "workflow: add
      milestone M002") with only the PitWay-Milestone trailer (no
      PitWay-Task), creates the commit via the generic commit helper, and
      returns the resulting SHA. It never creates an empty commit.
  - id: AC006
    text: >-
      A commit SHA for a given milestone/task can be resolved by searching
      commit trailers in git history, with no SHA read from or written to
      persisted state.
  - id: AC007
    text: >-
      The pitway CLI has a working bin entry point; every command accepts
      --json and produces valid JSON on that flag, and human-readable
      output otherwise.
  - id: AC008
    text: >-
      pitway milestone-status <id> reports milestone status, contract
      status, deterministic progress (completed required tasks / total
      required tasks, no per-task percentages), and per-task status labels.
  - id: AC009
    text: >-
      pitway milestone-list treats .pitway/state.yaml strictly as a
      milestone index (ids only) and, for each listed milestone, reads only
      the minimal per-milestone metadata needed for a one-line summary —
      title and status from that milestone's contract frontmatter. It must
      not load tasks.yaml, verification-results.yaml, or usage.yaml for any
      milestone.
  - id: AC010
    text: >-
      pitway task-status <id> reports a task's status, dependencies, and
      result summary; with --context it additionally emits exactly the
      minimal task-context bundle (task definition, acceptance criteria,
      relevant contract excerpt, dependency result summaries, relevant
      files, verification instructions) and nothing else.
  - id: AC011
    text: >-
      pitway resume inspects .pitway/ alone and reports the active
      milestone, contract status, per-task states, ready/waiting/blocked
      tasks, and a recommended next task. When more than one task is ready,
      the recommendation is deterministic: the ready task with the lowest
      task ID (declared order) is recommended, with no other prioritization
      in MVP.
  - id: AC012
    text: >-
      The CLI layer contains only argument parsing and output formatting —
      no direct git or state-file I/O. All reads go through
      src/state/store.ts and the git module.
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npm test -- tests/unit/git-safety.test.ts
  - id: CT002
    criterion: AC002
    type: command
    command: npm test -- tests/unit/git-safety.test.ts
  - id: CT003
    criterion: AC003
    type: command
    command: npm test -- tests/unit/git-commit.test.ts
  - id: CT004
    criterion: AC004
    type: command
    command: npm test -- tests/unit/git-commit.test.ts
  - id: CT005
    criterion: AC005
    type: command
    command: npm test -- tests/unit/git-baseline.test.ts
  - id: CT006
    criterion: AC006
    type: command
    command: npm test -- tests/integration/git-trailers.test.ts
  - id: CT007
    criterion: AC007
    type: command
    command: npm test -- tests/integration/cli.test.ts
  - id: CT008
    criterion: AC008
    type: command
    command: npm test -- tests/integration/milestone-status.test.ts
  - id: CT009
    criterion: AC009
    type: command
    command: npm test -- tests/integration/milestone-list.test.ts
  - id: CT010
    criterion: AC010
    type: command
    command: npm test -- tests/integration/task-status.test.ts
  - id: CT011
    criterion: AC011
    type: command
    command: npm test -- tests/integration/resume.test.ts
  - id: CT012
    criterion: AC012
    type: review
    instruction: >-
      Review src/cli/ to confirm it contains only argument parsing and
      output formatting, with every state read/write routed through
      src/state/store.ts and every git operation routed through the git
      module — no direct fs or child_process calls in the CLI layer.
---

# Contract — M002: Git module and read-only status commands

## Objective

Add the git module (safety check, trailer-based commits, a dedicated
baseline-commit helper, trailer-based SHA resolution) and the CLI's
read-only surface: `milestone-status`, `milestone-list`, `task-status`
(including the `--context` minimal task-context bundle), and `resume` —
all built on the M001 state layer.

## Scope

- `src/git/`: safety check (clean/dirty detection, dirty-path listing),
  non-git-repo detection, commit-message composer (PitWay trailers only;
  strips an explicit closed set of provider/session metadata — see AC003 —
  and never touches legitimate human trailers), a generic commit helper
  (stage → compose → commit → return SHA, refusing empty commits), a
  dedicated baseline-commit helper built on the generic helper (milestone
  baseline message, `PitWay-Milestone` trailer only, safety check first),
  and trailer-based SHA resolution from git history.
- `src/cli/`: `pitway` bin entry point (commander), shared `--json` /
  human-readable output plumbing.
- Read-only commands: `milestone-status`, `milestone-list` (state.yaml as
  index only — per-milestone detail limited to contract frontmatter),
  `task-status [--context]`, `resume` (deterministic next-task
  recommendation: lowest ready task ID) — each reading only through
  `src/state/store.ts` and the git module.
- Integration tests using real temporary git repositories per
  IMPLEMENTATION_PLAN.md §13.

## Non-Goals

- No mutation commands (`init`, `milestone-add`, `milestone-confirm`,
  `task-update`) — M003.
- No verification execution (`verify`) or usage recording/aggregation — M004.
- No Claude integration assets, README, or npm packaging — M005.
- No branches, worktrees, stashes, or merges (preserved decision).
- No task-priority/weighting system beyond the declared-order tie-break in
  AC011 — anything richer is deferred until evidence justifies it.

## References

- IMPLEMENTATION_PLAN.md §7 (CLI commands), §10 (git strategy), §13
  (testing strategy) — the authoritative design for this milestone.

## Change Log
