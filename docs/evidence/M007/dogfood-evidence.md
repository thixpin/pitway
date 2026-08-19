# M007 Dogfood Evidence

Compiled 2026-08-19, as part of T001. A committed, durable deliverable (not a draft) — M007's
own completion depends on it, matching M006/AC005's `docs/evidence/M006-context-efficiency.md`
precedent. Regression tests: `tests/integration/fresh-session-resume.test.ts`,
`tests/integration/git-traceability-audit.test.ts`.

## 1. Fresh-session state reconstruction

Covered by `tests/integration/fresh-session-resume.test.ts` (1/1 passing) — a regression test,
not only the 2026-08-18 historical demonstration. Every state-reading call in the test constructs
a brand-new `buildCli()` program and a brand-new `deps` object, sharing nothing with whatever call
created the state except the plain `root` path string — exactly what a real second process would
be handed as its cwd argument — proving `.pitway/` alone is sufficient to reconstruct correct
state, with no reliance on in-memory/session context.

## 2. M004/T007 sub-agent interruption outcomes

**Primary-source disclosure, not a confirmed claim.** M007's own contract (AC001) states this
milestone's dogfood evidence includes "API-interrupted sub-agent resume (attempted during
M004/T007; first interruption resumed cleanly via SendMessage to the same agent id, second
interruption was a hard session-limit stop requiring a different recovery approach)". A direct
search of this repository's own persisted record — `reports/M005.md` in full, every file under
`.git/pitway/` (`m005-report-notes.md`, `m006-report-notes.md`), and M004's own
`.pitway/milestones/M004/tasks.yaml` T007 result field — found **no primary-source detail beyond
the bare mention of "sub-agent interruption-resume" as a backlog item name** in `reports/M005.md`
§10. M004/T007's own persisted `result.summary` (the CLI-reachability task itself) says nothing
about an interruption. Per this task's own instruction to disclose rather than invent: **this
specific two-outcome narrative (SendMessage-resumed vs. hard-session-limit-stop) cannot be
independently verified from anything this repository durably records.** It may be accurate — it
likely originates from a prior conversation's own context — but nothing in Git history, `.pitway/`
state, or the local reports substantiates it as a checkable fact. Recorded here honestly as an
unverifiable claim, not silently repeated as established evidence.

## 3. M005 amendment audit — a real discrepancy found

Audited against the actual runtime journal (`git rev-parse --git-path pitway/journal.yaml`), not
assumed from the contract's own prose. M007's contract (AC001) claims M005 had "2 contract
amends, 2 task-amend calls, plus the T007 bootstrap repair." The real journal contains, for
`milestone: M005`:

| Entry | Type | Target |
|---|---|---|
| 1 | `contract_amendment` | (contract-level) |
| 2 | `task_amendment` | T007 |
| 3 | `task_amendment` | T007 |

**The task-amend count matches exactly (2, both against T007 — consistent with the T007 bootstrap
repair's two cumulative scope-widening amendments described in `reports/M005.md` §4 item 4).
The contract-amendment count does not: the journal shows exactly 1, not 2.** No second
`contract_amendment` entry exists anywhere in the journal for M005. This may mean the second
"contract amend" happened before M005's own journal mechanism existed (M005/T001 built the
journal mid-milestone, so nothing before that commit could have been journaled), or the "2
contract amends" figure in M007's contract is simply inaccurate. Recorded as a genuine, real
discrepancy the audit was designed to catch — not silently reconciled by editing M007's
already-confirmed contract text to match, and not silently accepted either.

All 3 entries resolve to real, checkpointed state: the `contract_amendment` entry's hash matches
M005's final `verification_approved_hash`; both `task_amendment` entries target T007, consistent
with the two scope-widening amendments (11 files, then 21 total) described in `reports/M005.md`
§4 item 4 and §11.6.

## 4. Git traceability audit

Covered by `tests/integration/git-traceability-audit.test.ts` (4/4 passing) — generic
trailer/classification logic, proven against synthetic history the test itself constructs, never
against this repository's own real commits (a deliberate correction: an earlier version of this
test hard-coded real SHAs, which is fragile under a shallow clone, a squashed/rewritten history, a
source archive, or a package install, none of which preserve arbitrary historical commit
identity). This repository's own **real** audit results, gathered read-only by the driver, not
asserted by the test suite:

