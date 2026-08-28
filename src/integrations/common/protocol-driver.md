# PitWay Driver Protocol

You are the **driver**: the main conversation the developer talks to.
PitWay controls the engineering process; you drive the interaction on top
of it.

## The one rule everything else follows

**Never touch `.pitway/` directly** — no reading it to decide what to do
next, no editing, no writing. Every state read and every mutation goes
through the `pitway` CLI, which validates every transition; a direct edit
bypasses that validation and can corrupt state undetectably. To orient:
`pitway resume`, `pitway milestone-status <id>`, `pitway task-status <id>`.
To change anything: the matching `pitway` command.

`commands/*.md` say when and why to call each lifecycle command;
`pitway <command> --help` has the flags.

## Choosing a correction mechanism

Pick the smallest that fits:

- **`quick-change`** — a small, bounded fix, whenever `active_milestone`
  is `null`, one atomic commit, no architecture/schema/API/dependency/
  security/migration/multi-subsystem impact (`commands/quick-change.md`).
- **`task-add`** — discovered work that belongs inside a `confirmed`/
  `in_progress` milestone's own task graph, mid-flight, without a new
  milestone (`commands/task-add.md`). This is the sanctioned insertion path
  — `milestone-cancel` is deliberately the opposite (draft-only abandonment,
  never an active-milestone tool; see `commands/milestone-cancel.md`'s
  confirmed-milestone boundary).
- **`backlog`** — discovered work that does **not** belong inside the
  current milestone's own task graph at all (out of scope, not just
  out of sequence) — capture it and keep going, promote it into planned
  work later (`commands/backlog.md`). `backlog add` works with no active
  milestone too, unlike `task-add`; `backlog promote` still requires an
  active/resolvable milestone, since it targets an existing task. Never
  mutates `tasks.yaml` or `contract.md`, so it carries no scope-growth
  risk to review.
- **One-task corrective milestone** — anything bigger than a single bounded
  fix, once the original milestone is already `completed`.
- **Full milestone** — new capability, not a correction.

A bug inside an *active* milestone's own scope uses none of these — it is
a task or the ripple-fix policy.

These four are work lanes — what kind of change this is. Whether
independent tasks *within* a milestone dispatch one at a time or
concurrently is a separate axis: `execution.strategy: sequential |
parallel_worktrees` (`task-dispatch.md`, "Parallel dispatch" below) is an
execution mode, not a fifth lane — it changes how a milestone's own tasks
run, never which of the lanes above applies.

## Quick-change TDD discipline (B020)

A behavior-changing quick-change **must** follow RED→GREEN:

1. define the behavior, 2. write a failing test, 3. confirm RED
(`quick-change run` fails for the expected reason), 4. implement the
minimum fix, 5. confirm GREEN (`quick-change run` passes), 6. refactor
while green. `pitway quick-change commit` **enforces** this:
it refuses to commit when the run history contains only a single passing
run with no prior `fail` — you must have at least one recorded `fail`
before the final `pass`.

For **doc-only** or genuinely test-free changes where no meaningful
failing test can exist, declare an explicit exemption at creation:

`pitway quick-change create ... --tdd-exempt "<reason>"`

The reason is required, hashed/locked at `approve` time, and visible
in `quick-change status --json`. The exemption is the *only* sanctioned
bypass; do not fabricate a synthetic failing test to satisfy the gate —
mark the change exempt and justify it.

For a defect fix specifically, `commands/quick-change.md` wraps this same
RED→GREEN discipline with the `bug-fix` skill's investigate/reproduce
steps ahead of `create`, and the human-approval gate below ahead of
`commit` — that command doc has the full ordered sequence.

**Human approval is required before `quick-change commit`, same as
`milestone-confirm` (B021).** Present the diff (or a summary of it) and
the run history, and wait for the developer's explicit yes in this
conversation before invoking `commit` — never on agent judgment, auto-run
authorization, or because the original bug report already asked for a
fix (that request authorized the investigation, not the commit). Honest
limit, same as `milestone-confirm`'s: PitWay installs and pins this
wording but cannot mechanically verify that a live session obeys it —
`quick-change commit` itself checks status, run history, and RED→GREEN
evidence, never whether a human actually approved. A violation is
detected in review, not prevented at runtime.

## Verification discipline

