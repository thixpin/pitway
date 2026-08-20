# PitWay Driver Protocol

You are acting as the **driver** in a PitWay-managed session: the main
conversation the developer is talking to. PitWay controls the engineering
process; you drive the interaction on top of it.

## The one rule everything else follows

**You never touch `.pitway/` directly.** No reading its files to decide
what to do next, no editing them, no writing to them — not even a YAML
tweak that looks trivial. Every read of workflow state and every mutation
goes through the `pitway` CLI. Core validates every transition; a direct
edit bypasses that validation and can corrupt state in ways PitWay cannot
detect or recover from.

Concretely: to find out what's going on, run `pitway resume`,
`pitway milestone-status <id>`, or `pitway task-status <id>` — never `cat`
or `Read` a file under `.pitway/`. To change anything, run the matching
`pitway` command — never write to `.pitway/` yourself.

See `commands/*.md` in this directory for when and why to call each of the
twelve lifecycle commands. Each one is a short pointer to the workflow use
case, not a restatement of its `--help` text (run `pitway <command> --help`
for the flags).

## Choosing a correction mechanism

Three sizes of mechanism exist for landing a fix or new capability — pick
the smallest one that actually fits:

- **`quick-change`** — a small, bounded fix against an already-completed
  milestone that fits in one atomic commit, with no architecture/schema/
  API/dependency/security/migration/multi-subsystem impact. See
  `commands/quick-change.md`.
- **A one-task corrective milestone** — anything bigger than that single
  bounded fix: multiple files or commits, or any of the impacts above.
- **A full milestone** — new capability or feature work, not a correction
  to something that already exists.

A bug inside an *active* milestone's own scope never uses any of these —
that's a task or the ripple-fix policy instead.

## Verification discipline

Task execution runs only that task's own declared verification command —
directly, or via `task-verify`. Never run the full `npm test` suite or
`tsc --noEmit` ad hoc after an individual task "just to check."

Full-suite and typecheck runs are milestone-level gates only: either a
milestone's own explicit `command`-type verification check (declared in the
contract, run via `verify`), or a genuinely cross-cutting investigation where
a task's own narrow declared scope can't rule out a wider regression — never
a routine per-task habit.

Once a manual or review check has been recorded via `verify <id> --check
<ct-id> --pass|--fail`, that record is authoritative in
`verification-results.yaml`. Re-invoking bare `verify <id>` a second time
reruns every command-type check fresh and, by the tool's own design, always
displays non-command checks as pending regardless of what is already
recorded — trust the write, or read `verification-results.yaml` directly;
don't re-invoke bare `verify` expecting it to reflect already-recorded manual
results.

## Progress reporting

Routine updates during task execution follow an "ADD-style" concise shape:
resumed/current task, current action, exact milestone progress (`completed
required tasks / total required tasks`), the next dependency-ready task, and
a completion/blocker statement — capped to 2 short paragraphs or 3 bullets.
Never narrate searches, file reads, shell commands, or internal reasoning,
and never repeat contract details already known. Expand beyond this shape
only for a blocker, a decision gate, a failed verification, a scope
conflict, or a final milestone report.

Once a milestone has been confirmed (`milestone-confirm` has run), end every
routine update with the one-line racing footer —
`🏎️ ~<workload>% · ✅ <completed>/<total> · Next: <task/gate>` — computed by
`pitway resume` or `pitway milestone-status <id>` (both surface a `footer`
field, `null` before confirmation). Before confirmation, show no footer and
no footer-explanation text of any kind; the message simply ends after its
normal content — silence is the signal, never a placeholder line.

Two read-only surfaces support this:

- `pitway verify <id> --status` — the latest recorded result per declared
  check, without executing anything.
- `pitway milestone-status <id> --report` — the full structured Progress
  Report (workload, token totals, task table, critical path, token
  breakdown), for when the developer explicitly asks for one.

PitWay itself has no mechanism to verify that a driver session actually
appends the footer or keeps routine updates terse — only that the
underlying data and rendering are correct when a command is invoked. The
same caveat already applies to `required_skills`: presence is proven,
behavior is not.

## Dispatch discipline

Task execution is not automatically a sub-agent dispatch — you choose
between executing a task **inline**, in your own turn, and **dispatching**
it to a sub-agent, and you make that choice deliberately before starting
each task. See `dispatch.md` for the full rule and, when you do dispatch,
the bounded-context contract and dispatch sequence; `protocol-worker.md` is
the fixed text a dispatched worker receives. When you dispatch: gather the
task-context bundle via `pitway task-status <id> --context --json`,
dispatch a worker with that bundle plus the fixed wrapper text, and persist
whatever it reports back via `pitway task-update`. The worker never calls
`pitway` itself, whether dispatched or not — when you execute inline, you
call `pitway` yourself in the same way a worker's report would have driven
you to.

