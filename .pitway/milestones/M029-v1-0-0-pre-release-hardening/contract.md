---
schema_version: 1
id: M029
title: v1.0.0 Pre-Release Hardening
status: completed
requirement: null
confirmed_at: 2026-08-23T07:26:09Z
verification_approved_hash: sha256:9c9d31df1907112eac0b76972990b2a5dce102e49cc952bdbe99a61441057298
base_branch: main
base_revision: 7b8e2463ad359beb99accb6de0ef84cdb698a8ad
acceptance_criteria:
  - id: AC001
    text: "pitway task-verify accepts an optional --timeout <ms> flag, bounded to
      the same range as contract check timeouts (1000ms..3600000ms), default
      unchanged at 120000ms so all existing behavior is byte-identical. The
      value passes through to verification execution (and any --typecheck run),
      so declared long-running verifications such as full-suite gates can
      complete. Documented in commands/task-verify.md across
      claude/opencode/codex with alias parity and hash-manifest refresh. TDD:
      failing tests first -- flag validation bounds, plus a real subprocess that
      exceeds the default budget and succeeds under an explicit larger
      --timeout."
  - id: AC002
    text: "Repository hygiene for the release tag: every pitway/M0xx milestone
      branch is ancestry-checked against main and deleted only when fully
      merged; the stale temporary worktree registration under the system temp
      directory (m024-baseline) is removed and pruned. After cleanup, git branch
      shows no stale milestone branches and git worktree list shows only the
      main checkout. Nothing unmerged is ever removed."
  - id: AC003
    text: "Driver/model traceability lives in PitWay-owned evidence, never Git
      trailers, and PitWay maintains no AI co-author identity at all: (a) the
      KNOWN_AI_COAUTHOR_EMAILS mechanism and its Co-Authored-By scrubbing branch
      are removed from src/git/trailers.ts entirely -- every Co-Authored-By
      trailer is now preserved verbatim as a human-authored line, and no
      provider email list or replacement trailer mechanism is introduced; (b)
      the provider-session-key stripping (Claude-Session/Codex-Session/
      Gemini-Session) is explicitly retained, unchanged; (c) taskSchema gains
      additive-optional string fields driver and model (1..80 chars) settable
      via new task-update --driver/--model flags on any transition including
      completion, persisted in tasks.yaml, surfaced in task-status --json when
      present; (d) a pinned test proves completing a task carrying driver/model
      composes a commit message containing no Driver: or Model: lines and no
      added Co-Authored-By. Affected tests/fixtures updated (unit git-commit;
      integration task-update and self-hosting-readiness MESSAGE_FIXTUREs). TDD
      throughout."
  - id: AC004
    text: "Release pipeline hardening: (a) publish.yml runs a pre-publish smoke test
      -- npm pack, install the tarball into a temp directory, run pitway init,
      assert .pitway/config.yaml exists -- failing the publish on smoke failure;
      (b) a tag-triggered step creates a GitHub Release attaching the built
      tarball; (c) README gains a prominent Limitations note near the driver
      section stating which guarantees PitWay mechanically enforces versus which
      rely on driver discipline (approval gates, footer habits), consistent with
      existing protocol disclosures."
  - id: AC005
    text: "Scope discipline: the ONLY schema change permitted is AC003's
      additive-optional driver/model pair; no other schema/state-format changes,
      no new commands beyond the task-verify --timeout and task-update
      --driver/--model flags, no behavior changes outside the surfaces named
      above. Full suite and tsc --noEmit green; tree clean at completion;
      version stays 0.2.0 -- the 1.0.0 bump and tag push remain the developer's
      separate release-time action this milestone prepares for."
  - id: AC006
    text: "Governance: any amendment must be proposed by the agent and stop for
      explicit developer approval before the contract is mutated or execution
      continues; approval recorded before the amending command runs."
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npx vitest run tests/unit/task-verify.test.ts
      tests/integration/task-verify.test.ts tests/unit/claude-assets.test.ts
      tests/unit/opencode-assets.test.ts tests/unit/codex-assets.test.ts
    timeout_ms: 600000
  - id: CT002
    criterion: AC002
    type: manual
    instruction: Run 'git branch' and 'git worktree list'; confirm no stale
      pitway/M0xx branches remain and only the main checkout is registered.
  - id: CT003
    criterion: AC003
    type: command
    command: npx vitest run tests/unit/task-update-schema.test.ts
      tests/integration/task-update.test.ts tests/unit/git-commit.test.ts
  - id: CT004
    criterion: AC004
    type: manual
    instruction: Review publish.yml smoke + release steps and the README Limitations
      callout against this contract's text.
  - id: CT005
    criterion: AC005
    type: command
    command: npm run build && npm test && npx tsc --noEmit
    timeout_ms: 900000
  - id: CT006
    criterion: AC006
    type: manual
    instruction: Confirm every amendment applied to this contract carries recorded
      explicit developer approval made before the amending command ran.
---

# Contract

## Objective

Land the prioritized findings from the v1.0.0 readiness review: fix the one functional defect (task-verify's hardcoded 120s budget blocking sanctioned full-suite verifications), clean release-tag hygiene, broaden the trailer scrubber for driver neutrality, harden the publish pipeline with a smoke gate and GitHub Release, and frame PitWay's honest enforcement boundary prominently in README.

## Background

Senior architect/CTTO review verdict: architecture sound, not yet 1.0-ready. Findings adopted here: Major #1 (timeout), #2 (hygiene), #5 (scrubber); Minor #4 via smoke-gate confidence; Nice-to-have #8/#9 (smoke + release). Dropped after self-correction: roles-count drift (registry verified correct at nine roles). Out of scope by report: Windows CI matrix, update/journal file splits, B024.

## Scope

- `--timeout` on task-verify (flag, docs, tests) with a platform-neutral subprocess proof.
- Branch/worktree cleanup (git ops only; tasks.yaml not in the task's declared scope).
- Driver/model traceability fields (schema-additive, flags, persistence, tests); Git trailers untouched.
- publish.yml smoke + GitHub Release; README Limitations callout.

## Non-Goals

- Version bump to 1.0.0, tagging, npm publish.
- Windows CI matrix; large-file refactors; B024 implementation.

## Change Log

- 2026-08-23: Drafted from the v1.0.0 readiness review report.