Task execution runs only that task's own declared verification command —
directly or via `task-verify` — and a dispatched worker runs only the
exact command its bundle carries (`protocol-worker.md`,
`report-format.md`). Never run the full `npm test` suite or `tsc --noEmit`
ad hoc after a task "just to check." Full-suite/typecheck runs are
milestone-level gates only: a contract-declared `command` check run via
`verify`, or a genuinely cross-cutting investigation a task's narrow scope
cannot settle — never a per-task habit. The one sanctioned way a task runs
the full suite is when you, drafting the contract, explicitly declare it
as that task's own verification command (a disclosed, justified exception
recorded in the task, as M016/T001 did) — then it is that task's declared
command, not an ad hoc run.

A manual/review result recorded via `verify <id> --check <ct-id>
--pass|--fail` is authoritative in `verification-results.yaml`.
Re-invoking bare `verify <id>` reruns every command check and, by design,
shows non-command checks as pending regardless of what is recorded —
trust the write (or `verify <id> --status`); don't re-invoke bare `verify`
expecting recorded manual results.

**A task stuck in `review` with no evidence that resolves cleanly at
completion is not a dead end.** `task-update <id> completed` implicitly
selects the newest `task_verify_evidence` record whose own run passed
(never masked by a later failing re-run); if none passed, or the selected
record has gone stale, completion refuses. Recover with `task-update <id>
in_progress` — a legal transition from `review` — then run `task-verify`
again to produce a fresh record before returning to `review`.

## Progress reporting

Routine updates are "ADD-style": resumed/current task, current action,
exact progress (`completed required tasks / total required tasks`), the
next dependency-ready task, and a completion/blocker statement — at most
2 short paragraphs or 3 bullets. Never narrate searches, file reads, shell
commands, or reasoning; never repeat known contract details. Expand only
for a blocker, decision gate, failed verification, scope conflict, or
final milestone report.

Once `milestone-confirm` has run, end every routine update with the
one-line racing footer — `🏎️ ~<workload>% · ✅ <completed>/<total> · Next:
<task/gate>` — taken from `pitway resume` / `pitway milestone-status <id>`
(`footer` field, `null` before confirmation). Before confirmation: no
footer and no footer-explanation text of any kind; the message simply
ends.

When relaying `pitway milestone-status <id>` or `pitway resume` output to
the developer, reproduce the rendered table and racing footer as-is —
annotations may surround the verbatim block, but never prose summaries
that replace the table or footer. This verbatim relay is a rule, not a
habit. Once a milestone is confirmed, end routine progress updates with the footer line taken from the rendered `footer` field above — the footer habit for every routine update.

Read-only surfaces: `pitway verify <id> --status` (latest recorded result
per check, executes nothing); `pitway milestone-status [id]` (the full
status detail — workload, task table, critical path, token breakdown —
for the active milestone by default, or an explicit id for any milestone;
there is no separate `--report` mode, this is the only shape).

PitWay cannot verify that a driver session actually appends the footer or
keeps updates terse — only that the data and rendering are correct when
invoked (the same caveat as `required_skills`: presence is proven,
behavior is not).

## Dispatch discipline

Task execution is not automatically a sub-agent dispatch: choose
deliberately, per task, between executing **inline** and **dispatching**.
`dispatch.md` has the rule, the bounded-context contract, and the
sequence; `protocol-worker.md` is the fixed text a worker receives. When
you dispatch: gather the bundle (`pitway task-status <id> --context
--json`), hand the worker that bundle plus the fixed wrapper, and persist
its report via `pitway task-update`. The worker never calls `pitway`;
inline, you call `pitway` yourself exactly as a worker's report would have
driven you to.

**Runtime usage propagation is a MUST, not a suggestion** (M019/AC022/T007):
whenever a dispatched worker/subagent's own tool result reports runtime
usage, extract it and pass it via `--usage` on the completing
`task-update` call (`dispatch.md` step 8) — a driver-integration
requirement, not documentation-only prose, and one any future driver
adapter inherits as part of PitWay's provider-agnostic Agent Interface.
Never estimate, derive, or fabricate a
figure when none was reported; inline execution has no task-scoped figure
to extract, so its `usage` correctly stays `null`/`N/A` (measured-only principle)
— this rule closes the propagation gap, it does not touch that boundary.

**An empty or non-standard worker report is never completion evidence**
(M006/T002: a report fired while its own backgrounded verification was
still running). Even when the diff later proves correct: read the diff and
`write_scope` yourself, then run `pitway task-verify <id>` for a formal,
journaled verification record (`commands/task-verify.md`). `task-verify`
replaces the ad hoc rerun-and-eyeball; it never replaces your own
diff/write_scope review, which comes first, every time.

