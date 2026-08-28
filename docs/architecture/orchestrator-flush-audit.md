# Orchestrator Flush Audit — what must be durable before a context is disposable

**Milestone:** M044/T001. **Question:** when an Orchestrator session
(M040 Decision 2: one identity per milestone, flushed at the milestone's
terminal state) loses or discards its working context, does every fact it
needs to continue or recover already live in durable PitWay state, and
which `pitway` command surfaces it? Sources: `src/state/journal.ts` (record
kinds), `src/state/store.ts` (state files), `src/core/views/resume.ts`,
`src/core/views/milestone-status.ts`, and M041's two real restarts
(`docs/evidence/M041/split-role-dogfood.md` §4).

Method: enumerate each fact the Orchestrator acts on; name its durable
home and its read-only surface; mark anything that has neither as a gap.
Nothing is fixed here.

## 1. Facts, durable homes, and surfaces

| # | Fact the Orchestrator needs | Durable home | Surfaced by | Status |
|---|---|---|---|---|
| 1 | Which milestone is active, its status, branch | `.pitway/state.yaml` (`active_milestone`), `contract.md` frontmatter (`status`, `base_branch`, `base_revision`) | `resume` (`activeMilestone`, `contractStatus`, `branch`), `milestone-status`, `milestone-current` | durable |
| 2 | Every task's status, `attempts`, `depends_on`, name | `tasks.yaml` | `resume` (`tasks`, `ready`, `waiting`, `blocked`, `inProgress`, `waitingDetails`, `blockedDetails`), `task-status <id>` | durable |
| 3 | The next task to act on | derived from `tasks.yaml` by `resolveNextTask` | `resume` (`nextTask` / `Continue:`), `milestone-status` (`Next:`) | durable (computed, never stored) |
| 4 | A task's full execution brief (objective, ACs, contract excerpt, dependency result summaries, `context_files`, `write_scope`, verification command, `required_skills`) | `tasks.yaml` + `contract.md` | `task-status <id> --context --json` | durable |
| 5 | Whether a task is currently dispatched to a worktree, its branch and path | journal `worktree_dispatch` / `worktree_integrate` / `worktree_discard` records (live = dispatch with no later integrate/discard) | `resume` (`parallel.activeDispatches`, `parallel.residues`), `task-dispatch`/`task-integrate` refusals | durable |
| 6 | Which ready tasks may be dispatched in parallel today | derived from `tasks.yaml` + `config.yaml` (`execution.strategy`) | `resume` (`parallelEligible`) | durable (computed) |
| 7 | A task's verification evidence (exit code, pass/fail counts, fingerprint, evidence id) | journal `task_verify_evidence` records | `task-update <id> completed` resolves it; `milestone-status` shows `· verified`; the id is printed by `task-verify` | durable |
| 8 | Pending state writes not yet checkpointed by a commit (usage-add, contract/task amendments, review recordings, backlog recordings) | journal `entry` records without a later `checkpoint` | `resume`/`task-update` classify their target files as expected dirt (`classifyDirtyPaths` via `resolvePendingJournalTargets`) | durable — but **not listed by name on any read-only surface** (see gap G1) |
| 9 | Milestone check results (which CTs passed/failed, evidence text) | `verification-results.yaml` | `verify <id> --status`, `milestone-status` footer (`Next: verification` / `developer approval`) | durable |
| 10 | A pending verification repair and its approved scope | `verification-repairs.yaml` (VR record) | `verification-repair commit/cancel` refusals name it | durable — **not on `resume`** (gap G2) |
| 11 | An open review session, its roles, recorded findings | `reviews.yaml` | `resume` (`openReview`), `milestone-review report` | durable |
| 12 | Pending backlog items (captured out-of-scope work) | `.pitway/backlog.yaml` (+ journal `backlog_add_unscoped` / `backlog_archive`) | `resume` (`pendingBacklogItems`), `backlog list` | durable |
| 13 | A pending quick-change (only when no milestone is active) | journal `quick_change` records | `resume` (`pendingQuickChanges`), `quick-change status` | durable |
| 14 | Auto-run authorization and whether it is still valid | journal `auto_run` records vs. contract hash / later amendments | `auto-run status` | durable |
| 15 | Which milestone commits already exist for a task (idempotent completion) | git history via `PitWay-Milestone:` / `PitWay-Task:` trailers | `task-update <id> completed` resolves it (`already-committed`) | durable (git) |
| 16 | The milestone's own branch and whether the tree is on it | git + `contract.md` (`base_branch`) | `resume` (`branch.expected/actual/matches`) | durable |
| 17 | Uncommitted work-in-progress files of an in-flight task | the working tree itself | `git status` / `git diff` — **not PitWay state** | out of scope by design: PitWay never claims to hold uncommitted work (M041 §4 restart 2 confirmed `resume` gives the next action; the *content* came from git) |
| 18 | Human decisions the Orchestrator has surfaced and is waiting on (an amendment proposal, a scope conflict, a merge request) | **none** — exists only in the Orchestrator's report to the Main Agent and the Main Agent's conversation | nothing | **gap G3** |
| 19 | The inline-vs-dispatch choice and rationale recorded per task (`dispatch.md`: "record the mode and a brief rationale before starting") | `tasks.yaml` `driver`/`model` (M029) record who ran it; execution mode is derived from journal `worktree_integrate` presence | `milestone-status` (`Execution` column: inline / worktree) | durable for *mode*; the *rationale* is not stored (accepted: it is narrative, not recovery input) |
| 20 | Runtime-reported usage for a dispatched worker / the Orchestrator's own readings | `tasks.yaml` `task.usage` (only if passed via `--usage` per task); Orchestrator-session readings have **no field** (M042 synthesis §9) | `milestone-status` token breakdown | not a recovery input; owned by the usage-schema migration draft, **not a gap for this audit** |
| 21 | Which role a session is playing | nowhere — protocol-only (M040 gate classification) | nothing | not a recovery input: a restarted session re-reads its brief; recorded as a known non-goal, not a gap |