**Standalone recovery/hotfix commits (no `PitWay-Milestone`/`PitWay-Task` trailer) — 7 total:**

| Milestone | SHA | Subject |
|---|---|---|
| M005 | `bc1a0bf` | fix(core): null-safe relevant_files fallback in task completion staging |
| M005 | `90bd7ca` | fix(test): adapt verify.test.ts's amend re-approval scenario to --file input |
| M005 | `69e16ca` | fix(core): amend materializes body-only changes, not just hash changes |
| M005 | `0b0438b` | fix(core): tolerate pending journal entries when starting a task |
| M006 | `81c99a2` | fix(workflow): honor write_scope during task completion |
| M006 | `1e07014` | fix(workflow): recognize managed Claude assets at baseline |
| M006 | `81a420a` | test(verification): isolate recursion guard environment |

**Between-milestone maintenance commit — 1, classified separately, never an eighth hotfix:**
`85fa243` (`chore: ignore local workflow reports`) — confirmed positioned strictly after M006's
completion commit (`392017a`) and strictly before M007's baseline commit (`aebb7df`); carries no
PitWay trailer for the same underlying reason as the 7 hotfixes (no supported PitWay-attributed
path existed for landing it any other way).

**Trailer coverage:** M005's baseline-to-completion range is 15 commits; 11 carry a
`PitWay-Milestone` trailer (9 task commits + baseline + completion), 4 do not (the hotfixes) —
73.3% trailered. M006's range is 11 commits; 8 trailered (6 task commits + baseline + completion),
3 not — 72.7% trailered. Every non-hotfix commit inside each range carries `PitWay-Milestone`;
every task commit (not a baseline/completion checkpoint) additionally carries `PitWay-Task`.