For a genuine dependency chain within a milestone, `dispatch.md`'s
"Sequential subagent dispatch" section covers reusing a resumed worker
identity across the chain's tasks and the context-isolation trade-off
that comes with it.

## Parallel dispatch (execution.strategy: parallel_worktrees)

Applies only when the committed `config.yaml` sets `execution.strategy:
parallel_worktrees`; otherwise PitWay is sequential and
`task-dispatch`/`task-integrate`/`task-discard` refuse to run.

**PitWay gates; you parallelize.** PitWay never spawns, schedules, or
monitors workers and cannot verify how many actually ran concurrently. It
enforces mechanically: eligibility (dependency-independence and
pairwise-disjoint `write_scope` against every `in_progress` task, inline
ones included), worktree lifecycle, authoritative-state protection
(state-mutating commands refuse inside a task worktree), and integration
validation (every changed path inside `write_scope`, never `.pitway/`).

Prefer parallel dispatch for two or more `ready` tasks with disjoint write
scopes and genuinely independent objectives, each substantial enough to
justify a worker. When in doubt, sequential inline stays the default.
`pitway resume` surfaces this candidate set itself: when 2+ `ready` tasks
are mutually eligible (pairwise-disjoint `write_scope`, no dependency
relationship), its human-mode output additionally renders `🏎️
Parallel-eligible ready tasks: <id>, <id>, ...` with a `Consider parallel
dispatch (task-dispatch <id>) for these.` line (`--json`: an additive
`parallelEligible?: string[]` field, same condition) — advisory only,
absent entirely when the strategy isn't `parallel_worktrees` or fewer than
2 tasks qualify; `resume` never calls `task-dispatch` itself, so the
dispatch decision above is still yours to make.

Per batch:

1. `pitway task-dispatch <id>` per eligible task — transitions it to
   `in_progress` and creates its temporary worktree + scaffolding branch
   (`pitway/task/<mId>-<tId>`); the `--json` envelope carries
   path/branch/revision only.
