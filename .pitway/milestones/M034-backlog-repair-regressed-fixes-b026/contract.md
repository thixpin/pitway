---
schema_version: 1
id: M034
title: Backlog Repair — Regressed Fixes (B026/B028/B029) and Doc Drift (B030/B031)
status: in_progress
requirement: null
confirmed_at: 2026-08-25T11:36:14Z
verification_approved_hash: sha256:d07190f9e3b6ab662a4857b8c864c9a33175d3631c1a72427381e64424d43361
acceptance_criteria:
  - id: AC001
    text: milestone-status --report's token total/breakdown includes recorded review
      usage alongside task usage.
  - id: AC002
    text: milestone-status --report's Execution column reflects each task's actual
      inline/worktree execution mode instead of always showing an em dash.
  - id: AC003
    text: task-update tolerates pending
      verification-results.yaml/verification-repairs.yaml changes when
      transitioning a task to in_progress or completing it, so a mid-milestone
      task-add is never stranded by a prior verify run.
  - id: AC004
    text: USAGE.md's link to README's workflow-policies section uses the correct
      anchor and resolves.
  - id: AC005
    text: AGENTS.md's hand-maintained body matches CLAUDE.md's body exactly, with no
      drifted or missing clauses.
  - id: AC006
    text: CLAUDE.md carries no duplicate of AGENTS.md's body; it points to AGENTS.md
      instead (via the existing @AGENTS.md import in its pitway-managed block),
      so the two files can never drift apart again.
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npx vitest run tests/unit/review-roles.test.ts
      tests/integration/milestone-status.test.ts
  - id: CT002
    criterion: AC002
    type: command
    command: npx vitest run tests/integration/milestone-status.test.ts
  - id: CT003
    criterion: AC003
    type: command
    command: npx vitest run tests/integration/task-update.test.ts
  - id: CT004
    criterion: AC004
    type: command
    command: grep -q '#workflow-policies' USAGE.md
  - id: CT005
    criterion: AC005
    type: manual
    instruction: Diff AGENTS.md's body (excluding the pitway:managed block) against
      CLAUDE.md's body and confirm they match exactly.
  - id: CT006
    criterion: AC006
    type: manual
    instruction: Confirm CLAUDE.md's body outside its pitway-managed block is gone
      (replaced by a thin pointer), and that its managed block's existing
      @AGENTS.md import is what surfaces AGENTS.md's content to Claude Code.
---

# Contract

## Objective

Commit `7c34ea6` ("chore(backlog): archive B026, B028, B029 (fixed via quick-changes)")
silently reverted three already-landed, already-tested fixes — for B026 (review
usage missing from `--report` totals), B028 (`--report`'s Execution column always
showing an em dash), and B029 (`task-update` stranding on pending
verification-results dirt) — while never actually marking those backlog items
archived. All three bugs are back on `main`. This milestone reapplies the three
reverted fixes (the working diffs exist at commits `521decd`, `91d6b3b`, and
`f71dd04` and are reusable as reference), and separately closes two smaller,
independently-discovered doc-drift items: B030 (a broken anchor link in
USAGE.md) and B031 (AGENTS.md's hand-copied body has drifted from CLAUDE.md's).

## Scope

- Restore task-update's tolerance for pending verification-results/repairs dirt
  (B029), including its regression test.
- Restore milestone-status --report's Execution column population (B028),
  including its regression test.
- Restore folding recorded review usage into milestone-status --report's token
  total/breakdown (B026), including its regression tests.
- Fix USAGE.md's broken anchor link to README.md's Workflow Policies section
  (B030).
- Sync AGENTS.md's body to match CLAUDE.md's body exactly (B031).
- Strip CLAUDE.md's hand-authored body down to a thin pointer at AGENTS.md,
  relying on the existing `@AGENTS.md` import already present in CLAUDE.md's
  pitway-managed block, so the two files hold one canonical copy instead of
  two kept in sync by hand (B031, extended per developer direction).
- Backlog bookkeeping: promote/close B026, B028, B029, B030, B031 against this
  milestone's tasks once each is verified.

## Non-Goals

- Reverting or otherwise touching commit `7c34ea6` in git history.
- Investigating why `7c34ea6` was mislabeled, or changing the backlog-archive
  workflow/tooling to prevent recurrence — out of scope for this fix-only
  milestone.
- Any AGENTS.md/CLAUDE.md include mechanism beyond the existing, already-shipped
  `@AGENTS.md` import (`src/state/root-instructions.ts`) — reusing it, not
  building a new one.

## Change Log

- 2026-08-25: Draft created.
- 2026-08-25: Added AC006/CT006 — CLAUDE.md's hand-authored body is removed in
  favor of a thin pointer to AGENTS.md via the existing @AGENTS.md import,
  instead of the two files being kept manually in sync (developer-approved,
  supersedes the original Non-Goal excluding include-mechanism restructuring).