## 2. Gaps

Three facts have no durable home or no read-only surface. None was
observed to break recovery in M041, but each is a place where a restarted
Orchestrator would have to rediscover state by trial (a refused command)
rather than by reading it.

- **G1 — pending journal entries are invisible on read-only surfaces.**
  Row 8: `usage-add`, `--amend`, `task-amend`, `milestone-review record`,
  and `backlog add` each append a journal entry whose target file stays
  dirty until the next checkpoint commit. `resume` silently tolerates that
  dirt but never *lists* the pending operations; a restarted Orchestrator
  seeing a dirty `tasks.yaml` cannot tell an approved amendment from stray
  edits without `git diff`. **Proposed durable home:** none needed — the
  journal already holds it. **Proposed surface:** an additive, read-only
  `resume` section/field (`pendingJournal: [{type, target, operationId}]`),
  absent when empty so existing `--json` output is byte-identical. Closing
  this is T005 material and requires a Change Log amendment (AC005).
- **G2 — a pending verification repair is not on `resume`.** Row 10: the
  VR record lives in `verification-repairs.yaml`, but only the
  `verification-repair` subcommands reveal it. After a restart at the
  repair step (the exact window M040/VR001 occupied), `resume` shows
  "Next: developer approval" with no hint that a VR is open. **Proposed
  surface:** same additive `resume` treatment (`pendingRepair: {id, files,
  checks}`), absent when none. Same T005 / amendment gate.
- **G3 — surfaced-but-undecided human decisions have no durable home.**
  Row 18: when the Orchestrator stops on a scope conflict and hands a
  decision to the Main Agent, the fact that a decision is pending exists
  only in conversation. M041's block/amend cycle recovered because the
  Orchestrator set the task `blocked` (a durable, resume-visible status)
  before stopping — i.e. the protocol already has a convention that works.
  **Proposed home:** no new state; make the convention a rule in
  `protocol-orchestrator.md` (T004): *before surfacing a decision, put the
  affected task into `blocked` (or leave the milestone at its current
  gate) so the pending decision is visible on `resume` as a blocked task
  with its recovery command.* This is a protocol-text fix, not a Core
  change, and needs no amendment.

## 3. What flushing therefore requires

An Orchestrator may discard its context after the milestone's terminal
state — and may also be restarted mid-milestone — provided that, at the
moment of the flush/restart, every action it has *taken* is reflected in
rows 1–16 (all durable today), and every decision it has *surfaced* is
reflected as a blocked task or an unmet gate (G3's convention). Nothing in
the Orchestrator's context is a recovery input; M041's two restarts
(post-block; host-sleep mid-task) re-oriented from `resume` alone, which
this table explains: rows 2, 3, 5, and 16 carried everything they needed.

## 4. Recommendation to T004/T005

- T004 (protocol text): add the G3 convention and the flush/restart rules
  from §3.
- T005 (conditional): propose the G1 + G2 additive `resume` fields as one
  Change Log amendment for the developer to approve or decline; if
  declined, cancel T005 and leave G1/G2 recorded here as known limitations.