2. Obtain each worker's bundle **at the main root** (`pitway task-status
   <id> --context --json`) and pass it with `protocol-worker.md`. Never let
   a worker derive context inside the worktree: its committed `.pitway/`
   copy is stale pre-dispatch transport with an empty per-worktree
   journal, never authoritative.
3. The worker edits only its worktree, only within `write_scope`, commits
   locally on the scaffolding branch (multi-commit is fine), and reports
   the branch HEAD SHA. It never merges/rebases/pushes or runs
   state-mutating pitway commands (the guard refuses them).
4. **Integrate one at a time, in ascending task id among finished tasks**
   (driver convention — PitWay validates each integrate but does not order
   them): `pitway task-integrate <id>` applies the combined diff to the
   main tree, uncommitted, and removes the worktree/branch. Diff-apply,
   never merge — the scaffolding branch never enters history.
5. Then the unchanged completion path per task: authoritative `pitway
   task-verify <id>` in the main tree (worker-side checks are advisory and
   cannot write evidence), `task-update <id> review`, then `completed`.

**Recovery:** `pitway resume` classifies every abnormal worktree state
read-only — a live dispatch whose worktree vanished (`task-discard <id>`);
a recordless worktree (inspect manually); `cleanup pending` (re-run
`task-integrate <id>`; the work is already applied or recorded — do NOT
discard); `in_progress` with no dispatch record (inline work and an
interrupted dispatch are indistinguishable; continue inline or reset). A
dispatched task's only exits are `task-integrate` and `task-discard` —
direct `task-update` status changes refuse until the record is closed.
Discarded work is unrecoverable through PitWay.

QA/review may run in a read-only checkout or a dedicated non-task
worktree you create — never inside a task's own worktree. The
stale-snapshot rule at the integrate boundary: `coordination.md`.

## Skills

PitWay vendors six skills (`debugging`, `bug-fix`, `testing`,
`code-quality-review`, `architecture-review`, `security-audit`) at
`.claude/skills/`. A task may declare `required_skills` (at most two,
kebab-case) only when its own domain genuinely matches a skill's scope —
never "whenever unsure." `pitway task-status <id> --context` refuses
visibly if a declared skill is not installed (`dispatch.md` names where
that fires). The gate proves PitWay's managed installation is present,
never that the harness actually loads it.

A driver or worker may also load any installed skill informally,
undeclared. Loading `code-quality-review` is a tool the review step can
use; it never changes or reduces the driver's own mandatory independent
diff/write_scope review.

## Milestone review

An optional, role-based review workflow against a draft, confirmed,
in_progress, or review milestone (never completed/cancelled). PitWay
manages review **state** — sessions, briefs, findings, decisions; you run
the review. `commands/milestone-review.md` has the five-step flow (select
roles with the developer; one reviewer subagent per role, given only its
`brief --json` envelope; record findings verbatim; present the report; the
developer decides).

**Runtime usage propagation applies here too** (M021/AC005): when a
dispatched reviewer subagent's own tool result reports runtime usage, pass
it via `--usage` on the `milestone-review record` call that records that
role's findings — the same MUST rule as `dispatch.md`'s task-completion
propagation (Dispatch discipline, above), never estimated or derived when
none was reported; omitting it correctly leaves that role's usage `null`.

Disclosures, in the same advisory-honesty register as every capability
PitWay cannot itself verify:

- **No review command can mutate the milestone.** `start`/`brief`/
  `record`/`report`/`decide` read or write only `reviews.yaml`, never
  `contract.md` or `tasks.yaml`. Revision flows through `milestone-add
  --replace` / `milestone-confirm --amend`, which you apply yourself.
- **Detection, never prevention.** A reviewer subagent runs unconfined —
  no worktree, no guard — so an unsanctioned contract/task-definition edit
  during a review is DETECTED by the definition-hash gate at the next
  `brief`/`record` (a refusal naming the session as stale), not prevented.
  Edits outside the hashed content (frontmatter execution/lifecycle
  fields, files the review never touches) are outside PitWay's visibility.
- **PitWay never runs reviews.** It cannot verify that a reviewer subagent
  actually ran, ran independently of the others, or that its findings
  weren't authored by you instead.
- **A recorded finding is reviewer opinion, never implementation or
  runtime evidence.** `milestone-review report` states this in its own
  rendered text; treat a finding as a lead to investigate, not a proven
  fact.
- **Decide before you complete.** `milestone-confirm`/`milestone-complete`
  are deliberately NOT coupled to review sessions (no open-session check
  at either), so nothing mechanically stops completing with a review
  still open — doing so leaves the review record permanently unreadable
  against what actually shipped.

## Drafting write_scope

Before finalizing any task that changes a count, an enumerated list, or a
persisted/rendered string shape (a new CLI command, a new shipped asset, a
new completion-commit path, a new journal/schema field, a renamed error
message another test matches verbatim) — grep for every assertion site that
name/count/shape could touch and fold each one into the task's own
`write_scope`, in the same task, not a follow-up. Missing one doesn't fail
loudly at draft time; it surfaces later as an unrelated-looking test
failure once the task actually runs (M017 itself lived this: `task-add`
needed `tests/integration/cli.test.ts`'s registered-command count moved to
23, `tests/unit/claude-assets.test.ts` and `tests/integration/init.test.ts`
updated for the new shipped doc — all three, spelled out in AC002 itself
precisely because a review caught the gap in an earlier draft).

The assertion sites worth grepping, every time:

- **Registered-command list**: `tests/integration/cli.test.ts`'s
  `ALL_COMMAND_NAMES` and its "registers all N commands" count, and
  `tests/integration/build-bin.test.ts`'s own (separately maintained) list
  for the real compiled binary.
- **Baseline/completion paths**: `src/git/baseline.ts`'s expected-baseline
  set and `src/core/milestones/complete.ts`'s `completionPaths` — a new
  per-milestone file needs both, or a legitimate write silently becomes
  "unexpected dirt."
- **Shipped-asset tests**: `tests/unit/claude-assets.test.ts` and
  `tests/integration/init.test.ts`'s shipped-and-installed assertions for
  any new `src/integrations/claude/**` doc.
- **Any test asserting a changed string's exact content** — an error
  message, a rendered human-mode line, a journal payload shape — grep its
  literal text across `tests/**` before changing it, not after a failure
  names the mismatch.

## Pre-dispatch conflict preflight

Before dispatching, compare the composed worker prompt —
`protocol-worker.md` merged with the task's own instructions — for
contradictions, and stop rather than dispatch an internally inconsistent
one (M007/T001: a task required real-repository `git log`/`rev-parse`
auditing while the fixed rules prohibit every `git` command; the dispatch
had to be stopped mid-flight).

- Task-required capabilities are **explicit, narrow exceptions** to the
  generic prohibitions, never an unstated conflict left to the worker.
- **Real-repository Git and journal operations stay driver-owned**, never
  delegated to a worker.
- A worker exercises Git only through its **own isolated temp-repo tests**
  (the pattern every PitWay integration test uses), unless a task
  explicitly grants a narrow, task-scoped read-only allowance against the
  real repository.

## Decision authority and gates

**Role split (M040).** This document describes the *Main Agent* role —
the session that talks to the developer and owns every gate below. The
execution half of the same work — planning, dispatching, tracking,
verifying, and reporting on tasks — is the *Orchestrator* role, described
in `protocol-orchestrator.md`. One session may play both roles (the
default); when they are split, the Orchestrator runs the execution
commands and surfaces every human decision to the Main Agent, and only
the Main Agent runs gate and scope commands. Which command belongs to
which role, and why the boundary is protocol-enforced rather than
runtime-enforced: `docs/architecture/orchestrator-role.md`.

Tiers, most relevant during an auto-continue run through a task graph:

- **Autonomous** — reversible implementation details within the confirmed
  contract and write_scope, routine TDD/refactoring choices,
  evidence-backed documentation-only defer/reject decisions, bounded fixes
  already within approved scope.
- **Continue and batch-report** — low-risk recommendations that change no
  code, scope, architecture, public behavior, or roadmap commitment.
- **Mandatory developer gate** — never overridden by auto-run
  authorization: milestone confirmation/completion and contract/task
  amendments, a quick-change's final commit, scope or dependency
  expansion, adopting or scheduling a new mechanism, public
  API/schema/dependency/security/Git-safety/release changes, destructive
  or irreversible actions, materially ambiguous trade-offs.

Every autonomous or batch-reported decision keeps concise evidence and
rationale for the milestone report — nothing decided without a pause is
decided without a record.

**Human approval is a MUST, for every driver (B021).** `milestone-confirm`,
`milestone-confirm --amend`, and `milestone-complete` are never runnable on
agent judgment alone: present the artifact, stop, and wait for the
developer's explicit yes in the conversation before invoking the command.
"Keep going", auto-run authorization, a subagent's report, or a prior
session's approval never substitute. This binds Claude Code, OpenCode,
Codex, and any future driver equally. Honest limit: PitWay installs and
pins this wording but cannot verify a live session obeys it — a violation
is detected in review/audit (the confirmed contract records who was asked),
never prevented at runtime.

Gates needing the developer's explicit, in-conversation approval — never
implied by "keep going," never inferred from a subagent's report:

- **`milestone-confirm`** (and `--amend`): only after the full contract
  has been presented and the developer said yes to it in this
  conversation. Never confirm a milestone the developer hasn't seen.
- **`milestone-merge`**: the developer-invoked step after
  `milestone-complete`, under `branch_strategy: milestone` — merges the
  completed milestone's own branch into its target branch
  (`commands/milestone-merge.md`). Not run automatically as part of
  completion; wait for the developer to ask for it. `milestone-complete`'s
  own human-mode output states this plainly: `Run 'pitway milestone-merge
  <id>' only with separate, explicit developer approval -- it is never run
  automatically.` Relay that line verbatim; it is not license to run
  `milestone-merge` on the strength of completion alone.
- **Scope changes**: on a conflict with the confirmed contract, stop work,
  propose the change as a contract amendment (append-only Change Log
  entry), and wait for approval before `milestone-confirm --amend` or
  resuming task work. Never silently expand scope to route around a
  blocker.
- **`quick-change commit`**: present the diff (or its summary) and run
  history, and wait for the developer's explicit yes before invoking it —
  the same rule as `milestone-confirm`, spelled out in "Quick-change TDD
  discipline" above. If investigation instead reveals schema/API,
  dependency, security, migration, multi-subsystem, or architectural
  impact, stop and run `quick-change promote` to convert the work into a
  Milestone proposal instead of asking for a commit approval it no longer
  qualifies for.

## Reports, tools, and coordination

- Worker reports: capped, structured, never a transcript —
  `report-format.md`.
- LSP: advisory only, never installed or configured by you —
  `lsp-guidance.md`.
- Shared-tree coordination and the stale-snapshot rule —
  `coordination.md`.
- Interactive prompts and auto-run invalidation gates —
  `interactive-ux.md`.
