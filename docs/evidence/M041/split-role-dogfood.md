# M041 — Split-Role Dogfood Evidence

Milestone M041 (Orchestrator Protocol Adoption & Split-Role Dogfood) run with
the Main Agent and the Orchestrator as **two separate sessions**, each
following its protocol doc. First real test of whether protocol-only
enforcement of the M040 Decision 1 boundary is sufficient. Dates: 2026-08-27 →
2026-08-28.

## 1. Setup

| Item | Value |
|---|---|
| Main Agent | The developer-facing session (`protocol-driver.md`); owned every approval gate; relayed developer decisions. |
| Orchestrator | One persistent session for the whole milestone (M040 Decision 2), dispatched with `protocol-orchestrator.md`, `dispatch.md`, `report-format.md`, and the Decision 1 table (`docs/architecture/orchestrator-role.md`). Ran only `node dist/cli/index.js …` execution/read-only commands; never read or wrote `.pitway/`. |
| Workers | None dispatched — every task executed inline per `dispatch.md` (documentation, test, small-scope work). |
| Identity mode | Persistent per milestone; nothing carried in from a prior milestone. |
| Branch / baseline | `pitway/M041-orchestrator-protocol-adoption-split` / `6ed425c` |
| Briefing source | **Finding:** `.claude/protocol-orchestrator.md` was not installed in this repo (pre-existing configuration drift reported by `resume`; `init --reconfigure` is a Main Agent command and was not run). The Orchestrator was briefed from the shipped source `src/integrations/common/protocol-orchestrator.md` instead. |

## 2. Command log by role, checked against Decision 1

### Orchestrator (all execution or read-only)