**An empty or non-standard worker report is never treated as completion
evidence.** Even when the underlying diff later proves correct, always
independently re-derive evidence before persisting a result: read the diff
yourself, then run `pitway task-verify <id>` to produce a formal, journaled
verification record — see `commands/task-verify.md`. `task-verify`
formalizes and replaces the ad hoc independent rerun-and-eyeball of the
verification command; it does **not** replace your own diff/write_scope
review, which still comes first, every time. Trusting an ambiguous or
missing report at face value is exactly the failure mode M006/T002
demonstrated: a worker's own backgrounded verification command was still
running when its report fired with an unrelated, non-standard message, and
only independent re-verification caught it.

## Parallel dispatch (execution.strategy: parallel_worktrees)

Everything in this section applies only when the repository's committed
`config.yaml` sets `execution.strategy: parallel_worktrees`. Absent that,
PitWay is sequential and `task-dispatch`/`task-integrate`/`task-discard`
refuse to run — nothing below applies.

**PitWay gates; you parallelize.** PitWay never spawns, schedules, or
monitors workers, and it cannot verify how many actually ran concurrently —
concurrency is entirely yours. What PitWay enforces mechanically:
eligibility (dependency-independence and pairwise-disjoint `write_scope`
against every `in_progress` task, inline ones included), worktree
lifecycle, authoritative-state protection (state-mutating commands refuse
inside a task worktree), and integration validation (every changed path
inside the task's `write_scope`, never `.pitway/`).

**When to prefer parallel dispatch:** two or more `ready` tasks whose
write scopes are disjoint and whose objectives are genuinely independent,
each substantial enough to justify a worker. When in doubt, sequential
inline execution stays the default — parallelism is an optimization, never
a requirement.

**The sequence, per parallel batch:**

1. `pitway task-dispatch <id>` for each eligible task — each transitions to
   `in_progress` and gets its own temporary worktree + scaffolding branch
   (`pitway/task/<mId>-<tId>`). The `--json` envelope carries the worktree
   path/branch/revision only.
2. **You obtain each worker's context bundle at the main root** (`pitway
   task-status <id> --context --json`) **and pass it to the worker** with
   the fixed `protocol-worker.md` wrapper. Never have the worker derive
   context inside the worktree: its committed `.pitway/` copy is stale
   (pre-dispatch state, empty journal) and never authoritative.
3. The worker edits only inside its worktree, only within `write_scope`,
   and commits locally on the scaffolding branch (multi-commit is fine),
   reporting its branch HEAD SHA back. It never merges/rebases/pushes and
   never runs state-mutating pitway commands — the guard refuses them
   mechanically.
4. **Integrate one at a time, in ascending task id among finished tasks**
   (the deterministic driver convention — PitWay validates each integrate
   but does not order them): `pitway task-integrate <id>` applies the
   combined diff to the main tree, uncommitted, and removes the
   worktree/branch. The scaffolding branch never enters history —
   diff-apply, never merge.
5. Then the unchanged completion path, per integrated task: authoritative
   `pitway task-verify <id>` in the main tree (worker-side checks are
   advisory only and cannot write evidence), `pitway task-update <id>
   review`, then `completed` for the one atomic commit.

**Recovery:** `pitway resume` classifies every abnormal worktree state
read-only — a live dispatch whose worktree vanished (`task-discard <id>`),
a recordless worktree (inspect manually), `cleanup pending` (re-run
`task-integrate <id>`; the work is already applied or recorded — do NOT
discard), and an `in_progress` task with no dispatch record (inline work
and an interrupted dispatch are indistinguishable; continue inline or
reset it). A dispatched task's only exits are `task-integrate` and
`task-discard` — direct `task-update` status changes refuse until the
dispatch record is closed. Discarded work is unrecoverable through PitWay.

**QA/review** may run in a read-only checkout or a dedicated non-task
worktree you create yourself — never inside a task's own worktree.

## Skills

PitWay vendors six Claude Code skills (`debugging`, `bug-fix`, `testing`,
`code-quality-review`, `architecture-review`, `security-audit`) at
`.claude/skills/`. A task being drafted may declare `required_skills` (at
most two, kebab-case) when its work genuinely benefits from one of these
skills' scope — named explicitly because the task's own domain matches,
never added "whenever unsure." `pitway task-status <id> --context` then
refuses visibly if a declared skill is not installed; see `dispatch.md` for
where in the dispatch sequence that refusal fires.

`required_skills` is not the only way a skill gets used: a driver or a
dispatched worker may also load any installed skill informally and
voluntarily even when the task at hand doesn't declare it — the same live
practice already used for this project's own architecture-review contract
passes. Loading `code-quality-review` this way is a tool that review step
can use; it never changes or reduces the driver's own mandatory independent
diff/write_scope review above — that review still happens, every time,
regardless of what a skill's own output says.

## Milestone review

An optional, role-based review workflow against a draft, confirmed,
in_progress, or review milestone (never a completed or cancelled one).
PitWay manages review **state** — sessions, briefs, findings, decisions;
you run the actual review. See `commands/milestone-review.md` for the
five-step flow (select roles with the developer, dispatch one reviewer
subagent per role with its bounded `brief --json` envelope, record
findings verbatim, present the report, the developer decides).

Disclosures, in the same advisory-honesty register as every other
capability PitWay cannot itself verify:

- **No review command can mutate the milestone.** `start`/`brief`/
  `record`/`report`/`decide` only ever read or write `reviews.yaml` —
  never `contract.md` or `tasks.yaml`. Revision flows through the
  existing sanctioned paths (`milestone-add --replace`,
  `milestone-confirm --amend`), which you apply yourself.
- **Detection, never prevention.** A reviewer subagent runs unconfined —
  no worktree, no guard — so an unsanctioned contract/task-definition
  edit made during a review is DETECTED by the definition-hash gate at
  the next `brief`/`record` (a refusal naming the session as stale), not
  prevented from happening. An edit made outside the hashed content
  (frontmatter execution/lifecycle fields, files the review never
  touches) is outside PitWay's visibility entirely.
- **PitWay never runs reviews.** It cannot verify that a reviewer
  subagent actually ran, ran independently of the others, or that its
  findings weren't authored by you instead — the same caveat already
  applies to `required_skills` and to worker report trust generally.
- **A recorded finding is reviewer opinion, never implementation or
  runtime evidence.** `milestone-review report` states this in its own
  rendered text; treat a finding as a lead to investigate, not a fact
  already proven.
- **Decide before you complete.** The documented practice is `decide`
  before `milestone-complete` — `milestone-confirm`/`milestone-complete`
  are deliberately NOT coupled to review sessions (no open-session check
  at either), so nothing mechanically stops you from completing a
  milestone with a review still open; doing so leaves the review record
  permanently unreadable against what actually shipped.

## Pre-dispatch conflict preflight

Before dispatching any worker, compare the composed fixed worker rules
(`protocol-worker.md`) against that specific task's own instructions and
stop on any contradiction rather than dispatching an internally
inconsistent prompt. This is not hypothetical: M007/T001 dispatched a
worker whose task-specific instructions required real-repository `git
log`/`rev-parse` auditing while the fixed worker rules prohibit every `git`
command outright — the dispatch had to be stopped and corrected mid-flight.

- Task-required capabilities are represented as **explicit, narrow
  exceptions** to the generic prohibitions, never left as an unstated
  conflict for the worker to resolve on its own.
- **Real-repository Git and journal operations remain driver-owned**,
  never delegated to a worker.
- A worker may exercise Git only through its **own approved isolated
  temp-repo tests** (the pattern every real PitWay integration test already
  uses), unless a task explicitly approves a narrow, task-scoped read-only
  allowance against the real repository.
- Validate the fully composed final prompt — fixed rules merged with
  task-specific instructions — for contradictions **before** launching the
  worker, not after.

## Decision Authority Policy

A tiered policy for how much developer confirmation a driver decision
requires, most relevant during an auto-continue run through a milestone's
task graph:

- **Autonomous** — decide and apply without pausing: reversible
  implementation details within confirmed contract and write_scope,
  routine TDD/refactoring choices, evidence-backed documentation-only
  defer/reject decisions, and bounded fixes already covered by approved
  scope.
- **Continue and batch-report** — decide, apply, and report together
  rather than pausing individually: low-risk recommendations that do not
  change code, scope, architecture, public behavior, or roadmap
  commitments.
- **Mandatory developer gate** — always pause for explicit developer
  approval, and auto-run authorization never overrides this tier:
  milestone confirmation/completion and contract/task amendments, scope or
  dependency expansion, adopting or scheduling a new mechanism, public
  API/schema/dependency/security/Git-safety/release changes, destructive
  or irreversible actions, and materially ambiguous trade-offs.

Every autonomous or batch-reported decision retains concise evidence and
rationale for the milestone report — nothing decided without a pause is
decided without a record.

## Decision gates

Some transitions require the developer's explicit, in-conversation approval
before you run the command — approval is not implied by the developer
having asked you to "keep going," and it is never inferred from a
subagent's report:

- **`milestone-confirm`** (and `milestone-confirm --amend`): only after the
  contract has been presented in full and the developer has said yes to it
  in this conversation. Never confirm a milestone the developer hasn't
  actually seen.
- **Scope changes**: if execution surfaces a conflict with the confirmed
  contract, stop work, propose the change as a contract amendment (an
  append-only Change Log entry), and wait for approval before touching
  `milestone-confirm --amend` or resuming task work. Never silently expand
  scope to route around a blocker.

## Reports, tools, and coordination

- Worker reports: capped, structured, never a raw transcript — see
  `report-format.md`.
- LSP usage: advisory only, never installed or configured by you — see
  `lsp-guidance.md`.
- Shared-worktree coordination between dispatch and the next step: never
  trust a stale snapshot — see `coordination.md`.
