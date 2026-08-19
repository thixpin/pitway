# PitWay Implementation Plan (§56)

Status: **approved by the developer on 2026-08-18**, with all five §17 open questions resolved (answers recorded inline in §17). Implementation proceeds via the bootstrap milestone map below, starting with the M001 contract.
Revised **2026-08-19** after M004's completion: §7 reflects the actual 11-command surface, §10 records the discovered trailer-lookup limitations, §16 adds risk 8 (task-amendment gap), and the Bootstrap section records the actual M001–M004 outcomes plus the revised M005–M011 roadmap. Revised again **2026-08-19** (M005/T009, then M006/T006): §7 now reflects the actual 14-command surface through M006 (`task-amend`, `write-ms-artifacts`, `auto-run` added), §9 reflects M006's actually-delivered Claude Code Adapter (full asset list, driver/worker split, interactive UX, bootstrap disclosure), §11 records M006's verification-execution hardening, and the Bootstrap section's delivery table now includes M005. §§1–13 are otherwise preserved as the approved design record; M001–M005 history is not rewritten.
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
| `milestone-confirm <id> [--amend --file <path>]` | Human gate: freeze contract, hash-approve verification commands, git safety check, baseline commit, tasks → `waiting`/`ready`. `--amend` (M005/T004) takes a validated draft contract file — never a hand-edit of the live `contract.md` — journal-records and materializes immediately, no commit of its own; folds into the next checkpoint |
| `task-status <id> [--context]` | `--context` emits the minimal task-context bundle (§8) |
| `task-update <id> --status <s> [--result <file>] [--usage <json>] [--message <file>]` | Validated transitions; `--status completed` performs the atomic task commit |
| `usage-add <milestone> --category planning\|qa --usage <json>` | Milestone-level measured usage (decision 8); M005/T004: journal-records and materializes `usage.yaml` immediately, no commit of its own — folds into the next checkpoint the same way |
| `verify [<id>] [--check CTnnn] [--pass\|--fail --evidence <text>]` | Run approved `command` checks; record `manual`/`review` outcomes |
| `milestone-complete <id>` | Validated `in_progress → review → completed` in one persisted write, gated on every non-cancelled task completed and the latest result per check passing; clears `active_milestone`; resumable completion commit (added during M004 — completion proved to need its own validated use case, symmetric with confirm) |
| `task-amend <id> --file <path> --change-log <text>` | M005/T005: validated, developer-approved task-definition amendment (objective/acceptance_criteria/relevant_files/context_files/write_scope/verification only — identity, status, dependencies, and history stay immutable); journal-records and materializes `tasks.yaml` immediately, no commit of its own; cumulative chained amendments for the same task supported (never a silent "latest wins") |
| `write-ms-artifacts --contract <file> --tasks <file> --destination <dir> [--overwrite]` | M005/T006: writes a draft contract + task graph as non-authoritative files to an explicit destination outside `.pitway/`, reusing `milestone-add`'s validation without its state-mutating half — no confirm, no commit, no dispatch |
| `auto-run enable\|disable\|status [milestone-id]` | M006/T005: agent-agnostic auto-run authorization, managed entirely through this command — never written directly by the Claude integration layer. `enable` requires the target milestone be `in_progress` and records its current `verification_approved_hash`; `disable`/`status` work for a milestone in any status. Authorization is derived purely (`isAutoRunAuthorized`) from a new sibling journal record kind (`auto_run` — never checkpoint-eligible, structurally excluded from `derivePending`/`resolveTargetPath`/checkpoint folding, not a 4th value of the existing amendment-type enum) and invalidates on a hash change or a later contract/task amendment, both computed from the journal's own append order. `status` names the specific reason when not authorized. Subcommands nest under one top-level `auto-run` entry, not three separate top-level commands |

Fourteen commands total as implemented through M006 (`--context` is a flag, not a command): `init`, `milestone-add`, `milestone-confirm`, `milestone-list`, `milestone-status`, `task-status`, `task-amend`, `task-update`, `resume`, `verify`, `milestone-complete`, `usage-add`, `write-ms-artifacts`, `auto-run` — all registered on the single entry point (`buildCli` + `registerAllCommands`, M004/T007; extended M005/T005-T006, M006/T005). *Why this doesn't violate "small surface":* the surface grows only where the driver needs a mutation Core must validate; every alternative (Claude editing YAML directly) breaks the architecture's one load-bearing rule.