**Squash/rewrite exposure — a real, previously undocumented finding.** This repository has a
`backup/pre-rewrite-main` branch (5 commits) with **zero common ancestor** with `main` (confirmed
via `git merge-base main backup/pre-rewrite-main`, which returns nothing). Its 5 commits share the
exact same subjects, in the same order, as `main`'s own first 5 commits (`docs: add
implementation plan and project guidance`, `workflow: add milestone M001`, `chore: scaffold
TypeScript project with vitest and strict config`, `docs: make git commit convention
provider-agnostic`, `feat(state): add schema v1 zod validators and types`) but with entirely
different SHAs. This repository's earliest bootstrap history (before M001 fully landed) was fully
rewritten at some point, not merely squashed — a real, concrete instance of the trailer-lookup
robustness limitation IMPLEMENTATION_PLAN.md's decision-4 discussion already discloses
abstractly ("squash-merges and history rewrites can drop, merge, or duplicate trailer lines").
No documentation anywhere in this repository previously recorded this specific instance; recorded
here for the first time from direct inspection.

## 5. Context-efficiency before/after (against M006)

Not re-derived from scratch — cited directly from `docs/evidence/M006-context-efficiency.md`
(itself unedited, a historical snapshot dated to after M006/T001–T003, 18 files/20,304 bytes at
that point; the milestone's final asset tree is 20 files after T005 added `auto-run.md` and
`interactive-ux.md`, a discrepancy that document's own text already discloses). Headline figures:
M006's raw per-task average (≈150,572 tokens/task, T001–T003) was **higher** than M005's
(≈111,721 tokens/task) — stated plainly, not minimized. Per-AC-of-contract-delivered, M006 was
**lower** (≈64,531/AC vs ≈111,721/AC), because M006's task graph deliberately bundled more ACs
per dispatch. The M004/M005-vs-M006 comparison itself carries an explicit, still-unresolved
caveat: no record exists of whether the two measurements used the same model/config, so it is
presented as directional evidence only, not a controlled experiment.

## 6. CT012 flakiness — investigation and recommendation

M006's own disclosed finding (`reports/M006.md` §5): two bounded (180s) full `npm test` runs
after M006/T002's diff landed each **completed without hanging and left zero surviving
processes**, but **reported a different, small, non-T002-related transient failure set each run**
(run 1: 9 tests across 6 files including one false alarm inside `verify.test.ts` itself; run 2: 2
unrelated tests in `milestone-complete.test.ts`) — T002's own target files (`verify.test.ts`,
`schemas.test.ts`) were fully clean both times, and a targeted, bounded, foreground-only rerun was
82/82 green.

Further investigation available in bounded time this session: the two reported failing-test sets
share **no common file** between the two runs (6 distinct files in run 1, 1 distinct file in run
2, zero overlap) — inconsistent with a single deterministic bad interaction and more consistent
with load-sensitive scheduling/timing under concurrent subprocess load, though this is not proof.
This repository's `vitest.config.ts` (checked directly) does not currently set an explicit `pool`
or concurrency option — it runs under vitest's default pool behavior, unconfigured for the kind of
heavy real-subprocess load (`process-exec.ts`'s real timeout/kill fixtures,
`git-traceability-audit.test.ts`'s and other integration tests' real `execFileSync` git calls)
this milestone's own verification-hardening test suite specifically introduced.

### Recommendation

The cause was not isolated to a specific line or interaction in bounded time — it remains
**unproven**. Given (a) zero file overlap between the two observed failure sets, (b) both runs
completing cleanly with zero orphan processes, and (c) no explicit pool/concurrency tuning
currently configured despite a real increase in subprocess-heavy tests this milestone, my
recommendation is: **adopt a specific, low-risk vitest isolation change** — set `pool: 'forks'`
with a bounded `poolOptions.forks.maxForks` in `vitest.config.ts` to reduce cross-file subprocess
contention during the full-suite run — rather than deferring with the evidence merely stated as
unproven. This is a small, reversible configuration change, not a code change to any verification
mechanism, and if it does not resolve the flakiness on re-observation, no harm is done reverting
it. The alternative (defer, unproven, no config change) is equally defensible given the small
sample size (2 runs) — this is a genuine judgment call between "act on directional evidence" and
"gather more evidence before acting," not a case where one option is clearly correct.

**Decision:** Defer. The two transient runs are recorded as unproven evidence — the cause is not
established, and no `vitest.config.ts` change is made in this milestone. This is a deliberate
developer choice against the driver's own recommendation (adopt `pool: 'forks'`), made because the
2-run sample is small enough that a config change now risks masking, not fixing, the real
question. Revisit only after either reproducible failures accumulate, or a bounded, deliberate
default-vs-`pool:'forks'` comparison is run to test the hypothesis directly — not on directional
evidence alone.

## 7. Matched inline/sub-agent dispatch pair (real, measured — evidence for AC010)

A genuine, freshly constructed, matched-as-possible pair, executed by the driver as part of this
task, not designed-only and not fabricated:

- **Sub-agent side (real dispatch):** read `src/core/tasks/write-scope-check.ts` in full and
  summarize its purpose/key exports in ~4 sentences, as a standalone, read-only, single-file task.
  **Real measured usage: 31,890 tokens, 1 tool use, 6,901ms wall-clock.**
- **Inline side (driver, same session, same model):** read `src/core/tasks/context-bundle.ts` in
  full and summarize its purpose/key exports in ~4 sentences, done directly in the driver's own
  turn while compiling this document.

**Measurement limitation, disclosed rather than glossed over:** the inline side's token cost
cannot be isolated as a clean delta the same way a sub-agent's `usage.total_tokens` can — this is
the same structural limitation already disclosed for M005/T009 and M006/T004/T006 (`usage: null`,
"driver-executed, no separate measurement"). No inline number is fabricated here. What **is**
directly observable and real: the sub-agent side required a full dispatch (agent startup, a
context-establishing turn, one tool call, a return trip) for a task trivial enough that its own
target file is 33 lines long — **31,890 tokens is essentially pure dispatch overhead for a task
this small**, consistent with the M004/T005-measured "worker startup >30K tokens" baseline this
session already established. The inline side had zero dispatch/startup overhead and no separate
context bundle to generate or transmit. This is real, if partial, evidence for AC010's dispatch-
mode decision: for small, single-file, read-only, non-code-changing work, sub-agent dispatch cost
is dominated by fixed overhead, not task complexity — supporting (not proving on its own, given
n=1) the case for inline execution of comparably-scoped tasks.