| # | Command | Class |
|---|---|---|
| 1 | `git status --short`, `git branch --show-current` | read-only |
| 2 | `resume` | read-only |
| 3 | `milestone-status M041` | read-only |
| 4 | `task-update T001 in_progress` | execution |
| 5 | `task-status T001 --context --json` | read-only |
| 6 | (edits: 64 command docs, 32 manifest hashes) | — |
| 7 | `task-verify T001` → **refused**: "unrelated dirty changes present" (see §5-i) | execution |
| 8 | `npx vitest run …` (T001's own declared command, run directly) → 336 passed | — |
| 9 | `task-update T001 blocked` → decision surfaced to Main Agent (§3-a) | execution |
| — | *Main Agent: `task-amend T001`, `task-update T001 ready`* | |
| 10 | `resume` (restart re-orientation, §4-1) | read-only |
| 11 | `task-update T001 in_progress` (attempt 2) | execution |
| 12 | `task-verify T001` → pass, 336/0, evidence `tve-0cdd174e2e7c` | execution |
| 13 | `task-update T001 review` | execution |
| 14 | `task-update T001 completed --result … --message …` → commit `2a34294` | execution |
| 15 | `task-update T002 in_progress` | execution |
| 16 | `task-status T002 --context --json` | read-only |
| 17 | (edits: M041 test block; `npx vitest run tests/unit/claude-assets.test.ts` iterations; `tsc --noEmit`; three mutation checks each reverted with `git checkout -- src/integrations`, §5-ii) | — |
| — | *host sleep — Orchestrator restart (§4-2)* | |
| 18 | `resume` | read-only |
| 19 | `task-status T002 --context --json` | read-only |
| 20 | `task-verify T002` → pass, 205/0, evidence `tve-307a487d9134` | execution |
| 21 | `task-update T002 review` | execution |
| 22 | `task-update T002 completed --result … --message …` → commit `04c7569` | execution |
| 23 | `resume` → Next: T003 | read-only |
| 24 | `task-update T003 in_progress`; `task-status T003 --context --json`; this record; `task-update T003 review`; `task-update T003 completed` | execution / read-only |
| 25 | `task-update T004 in_progress`; `task-status T004 --context --json`; `task-verify T004`; `task-update T004 review`; `task-update T004 completed` | execution / read-only |

Every `task-update` carried `--driver claude-code --model claude-sonnet-5`;
no `--usage` was ever passed (inline execution, §6).

### Main Agent (all gate, scope, or read-only)

| # | Command | Class |
|---|---|---|
| 1 | `milestone-confirm M041` — after explicit developer approval in conversation | **gate** |
| 2 | `task-amend T001` — write_scope/context_files corrected to the 64 explicit doc paths + test file, developer-approved after the Orchestrator surfaced it | scope |
| 3 | `task-update T001 ready` — the `blocked → ready` recovery transition (Decision 1 lists `task-update` as Orchestrator-owned; see §5-v) | execution |
| 4 | `resume`, `milestone-status`, `git status` — re-orientation after the Orchestrator's host-sleep interruption | read-only |

**Check:** every Main Agent command except #3 was gate/scope/read-only; every
Orchestrator command was execution/read-only. #3 is `task-update`, a
command Decision 1 assigns to the Orchestrator; the Main Agent ran it as the
tail of its own approved amendment, while the Orchestrator was stopped and
waiting. Recorded as a finding (§5-v), not re-classified — the table is the
authority. No gate or scope command was run by the Orchestrator.

## 3. Human decisions surfaced through the Main Agent

| | Decision | Surfaced by | Outcome |
|---|---|---|---|
| a | T001's `write_scope` declared directories, which Core's exact-path matching cannot satisfy → amend needed | Orchestrator (after `task-verify` refusal), framed for the developer | **Approved**: `task-amend T001` |
| b | Task note said quick-change is "all Main Agent"; Decision 1 puts `quick-change status` in the either/read-only row. Orchestrator followed the table and flagged the divergence for veto | Orchestrator | **Accepted** as annotated |
| c | Offer to file the directory-form write_scope gap as a backlog item | Orchestrator | **Declined** for now |

None of these was decided by the Orchestrator; it stopped and waited each time.

## 4. Restarts

| | When | `pitway resume` alone sufficient? |
|---|---|---|
| 1 | After T001 `blocked` → Main Agent amend → `ready` | **Yes.** `resume` showed T001 Ready / Next: T001; the uncommitted edits were still in the tree and attempt 2 granted them expected-dirty status. |
| 2 | Host sleep mid-T002, after the test was written but before `task-verify` | **Yes for the next action** (`Continue: T002`, in_progress). The *content* of the in-flight work came from `git status`/`git diff` (+157 lines in the test file) — which PitWay never claims to hold; nothing PitWay needed lived only in Orchestrator context (Decision 2 recovery invariant held). |

## 5. Protocol gaps and findings

- **(i) Directory-form `write_scope` is accepted at `milestone-add` but unsatisfiable at execution.** `assertDirtySubset` (`src/core/tasks/verify.ts`, `update.ts`) and `checkWriteScope` use exact-path Set membership; a directory entry never matches files under it. Cost: one `blocked`, one developer-approved `task-amend`, one restart. Not filed as backlog (§3-c).
- **(ii) Orchestrator working-tree git operations are unregulated.** The Orchestrator ran `git checkout -- src/integrations` three times to revert its own mutation-check experiments on T002 (each mutation was made and reverted before any `pitway` command; `.pitway/` untouched). No rule in `protocol-orchestrator.md` forbids this for the Orchestrator, whereas `protocol-worker.md` forbids workers git operations. Gap: should `protocol-orchestrator.md` adopt the worker's git-free rule, or explicitly permit self-reverting experiments confined to the task's write scope? Left for the Main Agent/developer.
- **(iii) `protocol-orchestrator.md` not installed here** (drift; §1). Adoption in a real repo depends on `init --reconfigure` having been run — the shipped-source workaround worked but is not what a fresh Orchestrator session would find.
- **(iv) Decision 1 table nit:** the Orchestrator row names `milestone-review start/brief/record/report` without the `ms-review` alias (the `decide` row names both). T002's test folds `ms-*` onto its canonical, so it tolerates this; a one-word table fix would make the record self-consistent.
- **(v) `blocked → ready` transition ownership.** After a developer-approved amend, the `task-update <id> ready` step was run by the Main Agent (the session holding the conversation), not the Orchestrator (which was stopped). Decision 1 assigns `task-update` wholesale to the Orchestrator. Either the protocol should state that the Orchestrator re-runs this transition on resume, or the table should carve out recovery transitions. Recorded as a finding, not a re-classification.

## 6. Usage (M040 Decision 3 buckets)

| Bucket | Figure | Source |
|---|---|---|
| Orchestrator | Readings observed, semantics undetermined: 72,821 (after the T001 block) and 94,451 (after T002), two of five readings the Main Agent received for this one dispatched identity (72,821 → 94,451 → 107,369 → 110,481 → 109,766 — the last one decreased). Not additive segments; no session total statable. | Runtime-reported per dispatch/resume notification (`subagent_tokens`), relayed by the Main Agent |
| Main Agent | N/A | Not reported by the harness |
| Worker | none (no dispatches) | — |
| Auxiliary | N/A | — |

These are Orchestrator-bucket *readings* with **no PitWay field able to
hold them today**: `task.usage` is per task (one reading spans two tasks)
and `usage-add` accepts only planning/qa. They were deliberately **not**
passed as `--usage` on any `task-update` — splitting them per task would be
estimation. *Corrected by M043/T004 per the M042 telemetry spike*
(`docs/evidence/M042/synthesis.md` §6, `claude.md` §(c)): this row
originally joined the two readings with `+`; the spike's semantics probe
showed the Claude `subagent_tokens` figure is neither cumulative nor
per-segment (a later reading decreased), so the readings must not be
summed and no Orchestrator-session total exists. Concrete input for M040
Decision 4 / the usage-schema migration: an Orchestrator-session bucket of
readings with a semantics label, never a total.

## 7. Sufficiency verdict on protocol-only enforcement

- Zero boundary violations by the Orchestrator across 25+ commands, two
  restarts, and three surfaced decisions: no gate/scope command run, no
  `.pitway/` access, no decision taken unilaterally.
- The one blocker (§5-i) was a contract-authoring defect, not a role breach;
  Core's runtime checks caught it exactly where designed.
- The git-checkout finding (§5-ii) and the `ready` transition (§5-v) are
  **rule gaps** in the protocol text, not breaches of any stated rule.
- Recovery invariant held: `resume` alone yielded the correct next action on
  both restarts.

**Recommendation:** runtime role checks are **not warranted on this
evidence** — one run, no violations, and both findings are fixable in
protocol text (M042 lifecycle follow-up: §5-ii, §5-v; M045 docs alignment:
§5-iii, §5-iv). Revisit if a future run shows a protocol-enforced rule being
crossed rather than merely under-specified.

Commits: `2a34294` (T001), `04c7569` (T002). Verification evidence:
`tve-0cdd174e2e7c` (T001), `tve-307a487d9134` (T002).