`init` (decision 10): refuses outside a git work tree with a clear message (`git init` instructions, no auto-init); writes `.pitway/` skeleton + Claude integration files (opt-out `--no-claude`, open question #4).

## 8. Agent Interface

MVP agent interface = **the CLI's `--json` contract** plus one deterministic artifact: the **task context bundle** from `task-status <id> --context`, containing exactly the spec §20 list — task definition, task acceptance criteria, relevant contract excerpt (objective + mapped ACs only), dependency results (their concise `result.summary`), relevant file paths, verification instructions. *Why generated rather than driver-assembled:* context minimization becomes a deterministic Core behavior instead of a prompt-discipline hope; every current and future adapter gets it for free. Accepted limitation (decision 1): the surrounding Claude session context cannot be isolated; PitWay guarantees only that *it* never forwards milestone history or unrelated state into the bundle. M006's dogfood measurement (`docs/evidence/M006-context-efficiency.md`) found this last guarantee is not yet fully met by the implementation: `contractExcerpt.acceptanceCriteria` currently returns the *entire* contract's AC array unfiltered, not scoped to a task's own mapped criterion (measured at 89% of one real bundle's bytes) — a known, disclosed, not-yet-fixed gap, not a design change; §8's "mapped ACs only" wording above states the intended behavior. M006 also extended decision 1's disclosure explicitly to dispatched *subagents*, not only the main session: PitWay claims only that the supplied bundle is bounded, never that a subagent's total context is (harness-injected system prompt, tools, skills, memory are outside PitWay's control or visibility) — and it builds no runtime enforcement preventing a subagent from reading a file outside its declared `context_files`; only the *write* boundary (`write_scope`) is mechanically enforced, at commit time. Whether/how to build actual read enforcement is deferred to M007.

No in-process plugin API, no adapter SDK, no additional adapters in MVP (spec §3/§39).

## 9. Claude Code Adapter

Text assets installed by `init` — no runtime code, delivered M006/T003 (protocol split + 12 lifecycle command docs) and M006/T005 (`commands/auto-run.md` + `interactive-ux.md`), 20 files under `src/integrations/claude/`, zero `.ts` files, zero Claude/Anthropic SDK imports anywhere in the codebase (structurally tested):

- `.claude/commands/`: `milestone-add.md`, `milestone-confirm.md`, `milestone-status.md`, `milestone-list.md`, `task-status.md`, `task-update.md`, `task-amend.md`, `resume.md`, `verify.md`, `milestone-complete.md`, `usage-add.md`, `write-ms-artifacts.md`, `auto-run.md` — thirteen of the fourteen commands (§7); `init` gets no asset (developer-run once, self-documents via `--help`). Each is thin: it names the domain use case and points to the driver protocol document, never restating `--help` output.
- The driver protocol is split, not a single document: `protocol-driver.md` (main-session-facing — the one rule, dispatch discipline, decision gates) and `protocol-worker.md` (the fixed text accompanying a `--context` bundle to a dispatched subagent, and nothing else — a dispatched worker's installed instructions never include the full driver document). Supporting documents: `dispatch.md` (the bounded-dispatch sequence and its honesty boundary, see §8), `report-format.md` (capped worker reports), `lsp-guidance.md` (optional LSP use — guidance only, PitWay has no LSP detection/integration code of its own and does not manage a driver's tool availability), `coordination.md` (fresh-snapshot discipline after each dispatched subagent, citing the existing `src/git/safety.ts` primitives by name), and `interactive-ux.md` (the two arrow-key decision prompts and every auto-run invalidation gate, computed and live-checked — see §7's `auto-run` row).
- Driver protocol rules (unchanged in substance from the original design, now actually shipped): all state reads/mutations via `pitway` CLI, never edit `.pitway/` directly; no implementation before the milestone is confirmed; present the full contract to the developer and run `pitway milestone-confirm <id>` only after their explicit approval in the conversation (resolved question #3); execute tasks by spawning subagents whose input is the `--context` bundle and nothing else; report `--usage` only from runtime-reported numbers, otherwise omit; report results as concise structured summaries; never include provider or session metadata in proposed commit messages (PitWay trailers only — the git module also strips such lines mechanically, see §10); on contract conflict stop and follow the change flow (decision 12). Explicit clarification added in M006: PitWay does not programmatically spawn Claude agents anywhere in this codebase — the installed documents instruct whatever agent driver is already running on how to use its own tooling; PitWay supplies instructions and small provider-neutral pure helpers (e.g. `checkWriteScope`), never an agent-spawning mechanism.
- Bootstrap disclosure (`interactive-ux.md`, mirrors M005's own pattern): M006 uses M005's journal/checkpoint model normally for its own real lifecycle; the only gap is that its own interactive confirmation UX did not exist yet at M006's baseline confirm, so M006's own confirm necessarily happened through the pre-existing, non-interactive `milestone-confirm` command.

Usage capture: when the Claude Code runtime reports subagent token usage, the driver passes it to `task-update --usage`; when it doesn't, usage stays `null` → `N/A`. Never estimated (decision 8).

## 10. Git Strategy

- **Clean-tree-at-task-start invariant:** `task-update --status in_progress` runs the safety check; a dirty tree stops with "ask the developer" (spec §26) — PitWay never stashes/resets/absorbs. *Why at start:* PitWay cannot classify dirty files as related/unrelated at commit time; requiring a clean start makes every change at completion attributable to the task, deterministically.
- **One atomic commit per completed task** containing the code changes *and* the same-task `.pitway/` state update. Message: driver-proposed (repo convention) via `--message-file`; PitWay appends trailers `PitWay-Milestone: M001` / `PitWay-Task: T002`. **Commits PitWay creates in managed projects are provider-agnostic**: the git module sanitizes every driver-proposed message, stripping provider/session metadata lines (`Claude-Session:`, `Co-Authored-By: Claude`, `Codex-Session:`, `Gemini-Session:`, and the like) before committing — mechanical enforcement, not protocol discipline — so PitWay trailers are the only workflow metadata in a managed repo's history, and no PitWay behavior ever depends on an AI conversation or session identifier. SHAs are resolved from trailers when needed and never duplicated into state (decision 4). Robustness assessment (extended 2026-08-19 with M004 findings): trailers survive ordinary rebases (content-stable) and work with `git log --grep`, but the limitations are real — shallow clones may not see old history; squash-merges and history rewrites can drop, merge, or duplicate trailer lines, breaking the one-commit-per-identity assumption; and unbounded `--grep` scans cost grows linearly with repository history. Acceptable for the sequential MVP since nothing functional depends on SHA lookup (traceability plus resume-identity checks only), and every identity check re-verifies the committed content, never trusting the trailer alone. Range-bounded trailer lookup from a persisted base revision is scheduled with milestone branch isolation (M009 in the revised roadmap). No simpler alternative found; adopted as proposed.
- **Baseline commit** at `milestone-confirm` (`workflow: add milestone M001` + milestone trailer) — this is also the moment the milestone's `.pitway/` artifacts get committed, closing the state/commit circularity at a defined boundary. Never empty (spec §27).
- `.pitway/` is version-controlled (decision 3); `init` does *not* gitignore it; runtime-disposable data is simply never written there.
- Never RED states, retries, or intermediate edits committed; no branches/worktrees/stashes/merges; sequential execution (MVP, preserved decision).
- **Branch strategy is a repository-level policy, single-branch by default.** MVP behavior is `git.branch_strategy: main` — PitWay never creates or switches branches automatically; task and baseline commits land on whatever branch is currently checked out. A `milestone` strategy (each milestone isolated on its own branch) is designed but deliberately deferred — see §15.

## 11. Verification Strategy

Three CT types (decision 6): `command`, `manual`, `review`, defined in contract frontmatter, each mapped to an AC.

**Approval boundary:** `milestone-confirm` canonicalizes the `verification` list and stores `verification_approved_hash` in the frontmatter. `pitway verify` recomputes the hash first and refuses to run on mismatch, directing to the amendment flow. Through M004 this meant hand-editing `contract.md` directly, then running `milestone-confirm --amend` to recompute/approve/commit; as of M005/T004, direct edits to `contract.md` are prohibited — `--amend --file <path>` takes a validated draft instead, journal-records and materializes immediately (no commit of its own), and a Change Log entry plus developer approval remain mandatory either way. *Why a hash rather than a frozen copy:* one file stays authoritative; the hash records "what was approved" as a separate fact without duplicating the definitions. This mechanically enforces "agent-authored commands never silently become trusted" — an edited or added command cannot execute until a human re-confirms.

Execution: `command` CTs run via shell in the repo root, exit code ⇒ pass/fail, evidence = trimmed output summary. `manual`/`review` CTs are recorded by the developer (`verify --check CT002 --pass --evidence "…"`), stamped `recorded_by: developer`. Milestone `review → completed` requires: all required tasks completed, all CTs pass, Senior QA review recorded at the completion boundary (spec §14).

**Verification-execution hardening (M006/T001-T002, closing a confirmed M005 defect — see M005 report.md §7/§13):** `command` checks carry an additive-optional `timeout_ms` (integer, 1–3,600,000ms, default 120000ms when omitted; command-type only, rejected on `manual`/`review` by schema discrimination; covered by the approval hash since it hashes the raw `verification:` block text). Execution runs through a dedicated process-execution helper with platform-aware descendant-process cleanup on timeout (POSIX: process-group `SIGKILL`; Windows: `taskkill /t /f`, implemented and decision-tested via mocks, not live-verified — no Windows CI exists for this repository). Each check's result — including a `duration_ms`/`termination_reason` (`exited | timeout | signal | spawn_error`, both additive-optional) — is persisted immediately after that check completes, not only once after the entire loop, so a later check's hang or timeout never discards earlier results. A repo+milestone-scoped recursion guard refuses a verification command that would re-enter the same live repository's verification of the same milestone, while explicitly permitting nested verification of an unrelated repository or milestone (needed for this project's own test suite, which spins up synthetic temp repos). `verify <id> --check CTnnn`, invoked without `--pass`/`--fail`/`--evidence` on a command-type check, re-executes exactly that one check in isolation through the same hash-gated, timeout-protected path — Core never retries automatically; retry-or-diagnose policy is the Claude driver's, applied via the protocol assets and interactive decision UX, never Core's.

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

This is a planning note only. **M002 is unaffected** — its confirmed contract already excludes branches, worktrees, stashes, and merges, and that boundary is preserved rather than modified. No current milestone owns this work; in the revised roadmap it is scheduled as **M009** (with parallel task worktrees following as **M010**), still proposed and confirmed the same way every other milestone is.

## 16. Risks / Trade-offs

1. **The human gate is procedural, not physical.** A misbehaving driver could run `milestone-confirm` without real approval. Mitigation: the protocol requires explicit developer approval in the conversation before Claude runs `milestone-confirm` (resolved question #3), and the command prints the contract summary before acting; residual risk accepted for MVP.
2. **Usage data is best-effort.** If the runtime doesn't expose subagent usage, milestones show mostly `N/A`. Accepted by design; never estimated.
3. **Session context bleed.** Claude-driven means the main session sees more than the task bundle. Accepted (decision 1); the bundle still bounds what *task subagents* see.
4. **Frontmatter drift by hand-editing.** A human editing `contract.md` outside the flow can desync approved state. Mitigated by the verification hash (execution refuses) and load-time schema validation; not fully preventable.
5. **Clean-tree-at-start friction.** Developers with WIP must park it before a task starts. Deliberate: determinism over convenience (spec §51).
6. **Trailer lookup needs history.** Shallow clones can't resolve old task SHAs. Traceability-only impact; documented.
7. **Bootstrap overhead.** Phase 1 (manual protocol) is slower than freestyle coding. It doubles as validation of the schema and workflow before code enforces them — cost accepted.
8. **Task definitions had no supported amendment path** (discovered 2026-08-19, materialized twice within M004 itself): commit `179491c` hand-edited T004's task definition because no command existed for it (disclosed by name in M004's amended AC014 — history preserved, not rewritten), and T006 had to be cancelled rather than have its `relevant_files` corrected when its true blast radius surfaced. Until M005's validated task-amendment command (with the `context_files`/`write_scope` split) lands, a task definition changes only by cancel-and-replace through existing commands, never by hand-edit.

## 17. Open Questions Requiring Developer Decisions

All resolved by the developer on 2026-08-18:

1. **Stack**: approved — TypeScript strict / Node ≥ 20 / ESM / vitest / commander + yaml + zod as the only runtime deps.
2. **License**: MIT.
3. **Confirmation mechanics**: Claude may execute `milestone-confirm` itself, but only after explicit developer approval in the conversation; the developer is not required to type the command.
4. **`init` installs Claude integration by default**, with `--no-claude` opt-out.
5. **npm name**: target unscoped `pitway`; re-check registry availability immediately before publishing.

---

# Bootstrap → Self-Hosted Transition (decisions 13–14)

**Phase 1 — complete.** M001–M003 were executed under the manual PitWay protocol: milestone/contract/task artifacts hand-authored in `.pitway/` following schema v1 exactly, manual commits carrying PitWay trailers, TDD and atomic-commit rules from the first commit.

**Transition criterion — satisfied 2026-08-18.** After M003, `pitway resume` correctly reported M001–M003 from the hand-authored state; M004 was then created, confirmed, executed, verified, and completed through PitWay commands (baseline `c3bff98` → completion `5a99528`, all trailers written by PitWay itself).

Completed milestone record (historical evidence — preserved, not rewritten to match later architecture):

| Milestone | Delivered | Mode |
|---|---|---|
| M001 | Project scaffold + state layer: schema v1 types, load/save/validate `.pitway/`, task & milestone state machines | manual |
| M002 | Git module (safety check, trailer commits, baseline) + read commands: `milestone-status`, `milestone-list`, `task-status` (incl. `--context`), `resume` | manual |
| M003 | Mutation commands: `init`, `milestone-add`, `milestone-confirm`, `task-update` (atomic completion commits) | manual |
| M004 | `verify` (3 CT types + approval hash), `milestone-complete`, `usage-add` + honest aggregation, dependent auto-promotion + resume continuation priority, requirement-store refactor, CLI reachability (all 11 commands on the single entry point). Slugged directories (AC012/AC013) removed by disclosed amendment and deferred; T006 cancelled via `task-update`. | self-hosted* |
| M005 | Resumable git-invisible runtime journal (checkpoint-eligible entries + markers, self-healing recovery); PitWay-expected vs. unexpected dirty-path classification; `context_files`/`write_scope` schema split (5-case combination rule); checkpoint-model revision (`usage-add`/`milestone-confirm --amend` journal-record-then-materialize, no commit of their own); `task-amend` (validated task-definition amendments, cumulative chaining); `write-ms-artifacts` (non-authoritative draft output); slugged milestone directories effective M006 onward (M001–M005 grandfathered bare); migration verification; roadmap reconciliation (T009). Built and completed entirely under the pre-existing M004 checkpoint mechanics — the model it delivers becomes authoritative starting with M006's own lifecycle, not retroactively true of M005's own history. | self-hosted |

\* **Self-hosting caveat (M004 AC014, disclosed):** M004 crossed the self-hosting boundary — created, confirmed, executed, verified, and completed through pitway commands — with **one disclosed exception**: commit `179491c` directly hand-edited T004's task definition in `tasks.yaml` because no supported task-amendment command existed. M004 is recorded as a self-hosting-boundary crossing with one disclosed manual task-definition amendment, not as fully self-hosted end-to-end. The gap is closed by M005's amendment command.

---

# Revised Roadmap (2026-08-19 — M005 and M006 delivered; M007 onward still proposed)

M005 and M006 were drafted, confirmed, executed, and verified against this roadmap (M006's `milestone-complete` pending as of this task); M007 onward remain proposed, confirmed one at a time as before. Sequencing principles (validated by delivery, not just proposed): the runtime journal (M005) existed before the interactive auto-run authorization that lives in it (M006, `auto-run` + `interactive-ux.md`, M006/T005); slug support (M005) existed before the first slugged directory (M006's own `M006-verification-hardening-claude`). The sequential MVP is still to be validated (M007) and released (M008) before branch/worktree parallelism is layered on top (M009–M010), each release increment gated by its own dogfood pass (M007 gates M008; M011 gates the parallelism increment).

- **M005 — Workflow checkpoint semantics and hardening.** (Bare directory, grandfathered — slug support does not exist when M005 is created.) Scope: the revised Git checkpoint model — exactly three committed checkpoint kinds (milestone started/confirmed; task completed; milestone completed or cancelled). Task-transition writes (`ready`/`in_progress`/`review`, retries) and verification-result writes stay exactly as they are today — ordinary uncommitted `.pitway/` state-file writes that already fold into whatever commits next, no new machinery needed. What genuinely changes: usage recording and contract amendments — today's two standalone/ancillary-commit paths — plus the new task-amendment operation, are recorded through a **resumable, git-invisible runtime journal**, never as their own commit; this revises M004's AC008 ancillary usage-recording commits and standalone `milestone-confirm --amend` commits going forward — **M004's historical AC008 behavior and its actual commits are unchanged; it does not rewrite M004.** **M005 itself is the transition milestone: it is built and completed under the existing M004 checkpoint mechanics throughout its own task-completion commits — this model only becomes usable partway through M005 once the relevant task lands, and is authoritative starting with M006's own lifecycle, not retroactively true of M005's own earlier history.**

  **Task and contract amendments, corrected (2026-08-19 — the M005 scope originally drafted here said the amendment command "commits the amended artifacts itself," which contradicted the journal model in the same paragraph; that was wrong and is replaced by this):** an amendment (task-definition or contract) is validated and requires explicit developer approval, then recorded **durably in the runtime journal** — never as a standalone Git commit — carrying: an operation identity (so re-entry is idempotent/resumable), the approved hash it produced (contract amendments) or the validated field diff (task amendments), and Change-Log evidence. The journal entry must **survive process/session interruption** (it is durable local state, written before the operation is considered applied). **Every approved amendment is folded into the next checkpoint of any kind — normally the next task-completion checkpoint, otherwise the milestone terminal checkpoint** — never creating a commit of its own, and never depending on whether a task happened to already be in progress when the amendment occurred. On resume, if journal recovery is ambiguous (multiple candidate un-checkpointed amendments, or the approved hash/field diff cannot be reconstructed from the journal plus the last checkpoint), **execution blocks** and reports the ambiguity rather than guessing. No direct `tasks.yaml`/`contract.md` hand-edits, ever — including contract amendments: since a direct edit of `contract.md` is now itself prohibited, `milestone-confirm --amend` gains a **supported amendment-input path** (a validated draft file, or structured field changes passed as command input) rather than depending on an untracked hand-edit of authoritative state; developer approval and hash re-approval remain mandatory regardless of which input form is used.

  Also in scope: expected-PitWay-dirty vs unexpected-user-dirty working-tree classification; split of task `relevant_files` into **`context_files`** (files a worker may read) and hard-but-amendable **`write_scope`** (files a worker may create/modify — drives the dirty-subset check and completion staging), both additive-optional schema-v1 fields, with the complete field-combination rule table: **`relevant_files` only** — legacy behavior, unchanged (readable and writable). **`write_scope` only** — unrestricted task-relevant reads, bounded writes (`context_files` unset means no read restriction, `write_scope` is still the write/completion boundary). **`context_files` + `write_scope` together** — bounded reads *and* bounded writes; every path in `write_scope` must also appear in `context_files` (a task can never write somewhere it wasn't allowed to read) — a `write_scope` path absent from `context_files` is rejected at validation, naming the offending path. **`context_files` only** — rejected as incomplete: declaring readable paths without ever declaring the write boundary leaves completion staging undefined, so this combination fails validation rather than silently falling back to unrestricted writes. **`relevant_files` together with either `context_files` or `write_scope`** — rejected as ambiguous, naming the conflicting fields, never silently preferred. No task ever carries both an old-style and new-style scope declaration, and no task ever ends up with reads narrower than its writes. `write-ms-artifacts` (or equivalent) draft-artifact command supporting a "write artifacts only" confirmation path; **slugged-directory implementation** (derived once from the title, bare id canonical everywhere, resolution in the state store only, exactly-one-candidate rule, M001–M005 grandfathered bare — first slugged directory is M006's); a **roadmap-reconciliation task** verifying this plan against reality with tests; migration/compatibility rules keeping all M001–M004 history valid. Acceptance boundary: no interactive UI, no Claude asset changes, full suite green, existing history resolvable unchanged.
- **M006 — Verification hardening, Claude integration, and context efficiency.** (First slugged directory: `M006-verification-hardening-claude`; `M006` remains the sole canonical id — the slug is presentation/navigation metadata.) Delivered, in dependency order: **verification-execution hardening landed first** (T001-T002, §11) — a confirmed M005 defect (no per-check timeout, an unguarded recursion path), closed before anything else in this milestone relied on `pitway verify` staying safe. Then installable Claude assets + driver protocol (§9, T003); dependency-aware sequential dispatch with **one authoritative bounded bundle per task attempt** via `task-status <id> --context --json`, passed with a fixed wrapper — no driver re-planning, no duplicated per-task `PLAN.md` files, and an honestly-scoped claim: PitWay bounds only the *supplied* bundle, never a subagent's total context, and builds no runtime read-enforcement (§8); separation of main-driver instructions (`protocol-driver.md`) from bounded-worker instructions (`protocol-worker.md`); concise, capped worker reports (T003, `task-update`'s result-field cap); targeted tests during implementation with one full-suite run at the final gate; **arrow-key decision UX** (T005) owned entirely by the integration layer via the same milestone-approval/task-continuation prompts originally proposed, with auto-run authorization now a real, agent-agnostic CLI command (`auto-run enable|disable|status`, §7) rather than something the integration layer writes to state directly — invalidated on a hash change or a later contract/task amendment (both computed from the journal's own order) plus a set of live checks (unexpected dirty files, a verification failure needing a decision including a flaky-pass-after-timeout, missing manual/review evidence, ambiguity, a permission requirement, a merge conflict, a destructive action) that Core cannot precompute; **LSP usage delivered as pure driver guidance, not PitWay code** (`lsp-guidance.md`) — PitWay has no LSP detection/integration code of its own and does not manage a driver's tool availability; **measurable context-efficiency evidence** against the M004/M005 baseline (`docs/evidence/M006-context-efficiency.md`, T004), recorded honestly rather than favorably: raw per-task token cost went up, per-AC-of-contract-delivered cost went down, and a real, previously-unknown bundle-duplication defect was found and quantified (not fixed in M006 — carried forward). Acceptance boundary held: Core and the CLI stayed structured and non-interactive throughout.
- **M007 — Core workflow dogfood validation** (sequential MVP surface): fresh-session reconstruction, API-interrupted sub-agent resume, task-amendment behavior, Git traceability audit, context efficiency, honest usage evidence. The **Adaptive Workflow Intensity** decision point follows this milestone.
- **M008 — README, packaging, and release readiness.** First public release of the validated sequential MVP. Also closes the M004/T007 finding: Node's native TS loader does not remap this repo's `.js` import specifiers to `.ts` sources, so the real `pitway` bin requires the build step this milestone introduces.
- **M009 — Milestone Git branch isolation** (per the §15 design sketch): `main | milestone` branch strategy, persisted base branch + base revision, branch-mismatch detection on resume, range-bounded trailer lookup, merge/PR-ready completion — never an automatic merge, force-push, branch switch, or deletion.
- **M010 — Parallel task worktrees and deterministic integration:** only tasks proven independent by the dependency graph with non-overlapping `write_scope` run concurrently; one temporary worktree + task branch per dispatched task; workers never share a writable worktree and never touch authoritative milestone state or merge/rebase/push; each returns a verified result + commit SHA; the main driver integrates in deterministic order, stopping on conflict or scope overlap; explicit cleanup policy; QA may run in a read-only or dedicated worktree.
- **M011 — Extended dogfood validation + release increment:** recovery, parallelism, branch/worktree behavior, and context efficiency under the expanded surface; gates the branch/worktree release increment.

Milestones remain proposed-and-confirmed one at a time through the normal contract flow; later boundaries may be re-cut at each milestone boundary as evidence accumulates.

---

**Status (updated M006/T006):** M005 completed 2026-08-19 (`milestone-complete M005`). M006's contract was confirmed the same day; T001–T006 are complete as of this task, pending `milestone-complete M006`. Two out-of-scope defects were found and fixed as narrowly-scoped standalone hotfixes during M006's own execution (no `PitWay-Milestone`/`PitWay-Task` trailer, outside any task's declared scope, both RED-then-GREEN verified): `fix(workflow): honor write_scope during task completion` (an M005 integration gap — task completion staging never read the new `write_scope` field) and `fix(workflow): recognize managed Claude assets at baseline` (an M006/M002 interaction gap — baseline git safety never knew about `init`-managed repository assets outside `.pitway/`). Full details, evidence, and additional M007-carried-forward findings (a bundle-duplication defect, right-sized dispatch, task-specific Claude skills) are recorded in `.git/pitway/m006-report-notes.md`, to be assembled into a committed report at milestone completion, matching the M005 precedent. **Next step:** run `pitway milestone-complete M006`, then draft Milestone M007's contract and task graph per the Revised Roadmap above, present the complete contract for developer approval, and confirm through `pitway milestone-confirm` — no implementation before that confirmation.
