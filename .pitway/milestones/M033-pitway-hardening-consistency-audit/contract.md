---
schema_version: 1
id: M033
title: PitWay Hardening & Consistency Audit
status: in_progress
requirement: null
confirmed_at: 2026-08-25T06:52:04Z
verification_approved_hash: sha256:b6f3e66b751cd2707afac7d2bb9e07b62d0f157a901c52513bf22b6a882380b1
base_branch: main
base_revision: 6a9d1d40d0b2a5408c263f726ebcbbbeab26e3db
acceptance_criteria:
  - id: AC001
    text: The journal write (src/state/journal.ts's saveJournalFile, the sole
      PitWay-managed file deliberately kept outside git tracking at
      .git/pitway/journal.yaml and therefore without git's own crash-recovery
      backstop) is crash-safe -- an interrupted write leaves the prior journal
      content intact rather than corrupted -- with no change to its file path,
      format, or existing recovery semantics (reconcilePending's
      checkpoint-marker healing). Git-tracked state files (state.yaml,
      tasks.yaml, contract.md, etc.) are intentionally left as-is -- a torn
      write there is already recoverable via the standard dirty-tree git
      checkout path.
  - id: AC002
    text: "CLAUDE.md and AGENTS.md contain no obsolete bootstrap-phase narrative and
      no branch/worktree instruction that contradicts the shipped
      parallel_worktrees execution strategy and branch_strategy: milestone; any
      website content page found to mirror the same stale text is corrected
      too."
  - id: AC003
    text: README.md's first-time-user path (what PitWay is, install, first commands)
      is scannable ahead of deep reference material, with no technical content
      removed -- only reordered/tightened.
  - id: AC004
    text: required_skills test coverage exercises all three supported drivers
      (claude, opencode, codex) at parity; Core resolution logic is confirmed
      already driver-symmetric and is not changed.
  - id: AC005
    text: src/ and tests/ contain no comments that are pure historical narrative
      with no remaining explanatory value; comments citing a milestone/task id
      alongside a genuine WHY are preserved.
  - id: AC006
    text: Full test suite and typecheck pass with zero regressions.
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npx vitest run tests/unit/journal.test.ts
  - id: CT002
    criterion: AC002
    type: review
    instruction: "Diff CLAUDE.md/AGENTS.md against the prior version; confirm no
      bootstrap-phase/M001-M004 narrative remains, the branch/worktree line
      matches shipped parallel_worktrees + branch_strategy: milestone behavior,
      and any touched website page matches."
  - id: CT003
    criterion: AC003
    type: review
    instruction: Diff README.md against the prior version; confirm structural
      reordering only, no technical information removed.
  - id: CT004
    criterion: AC004
    type: command
    command: npx vitest run tests/unit/claude-assets.test.ts
      tests/integration/task-status.test.ts
  - id: CT005
    criterion: AC005
    type: review
    instruction: Confirm no comment in src/ or tests/ is pure historical narrative
      with zero remaining explanatory value; comments citing a milestone/task id
      alongside a genuine WHY are unchanged.
  - id: CT006
    criterion: AC006
    type: command
    command: npm run typecheck && npm test
---

# Contract

## Objective

Audit and harden four narrow, verified gaps in the current implementation
-- state-write crash-safety, stale/contradictory operational docs, thin
required_skills test coverage, and README scanability -- without changing
PitWay's intended behavior, CLI surface, state format, or driver
boundaries.

## Scope

- Route the journal write (`.git/pitway/journal.yaml`, never git-tracked)
  through an atomic (temp-file + rename) write. Git-tracked state files are
  intentionally left alone -- git already backstops them.
- Remove the obsolete "Bootstrap Phase" / M001-M004 narrative from
  CLAUDE.md and AGENTS.md and fix the "no branches/worktrees; sequential
  execution in MVP" line, which contradicts shipped `parallel_worktrees`
  and `branch_strategy: milestone`; sync any stale website content page
  found to mirror the same claims.
- Tighten README.md's first-screen scanability (reorder/condense only).
- Extend required_skills test coverage to the codex driver (logic is
  already correct; only test coverage is missing).

## Non-Goals

- No change to Core's required_skills resolution logic (already correct).
- No removal of historical milestone evidence (docs/archive/,
  docs/evidence/, .pitway/milestones/**) or of milestone-tagged comments
  that carry a genuine WHY.
- No style-only code refactors; no new features.

## Change Log

- 2026-08-25: Draft created from a four-area research pass (state
  persistence, docs, required_skills, README, code comments/tech debt).
- 2026-08-25: Architect review (rev-2c08c762a6f2) flagged AC005/CT005
  claiming write-helper duplication was "consolidated under AC001" when
  T001's scope (journal-only) never does that consolidation. Dropped the
  consolidation clause from AC005/CT005 -- research already confirmed no
  pure-historical-noise comments exist, so AC005 needs no code change.
