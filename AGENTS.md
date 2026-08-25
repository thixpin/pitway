# Agent Instructions

<!-- pitway:managed:start -->
- This project uses [PitWay](https://github.com/thixpin/pitway) to control the engineering workflow.
- Run `pitway resume` before starting or resuming any work.
- Never edit `.pitway/` directly.
- Work only within a confirmed task boundary.
- Obtain a task's bounded context via `pitway task-status <id> --context`.
<!-- pitway:managed:end -->

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

**PitWay is developed using its own workflow** (dogfooding): every change lands through a confirmed milestone/contract/task, following the pipeline below. The authoritative sources are the workflow state in `.pitway/` (milestones, contracts, backlog) — the original design record is archived at `docs/archive/IMPLEMENTATION_PLAN-v1.0.md` (frozen; never updated).

- **Never write implementation code outside a confirmed milestone task.** A milestone's contract must be presented to the developer and explicitly approved in conversation before its baseline commit or any task work.
- Check `.pitway/state.yaml` and the active milestone's `contract.md` / `tasks.yaml` to find current state and next work before doing anything.

## What PitWay Is

An npm-distributed CLI (`npx pitway init`; unscoped package name `pitway`) that controls the engineering *process* around AI coding agents — it is not itself an agent. Core philosophy: **"Claude drives the interaction; PitWay controls the workflow state and engineering boundaries."**

Pipeline: Requirement → Milestone → Contract → human confirmation → verification plan → right-sized task graph → task-level TDD (RED→GREEN→REFACTOR) → verification → atomic commit → milestone contract verification → completion.

Non-goals: not a multi-agent framework, coding agent, PM SaaS, CI/CD platform, database-backed orchestration service, or web dashboard.

## Architecture Constraints (binding on all code)

- **Layering**: `CLI → Core → State Store (.pitway/) + Git module`. Claude Code is the primary driver via slash commands, but **the driver never touches `.pitway/` directly** — every state read and mutation goes through a CLI command, and Core validates every transition. This is the load-bearing rule that keeps Core agent-agnostic.
- **Core must never import AI-provider code.** Claude-specific material is text assets only (`src/integrations/claude/`), installed by `pitway init` (default on, `--no-claude` opt-out). Additional drivers may ship as text-asset integrations only, under src/integrations/<driver>/, sharing common assets from src/integrations/common/ via a static, hardcoded common-to-override lookup — never a runtime-loaded plugin system, never dynamic driver registration, never a Core code change, never AI-provider code inside Core.
- **State**: plain files in repo-local `.pitway/` (committed to git), schema v1 with `schema_version: 1` in every file. `contract.md` frontmatter is machine-authoritative (ACs, verification checks, status); the markdown body holds prose and the append-only Change Log. Verification *results* live separately in `verification-results.yaml`. One authoritative source per fact; no derived git data (SHAs) persisted — resolve from commit trailers.
- **Naming**: the racing metaphor (🏁 📜 🛠 🏎 🧪 🔧) is presentation-only, allowed in CLI output. All identifiers, schemas, files, and state values use engineering vocabulary — `status: in_progress`, never `status: racing`.
- **Task states**: `planned → waiting → ready → in_progress → review → completed`, plus `in_progress → blocked → ready`, `in_progress → failed → ready`, `planned|waiting|ready → cancelled`. Milestone states: `draft → confirmed → in_progress → review → completed`, `review → in_progress` on failed verification, `draft|confirmed → cancelled`. No micro-states.

## Key Operational Rules

- **Contract is the execution boundary**: never silently expand scope. A discovered conflict stops work, proposes a contract change (append-only Change Log entry), and waits for developer approval (`milestone-confirm --amend` re-approves).
- **Git safety**: clean working tree required at task *start* (stop and ask on dirty — never auto-stash/reset/absorb). One atomic commit per verified task containing code + same-task state update, with `PitWay-Milestone:` / `PitWay-Task:` trailers; message follows repo convention. Commit messages carry **only** PitWay traceability trailers — never agent/provider session metadata (`Claude-Session:`, `Co-Authored-By: Claude`, `Codex-Session:`, etc.); git history stays provider-agnostic, and workflow state or resume behavior must never depend on an AI conversation or session identifier. Baseline commit at milestone confirmation. Never commit RED states, retries, or intermediate edits. Execution is sequential by default; under `execution.strategy: parallel_worktrees`, eligible tasks dispatch into temporary worktrees on scaffolding branches (`pitway/task/<mId>-<tId>`) that are diff-applied to the main tree and removed at integration, never merged into history. Branches are a first-class shipped feature beyond that: `branch_strategy: milestone` gives each milestone its own branch, landed via a developer-invoked `milestone-merge` after completion — never auto-merged.
- **Human gate**: `milestone-confirm` runs only after explicit developer approval in the conversation.
- **Verification**: three check types — `command`, `manual`, `review` — defined in contract frontmatter, each mapped to an acceptance criterion. Commands are approved at confirmation via `verification_approved_hash`; `verify` refuses on hash mismatch. Never execute unapproved agent-authored commands.
- **Context isolation**: task subagents receive only the generated task-context bundle (task definition, acceptance criteria, contract excerpt, dependency results, relevant files, verification instructions) — never full milestone history. Results persisted as concise structured summaries, never transcripts.
- **Token accounting**: record only runtime-reported usage, never estimate (`usage: null` → `N/A`); accumulate across retries; planning/QA usage separate from task usage; never double-count. Same honesty for progress: no per-task percentages — milestone progress is `completed required tasks / total required tasks`.
- **Design priority order**: correctness > simplicity > predictability > recoverability > developer clarity > token efficiency > observability > extensibility > parallelism > feature count.

## Testing

Vitest, three tiers: unit (pure Core: state machines, dependency resolution, progress calc, usage aggregation, contract parsing, git safety logic), integration (real temp git repos, CLI end-to-end), and one end-to-end simulated milestone plus failure / blocked-dependency / resume / contract-change / dirty-tree / missing-usage cases. PitWay's own tasks use task-level TDD where appropriate.

## Response Style

Be concise by default.

- Lead with the outcome or current status.
- Do not repeat the request or narrate routine steps.
- Report only: changes, verification results, commit SHA, blockers, and decisions needed.
- Use short bullets; avoid long explanations unless requested.
- Keep progress updates to 1–3 sentences.
- Put necessary detail in contracts/docs, not chat summaries.
- When presenting a contract for approval, provide the complete contract.
- Expand only when ambiguity, risk, or a design decision requires explanation.


## Release Versioning

- Do not bump the package version during normal development or milestone execution.
- Bump the version only during release preparation, immediately before publishing a new release.
- When preparing a release, update `package.json` and any version-locked package metadata (such as `package-lock.json`) together.
- Add a new entry to `CHANGELOG.md` only when preparing that release. Changelog entries must be ordered newest to oldest.
- The release changelog should summarize user-facing changes since the previous published version, based on the completed milestones, commits, and release review. Should not include website or documentation changes that are not part of the published package.
- Run the required build and test gates after the version bump and before publishing.
- Versioning, changelog updates, and publishing are release-management concerns; they are not PitWay Core functionality.
