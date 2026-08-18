# PitWay Implementation Plan (§56)

Status: **approved by the developer on 2026-08-18**, with all five §17 open questions resolved (answers recorded inline in §17). Implementation proceeds via the bootstrap milestone map below, starting with the M001 contract.
Inputs: the original PitWay specification (a 57-section design document, removed from the repository at the developer's request after approval — inline "spec §" citations below refer to it; its binding content is fully incorporated into this plan and CLAUDE.md) + the 15 confirmed architectural decisions of 2026-08-18 (Claude-driven model, versioned `.pitway/`, commit trailers, no per-task percentages, verification schema, frontmatter contracts, retry-accumulating usage, schema versioning, git required, task state machine, changelog traceability, dogfooding, two-phase bootstrap, preserved decisions). Those decisions are treated as fixed; this plan builds on them and does not reopen them.

---

## 1. Proposed Architecture

```text
Developer ⇄ Claude Code (driver: conversation, reasoning, agent execution)
                │  slash commands + driver protocol
                ▼
        PitWay CLI  ←──────────── also usable directly by the developer
                │  (the machine API: every read and every state mutation)
                ▼
        PitWay Core (milestones, contracts, tasks, dependencies,
                     verification, git, metrics — pure use cases)
                ▼
        State Store (.pitway/ read/write + schema validation)
                +
        Git module (child_process → git)
```

**Core rule: the driver never touches `.pitway/` directly.** Every state mutation and every state read goes through a CLI command; Core validates every transition. *Why:* this is the only boundary that keeps Core agent-agnostic in a Claude-driven world — Claude converses and reasons freely, but the workflow state can only change through validated use cases. A future Codex/Gemini/OpenCode integration is "teach that agent to call the same CLI," with zero Core changes. It also means the CLI works identically when a human types the commands (bootstrap Phase 1, debugging, non-agent use).

Core is a library with no I/O of its own except through the State Store and Git module; the CLI layer is argument parsing + output formatting only. Claude-specific material lives entirely in `src/integrations/claude/` as installable text assets (see §9) — no Claude imports anywhere in Core, satisfying spec §2/§52.

## 2. Repository Structure

```text
pitway/
├── package.json              # bin: pitway
├── src/
│   ├── cli/                  # command definitions, --json/human formatting
│   ├── core/                 # milestones/ contracts/ tasks/ verification/ git/ metrics/
│   ├── state/                # .pitway/ schemas (v1), load/save, validation
│   └── integrations/claude/  # slash-command templates + driver protocol (text assets)
├── templates/                # files written by `pitway init`
├── tests/
│   ├── unit/
│   ├── integration/
│   └── workflow/
├── .pitway/                  # PitWay's own dogfooded state (decision 13)
└── IMPLEMENTATION_PLAN.md
```

**Proposed stack** (open question #1, recommendation): TypeScript (strict) on Node ≥ 20, ESM. Runtime dependencies limited to `commander` (CLI parsing), `yaml` (state files), `zod` (schema validation — correctness is priority 1 and hand-rolled validators are where state stores rot). Dev: `vitest` + `tsup` (or `tsc`) build. *Why TS:* the domain is state machines and schemas; the type system is cheap insurance exactly there. *Why so few deps:* spec §57.

## 3. Core Domain Model

Entities: **Requirement** (optional BRS doc), **Milestone** (owns a Contract), **Contract** (objective, scope, non-goals, acceptance criteria, verification checks, change log), **Task** (node in dependency graph), **VerificationCheck** (CT; `command | manual | review`), **UsageRecord** (measured tokens, categorized).

Use cases (Core's public surface, mirrored 1:1 by CLI commands): `createMilestone`, `confirmMilestone` (incl. amendment re-approval), `transitionTask`, `completeTask` (result + commit), `resolveReadyTasks` (dependency resolution), `buildTaskContext`, `recordVerification`, `runCommandChecks`, `recordUsage`, `resumeSummary`, `statusSummary`. Contract-vs-task separation per spec §10: the contract states what must be true; tasks state how.

## 4. State Schema (`.pitway/`, schema v1)

```text
.pitway/
├── config.yaml               # schema_version: 1 (reserved; no speculative settings)
├── state.yaml                # schema_version, milestones: [M001, …], active_milestone
├── requirements/R001.md      # optional, concise BRS style
└── milestones/M001/
    ├── contract.md           # AUTHORITATIVE contract (frontmatter + body)
    ├── tasks.yaml            # task graph + results + usage
    ├── verification-results.yaml
    └── usage.yaml            # milestone-level measured usage (planning / qa)
```

`contract.md` (decision 7, refined): frontmatter is the machine-authoritative part — `schema_version, id, title, status, requirement, confirmed_at, acceptance_criteria: [{id, text}], verification: [{id, criterion, type, command|instruction}], verification_approved_hash`. The markdown body holds Objective / Scope / Non-Goals / notes / **Change Log** (append-only, decision 12). *Why ACs and CTs in frontmatter rather than body:* Core must enumerate them reliably for AC→CT mapping and `verify`; parsing prose headings is fragile. The body never restates AC/CT definitions — status output renders them from frontmatter, preserving single-source-of-truth.

`tasks.yaml` per task: `id, objective, status, depends_on, acceptance_criteria, relevant_files, verification (strategy + detail), result (null | {summary, evidence}), usage (null | {attempts, total_tokens, input_tokens?, output_tokens?})`. Results are concise structured summaries — never transcripts (spec §7/§20).

`verification-results.yaml`: `[{check, status: pass|fail, at, evidence, recorded_by: command|developer}]`. *Why separate from the contract:* definitions (approved, changelog-controlled) and results (mutable, per-run) are different facts; splitting them is what keeps the contract single-source without freezing results.

Authority rules: milestone status lives only in contract frontmatter; `state.yaml` holds only the index and active pointer (list/status commands read per-milestone files — cheap at this scale, and no dual truth). **No derived git data is persisted** (decision 4): commit SHAs are resolved from trailers on demand. Every file carries `schema_version: 1` (decision 9); loaders reject unknown versions; no migration framework until a v2 exists.

## 5. Milestone State Machine

```text
draft → confirmed → in_progress → review → completed
draft | confirmed → cancelled
review → in_progress          (contract verification failed → local re-plan, spec §29)
```

`confirmed → in_progress` happens at the baseline commit. `review` is the contract-verification + Senior-QA boundary. Six states, no micro-states.

## 6. Task State Machine (decision 11, adopted verbatim)

```text
planned → waiting → ready → in_progress → review → completed
in_progress → blocked;  blocked → ready
in_progress → failed;   failed → ready
planned | waiting | ready → cancelled
```

Semantics: tasks are `planned` while the milestone is a draft; milestone confirmation moves all to `waiting`; dependency resolution promotes to `ready` (no deps ⇒ ready immediately). Core rejects invalid transitions with an explicit error naming the allowed ones. Retries: `failed → ready` re-enters the same task; usage accumulates (§12 below).

## 7. CLI Commands

All commands support `--json` (the machine interface Claude consumes) alongside human-readable output with the racing presentation layer (spec §1).

Developer-facing (spec §37, unchanged): `init`, `milestone-add`, `milestone-status`, `milestone-list`, `task-status`, `resume`, `verify`.

Machine-facing additions — each is a required use case in the Claude-driven model, not speculation:

| Command | Purpose |
|---|---|
| `milestone-add --contract <file> [--tasks <file>] [--requirement <file>]` | Create milestone in `draft` from driver-drafted artifacts (validated against schema) |
| `milestone-confirm <id> [--amend]` | Human gate: freeze contract, hash-approve verification commands, git safety check, baseline commit, tasks → `waiting`/`ready` |
| `task-status <id> [--context]` | `--context` emits the minimal task-context bundle (§8) |
| `task-update <id> --status <s> [--result <file>] [--usage <json>] [--message <file>]` | Validated transitions; `--status completed` performs the atomic task commit |
| `usage-add <milestone> --category planning\|qa --usage <json>` | Milestone-level measured usage (decision 8) |
| `verify [<id>] [--check CTnnn] [--pass\|--fail --evidence <text>]` | Run approved `command` checks; record `manual`/`review` outcomes |

Ten commands total (`--context` is a flag, not a command). *Why this doesn't violate "small surface":* the surface grows only where the driver needs a mutation Core must validate; every alternative (Claude editing YAML directly) breaks the architecture's one load-bearing rule.

`init` (decision 10): refuses outside a git work tree with a clear message (`git init` instructions, no auto-init); writes `.pitway/` skeleton + Claude integration files (opt-out `--no-claude`, open question #4).

## 8. Agent Interface

MVP agent interface = **the CLI's `--json` contract** plus one deterministic artifact: the **task context bundle** from `task-status <id> --context`, containing exactly the spec §20 list — task definition, task acceptance criteria, relevant contract excerpt (objective + mapped ACs only), dependency results (their concise `result.summary`), relevant file paths, verification instructions. *Why generated rather than driver-assembled:* context minimization becomes a deterministic Core behavior instead of a prompt-discipline hope; every current and future adapter gets it for free. Accepted limitation (decision 1): the surrounding Claude session context cannot be isolated; PitWay guarantees only that *it* never forwards milestone history or unrelated state into the bundle.

No in-process plugin API, no adapter SDK, no additional adapters in MVP (spec §3/§39).

## 9. Claude Code Adapter

Text assets installed by `init` — no runtime code:

- `.claude/commands/`: `milestone-add.md`, `milestone-status.md`, `milestone-list.md`, `task-status.md`, `resume.md`, `verify.md`. Each is thin: it names the domain use case and points to the protocol. `/milestone-add` runs the spec §9 flow conversationally (requirement capture, minimal clarifying questions, targeted repo inspection, draft contract + right-sized task graph as files, `pitway milestone-add`, then the confirmation gate).
- One concise **driver protocol** document (installed under `.claude/` and referenced by every command; kept far smaller than the spec per §41). Its rules: all state reads/mutations via `pitway` CLI, never edit `.pitway/` directly; no implementation before the milestone is confirmed; present the full contract to the developer and run `pitway milestone-confirm <id>` only after their explicit approval in the conversation (resolved question #3); execute tasks by spawning subagents whose input is the `--context` bundle and nothing else; report `--usage` only from runtime-reported numbers, otherwise omit; report results as concise structured summaries; never include provider or session metadata in proposed commit messages (PitWay trailers only — the git module also strips such lines mechanically, see §10); on contract conflict stop and follow the change flow (decision 12).

Usage capture: when the Claude Code runtime reports subagent token usage, the driver passes it to `task-update --usage`; when it doesn't, usage stays `null` → `N/A`. Never estimated (decision 8).

## 10. Git Strategy

- **Clean-tree-at-task-start invariant:** `task-update --status in_progress` runs the safety check; a dirty tree stops with "ask the developer" (spec §26) — PitWay never stashes/resets/absorbs. *Why at start:* PitWay cannot classify dirty files as related/unrelated at commit time; requiring a clean start makes every change at completion attributable to the task, deterministically.
- **One atomic commit per completed task** containing the code changes *and* the same-task `.pitway/` state update. Message: driver-proposed (repo convention) via `--message-file`; PitWay appends trailers `PitWay-Milestone: M001` / `PitWay-Task: T002`. **Commits PitWay creates in managed projects are provider-agnostic**: the git module sanitizes every driver-proposed message, stripping provider/session metadata lines (`Claude-Session:`, `Co-Authored-By: Claude`, `Codex-Session:`, `Gemini-Session:`, and the like) before committing — mechanical enforcement, not protocol discipline — so PitWay trailers are the only workflow metadata in a managed repo's history, and no PitWay behavior ever depends on an AI conversation or session identifier. SHAs are resolved from trailers when needed and never duplicated into state (decision 4). Robustness assessment: trailers survive rebases (content-stable), work with `git log --grep`; shallow clones may not see old history — acceptable for MVP since nothing functional depends on SHA lookup, it is traceability only. No simpler alternative found; adopted as proposed.
- **Baseline commit** at `milestone-confirm` (`workflow: add milestone M001` + milestone trailer) — this is also the moment the milestone's `.pitway/` artifacts get committed, closing the state/commit circularity at a defined boundary. Never empty (spec §27).
- `.pitway/` is version-controlled (decision 3); `init` does *not* gitignore it; runtime-disposable data is simply never written there.
- Never RED states, retries, or intermediate edits committed; no branches/worktrees/stashes/merges; sequential execution (MVP, preserved decision).
- **Branch strategy is a repository-level policy, single-branch by default.** MVP behavior is `git.branch_strategy: main` — PitWay never creates or switches branches automatically; task and baseline commits land on whatever branch is currently checked out. A `milestone` strategy (each milestone isolated on its own branch) is designed but deliberately deferred — see §15.

## 11. Verification Strategy

Three CT types (decision 6): `command`, `manual`, `review`, defined in contract frontmatter, each mapped to an AC.

**Approval boundary:** `milestone-confirm` canonicalizes the `verification` list and stores `verification_approved_hash` in the frontmatter. `pitway verify` recomputes the hash first and refuses to run on mismatch, directing to the amendment flow (`milestone-confirm --amend` after a Change Log entry + developer approval). *Why a hash rather than a frozen copy:* one file stays authoritative; the hash records "what was approved" as a separate fact without duplicating the definitions. This mechanically enforces "agent-authored commands never silently become trusted" — an edited or added command cannot execute until a human re-confirms.

Execution: `command` CTs run via shell in the repo root, exit code ⇒ pass/fail, evidence = trimmed output summary. `manual`/`review` CTs are recorded by the developer (`verify --check CT002 --pass --evidence "…"`), stamped `recorded_by: developer`. Milestone `review → completed` requires: all required tasks completed, all CTs pass, Senior QA review recorded at the completion boundary (spec §14).

## 12. Token Accounting Strategy

Decision 8, operationalized: usage recorded only when runtime-reported; `null` ⇒ `N/A`; task usage accumulates across attempts (`attempts` counter + summed totals — retries are real cost); milestone-level planning/QA usage recorded separately via `usage-add`. Aggregation: milestone total = Σ measured task usage + measured milestone-level usage; tasks with `null` are excluded and *surfaced*, e.g. `Tokens: 84.2k (2 tasks N/A)` — measured and unavailable are never blended (spec §33). No estimates anywhere, including progress: milestone progress = `completed required tasks / total required tasks` (decision 5); task rows show status glyphs only, no percentages.

## 13. Testing Strategy

Vitest, three tiers (spec §48):

- **Unit** (pure Core, no I/O): task/milestone state machines (every legal and illegal transition), dependency resolution incl. cycles, progress calculation, usage aggregation (null-mixing, double-count guards), contract frontmatter parse/validate, verification hash canonicalization, git safety decision logic (git calls mocked).
- **Integration** (real temp git repos, CLI invoked end-to-end): `init` (incl. non-git refusal), `milestone-add` from fixture artifacts, `milestone-confirm` (baseline commit + trailer + hash), task lifecycle with atomic commit + trailers, `resume` from cold state, `verify` with stub commands and the hash-mismatch refusal.
- **Workflow**: one simulated milestone requirement→completion, plus the six spec cases — task failure, blocked dependency, cross-session resume, contract change (amend flow), dirty working tree, missing token usage.

PitWay's own tasks follow task-level TDD where appropriate (decision 13); non-code tasks (docs, templates) use `manual`/`review` verification per spec §24.

## 14. MVP Scope

Everything in §§1–13 above and nothing more, proving spec §55's eight points: repo-local state (schema v1) · contract lifecycle with human gate · task graph with sequential execution · TDD workflow support via context bundles · safe git checkpoints (baseline + atomic trailer commits) · status/resume from cold state · Claude integration without core coupling · deterministic context minimization. Plus npm packaging (`pitway`, verified unclaimed on npm as of 2026-08-18 — claim early) and the spec §49 README.

## 15. Deferred Features

Codex/Gemini/OpenCode adapters · parallel execution, worktrees · plugin/adapter SDK · weighted or per-task progress · contract versioning beyond the changelog · schema migration framework · requirement/BRS tooling beyond a plain markdown template · milestone archiving/pruning · `pitway doctor` · non-git support · any web/UI anything (non-goal).

### Deferred: milestone-level Git branch strategy

**Architectural principle (durable, applies once implemented): milestones may own branches; tasks own commits.** Branch isolation, if ever added, is at the milestone level only — never per-task (`pitway/M001-auth` holding all of T001..Tn's commits, not a branch per task). This preserves the MVP rule that sequential execution and atomic task commits are the core workflow; branch isolation is an optional Git policy layered on top, not a prerequisite for it.

Design sketch for a future milestone (tentatively **"Milestone Git Isolation"**, not yet scheduled or contracted):

- **Config**: repository-level policy, e.g. `git.branch_strategy: main` (current MVP default — no automatic branch creation/switching) or `git.branch_strategy: milestone`. Exact key naming may be refined against the config schema in place when this is built.
- **Flow under `milestone`**: git safety check passes → create a deterministically-named branch (`pitway/M001-<slug>`, naming not over-engineered) from the current base branch → record that base branch name and base revision in the milestone's state (never hard-code `main`; repos may use `master`, `develop`, `release/*`, etc.) → baseline commit → task atomic commits stay on that branch → contract verification → milestone completion leaves the branch **merge-ready / PR-ready**, without an automatic merge — integration stays developer-controlled, compatible with protected-branch/PR workflows. Automatic-merge behavior, if ever wanted, would be a separate, later decision.
- **Resume**: a fresh session must be able to detect it's on (or reattach to) the correct milestone branch from persisted state, and detect a branch mismatch.
- **Safety**: preserves every existing Git safety rule — dirty-tree checks stop and report rather than stash/reset; no force-push; no deleting branches containing work; no automatic conflict resolution. These are non-negotiable, not specific to this feature.
- **Agent independence**: this is PitWay Core / Git-policy behavior, not Claude-specific — every driver (Claude, Codex, or otherwise) goes through the same Core git policy rather than inventing its own branch handling.
- **Candidate acceptance criteria** for that future contract: configuration read/validated; branch created only after a passing safety check; deterministic naming; base branch and base revision tracked in state; resume reattaches to (or detects mismatch with) the milestone branch; task commits land on the milestone branch; contract verification required before completion; completion reaches a merge-ready/PR-ready state without an automatic merge; no automatic destructive Git operation is ever performed.

This is a planning note only. **M002 is unaffected** — its confirmed contract already excludes branches, worktrees, stashes, and merges, and that boundary is preserved rather than modified. No current milestone owns this work; it becomes a candidate contract at a future milestone boundary, proposed and confirmed the same way every other milestone is.

## 16. Risks / Trade-offs

1. **The human gate is procedural, not physical.** A misbehaving driver could run `milestone-confirm` without real approval. Mitigation: the protocol requires explicit developer approval in the conversation before Claude runs `milestone-confirm` (resolved question #3), and the command prints the contract summary before acting; residual risk accepted for MVP.
2. **Usage data is best-effort.** If the runtime doesn't expose subagent usage, milestones show mostly `N/A`. Accepted by design; never estimated.
3. **Session context bleed.** Claude-driven means the main session sees more than the task bundle. Accepted (decision 1); the bundle still bounds what *task subagents* see.
4. **Frontmatter drift by hand-editing.** A human editing `contract.md` outside the flow can desync approved state. Mitigated by the verification hash (execution refuses) and load-time schema validation; not fully preventable.
5. **Clean-tree-at-start friction.** Developers with WIP must park it before a task starts. Deliberate: determinism over convenience (spec §51).
6. **Trailer lookup needs history.** Shallow clones can't resolve old task SHAs. Traceability-only impact; documented.
7. **Bootstrap overhead.** Phase 1 (manual protocol) is slower than freestyle coding. It doubles as validation of the schema and workflow before code enforces them — cost accepted.

## 17. Open Questions Requiring Developer Decisions

All resolved by the developer on 2026-08-18:

1. **Stack**: approved — TypeScript strict / Node ≥ 20 / ESM / vitest / commander + yaml + zod as the only runtime deps.
2. **License**: MIT.
3. **Confirmation mechanics**: Claude may execute `milestone-confirm` itself, but only after explicit developer approval in the conversation; the developer is not required to type the command.
4. **`init` installs Claude integration by default**, with `--no-claude` opt-out.
5. **npm name**: target unscoped `pitway`; re-check registry availability immediately before publishing.

---

# Bootstrap → Self-Hosted Transition (decisions 13–14)

**Phase 1 — Manual PitWay Protocol.** Milestone/contract/task artifacts are hand-authored directly in `.pitway/` following schema v1 exactly (this dogfoods the schema before any code reads it); commits are manual but carry the PitWay trailers; TDD and atomic-commit rules apply from the first commit.

Proposed milestone map (right-sized; each independently verifiable):

| Milestone | Scope | Mode |
|---|---|---|
| M001 | Project scaffold + state layer: schema v1 types, load/save/validate `.pitway/`, task & milestone state machines (pure Core, fully unit-tested) | manual |
| M002 | Git module (safety check, trailer commits, baseline) + read commands: `milestone-status`, `milestone-list`, `task-status` (incl. `--context`), `resume` | manual |
| M003 | Mutation commands: `init`, `milestone-add`, `milestone-confirm`, `task-update` (atomic completion commits) | manual |
| **— transition —** | **M004 onward is created and driven through PitWay itself** | |
| M004 | `verify` (3 types + approval hash), `usage-add`, aggregation, status polish | self-hosted |
| M005 | Claude integration assets, README, npm packaging & publish | self-hosted |

**Transition criterion (explicit and verifiable):** after M003 completes, run `pitway resume` in this repo — it must correctly report M001–M003 completed from the hand-authored state; then create M004 via `pitway milestone-add` / `milestone-confirm` and execute its first task through `task-update`. The M004 baseline commit existing *with trailers written by PitWay itself* is the verification evidence that PitWay now develops PitWay.

---

**Next step after approval:** draft Milestone M001's contract (manually, per Phase 1), confirm it, baseline-commit, and begin the first TDD task. No substantial code before that confirmation.
