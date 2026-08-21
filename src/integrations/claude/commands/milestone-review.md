---
description: Role-based milestone review workflow (start/brief/record/report/decide)
argument-hint: <start|brief|record|report|decide> <id>
---

# milestone-review

A role-based review workflow: PitWay manages review **state** (sessions,
briefs, findings, decisions) — the driver runs the actual reviews. Usable
against a draft, confirmed, in_progress, or review milestone; never against
a completed or cancelled one.

Five steps, always in this order:

- **Select roles with the developer.** `milestone-review start <id>
  --roles <csv>` opens a session (or, with `--roles` omitted on a TTY,
  presents a numbered multi-select). Multi-select is the developer's
  choice — offer a combination that fits the milestone, but never impose
  one. Three example combinations, quoted as examples, never enforced
  presets:
  - Architecture/execution milestone → `developer,architect,devops`
  - Product/UX milestone → `developer,product,user`
  - Business-impacting milestone → `developer,architect,business`
- **Dispatch one reviewer subagent per selected role.** For each role,
  run `milestone-review brief <id> --role <role> --json` and pass ONLY
  that envelope to the dispatched reviewer — the same bounded-context
  discipline as a task dispatch's own bundle (`../dispatch.md`). A
  reviewer subagent runs unconfined (no worktree, no guard) and must
  never be asked to run `pitway` itself, edit the contract/tasks, or
  confirm anything — findings only.
- **Record each reviewer's findings verbatim.** `milestone-review record
  <id> --role <role> --file <yaml>` accepts the brief's own findings YAML
  shape. Normalizing a reviewer's raw output into that shape is fine;
  inventing or embellishing a finding the reviewer didn't actually report
  is not.
- **Present the report to the developer.** `milestone-review report <id>`
  renders every recorded role's findings (severity-ordered), pending
  roles, and mechanically grouped conflicts/overlaps — read this to the
  developer, don't reconcile it yourself.
- **The developer decides.** `milestone-review decide <id> --outcome
  accepted | revision_requested | rejected [--note <text>]` closes the
  session. `accepted`/`revision_requested` require every selected role
  recorded; `rejected` is the explicit path to abandon an unfinished or
  stale review. A `revision_requested` outcome names the two sanctioned
  revision paths (`milestone-add --replace` for a draft, `milestone-confirm
  --amend` for a confirmed milestone) — apply one, then reconcile the
  contract yourself; no review command ever writes `contract.md` or
  `tasks.yaml`.

**Staleness**: a session pins a content hash at `start`. If the
milestone's contract/task content is revised mid-review (a real
`task-amend`/`--replace`/`--amend` — never a task transition or
`milestone-confirm`'s own status promotion), `brief`/`record` refuse on
the stale session; `decide --outcome rejected` abandons it, then start a
fresh session.

**Honesty**: PitWay never runs a review, spawns a reviewer, or verifies
reviewer independence — it only enforces the state machine above. A
recorded finding is reviewer opinion-evidence, never proof that requires
implementation or runtime verification; reconciling findings is always
yours, never Core's. Decide before `milestone-complete` — a decided
session keeps the review record readable against what actually shipped.

See `../protocol-driver.md`'s "Milestone review" section for the honesty
disclosures this command's design rests on. Run `pitway milestone-review
--help` for flags.
