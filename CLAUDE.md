# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status: Bootstrap Phase

PitWay is being built here, and **PitWay is developed using its own workflow** (dogfooding). The authoritative documents are `IMPLEMENTATION_PLAN.md` (approved 2026-08-18; includes the confirmed architectural decisions and the milestone map) and the workflow state in `.pitway/`.

- Milestones M001–M003 follow the **manual PitWay protocol**: milestone/contract/task artifacts are hand-authored in `.pitway/` following schema v1, commits carry `PitWay-Milestone:` / `PitWay-Task:` trailers, and TDD + atomic-commit rules apply from the first commit. From M004 onward, PitWay manages its own development.
- **Never write implementation code outside a confirmed milestone task.** A milestone's contract must be presented to the developer and explicitly approved in conversation before its baseline commit or any task work.
- Check `.pitway/state.yaml` and the active milestone's `contract.md` / `tasks.yaml` to find current state and next work before doing anything.

There is no build tooling until M001's scaffold task lands. Once `package.json` exists: TypeScript strict / Node ≥ 20 / ESM, `vitest` for tests, runtime deps limited to `commander` + `yaml` + `zod`, MIT license. Add the real commands here at that point.

## What PitWay Is

An npm-distributed CLI (`npx pitway init`; unscoped package name `pitway`) that controls the engineering *process* around AI coding agents — it is not itself an agent. Core philosophy: **"Claude drives the interaction; PitWay controls the workflow state and engineering boundaries."**

Pipeline: Requirement → Milestone → Contract → human confirmation → verification plan → right-sized task graph → task-level TDD (RED→GREEN→REFACTOR) → verification → atomic commit → milestone contract verification → completion.

Non-goals: not a multi-agent framework, coding agent, PM SaaS, CI/CD platform, database-backed orchestration service, or web dashboard.

## Architecture Constraints (binding on all code)

- **Layering**: `CLI → Core → State Store (.pitway/) + Git module`. Claude Code is the primary driver via slash commands, but **the driver never touches `.pitway/` directly** — every state read and mutation goes through a CLI command, and Core validates every transition. This is the load-bearing rule that keeps Core agent-agnostic.
- **Core must never import AI-provider code.** Claude-specific material is text assets only (`src/integrations/claude/`), installed by `pitway init` (default on, `--no-claude` opt-out). No other adapters, no plugin system in MVP.
- **State**: plain files in repo-local `.pitway/` (committed to git), schema v1 with `schema_version: 1` in every file. `contract.md` frontmatter is machine-authoritative (ACs, verification checks, status); the markdown body holds prose and the append-only Change Log. Verification *results* live separately in `verification-results.yaml`. One authoritative source per fact; no derived git data (SHAs) persisted — resolve from commit trailers.
- **Naming**: the racing metaphor (🏁 📜 🛠 🏎 🧪 🔧) is presentation-only, allowed in CLI output. All identifiers, schemas, files, and state values use engineering vocabulary — `status: in_progress`, never `status: racing`.
- **Task states**: `planned → waiting → ready → in_progress → review → completed`, plus `in_progress → blocked → ready`, `in_progress → failed → ready`, `planned|waiting|ready → cancelled`. Milestone states: `draft → confirmed → in_progress → review → completed`, `review → in_progress` on failed verification, `draft|confirmed → cancelled`. No micro-states.

## Key Operational Rules

- **Contract is the execution boundary**: never silently expand scope. A discovered conflict stops work, proposes a contract change (append-only Change Log entry), and waits for developer approval (`milestone-confirm --amend` re-approves).
- **Git safety**: clean working tree required at task *start* (stop and ask on dirty — never auto-stash/reset/absorb). One atomic commit per verified task containing code + same-task state update, with `PitWay-Milestone:` / `PitWay-Task:` trailers; message follows repo convention. Baseline commit at milestone confirmation. Never commit RED states, retries, or intermediate edits. No branches/worktrees/stashes/merges; sequential execution in MVP.
- **Human gate**: `milestone-confirm` runs only after explicit developer approval in the conversation.
- **Verification**: three check types — `command`, `manual`, `review` — defined in contract frontmatter, each mapped to an acceptance criterion. Commands are approved at confirmation via `verification_approved_hash`; `verify` refuses on hash mismatch. Never execute unapproved agent-authored commands.
- **Context isolation**: task subagents receive only the generated task-context bundle (task definition, acceptance criteria, contract excerpt, dependency results, relevant files, verification instructions) — never full milestone history. Results persisted as concise structured summaries, never transcripts.
- **Token accounting**: record only runtime-reported usage, never estimate (`usage: null` → `N/A`); accumulate across retries; planning/QA usage separate from task usage; never double-count. Same honesty for progress: no per-task percentages — milestone progress is `completed required tasks / total required tasks`.
- **Design priority order**: correctness > simplicity > predictability > recoverability > developer clarity > token efficiency > observability > extensibility > parallelism > feature count.

## Testing

Vitest, three tiers: unit (pure Core: state machines, dependency resolution, progress calc, usage aggregation, contract parsing, git safety logic), integration (real temp git repos, CLI end-to-end), and one end-to-end simulated milestone plus failure / blocked-dependency / resume / contract-change / dirty-tree / missing-usage cases. PitWay's own tasks use task-level TDD where appropriate.
