# M042/T004 — Synthesis: what the three drivers actually report

Sources, and nothing else: `claude.md` (T001, this Claude Code session),
`opencode.md` (T002, a real OpenCode 1.18.25 session), `codex.md` (T003, a
real Codex session). Baseline constraint:
`docs/evidence/M009/token-accounting-feasibility.md`. Bucket vocabulary:
M040 Decision 3. Every cell below cites the driver record; nothing is
summed, split, estimated, or inferred across sessions.

## 1. Drivers × E0–E6

| Join | Claude | OpenCode | Codex |
|---|---|---|---|
| **E0** four token dimensions | **not validated exactly** — one dimension (`subagent_tokens`) on the notification surface (claude.md "Fields present") | **not validated exactly** — six (`input`, `output`, `total`, `reasoning`, `cache.read`, `cache.write`) in `step_finish.part.tokens` (opencode.md "Fields present") | **not validated** — zero agent/model dimensions; only command-result `original_token_count` (codex.md §"Fields and dimensions") |
| **E1** main / subagent / auxiliary partition | **partially exercised**: main nothing, subagent reported per notification, auxiliary nothing (claude.md "Attribution and partition") — three buckets distinct, two of them empty | **validated exactly** — main 9799/9962, subagent 8547/8955 on its own session, auxiliary nothing; parent totals exclude worker totals (opencode.md §(b), §(e), E1 row) | **not validated** — identities for all three exercised, none reported usage (codex.md E1 row) |
| **E2** inline cost / overhead are PitWay-derived | **validated exactly** — inline main cost is not reported; overhead not computed (claude.md "Labels") | **not validated (revised)** — inline main-session cost *is* directly reported (`step_finish` 9799); only the overhead delta would be derived (opencode.md E2 row) | **validated exactly** — neither reported, neither derived (codex.md E2 row) |
| **E3** per-instance attribution needs beta traces | **not validated (revised)** — stable `task-id` identical across dispatch + two resumes, on the stable surface (claude.md "Attribution") | **not validated (revised)** — stable `sessionID` / `callID` / `parentSessionId` in every envelope (opencode.md "Per-instance attribution result") | **not validated** — stable `Sender` identity present but no usage to attach (codex.md §3) |
| **E4** multi-session totals are partial, never exact | **validated exactly** — the only figure is non-additive (probe 30201→30513→29319), main and auxiliary have none (claude.md §(c)) | **validated exactly** — per-turn only; no cumulative figure exists; auxiliary has none (opencode.md E4 row) | **not validated** — nothing to accumulate (codex.md E4 row) |
| **E5** OpenTelemetry cost/benefit | not exercisable (not enabled) | not exercisable (not enabled) | not exercisable (not enabled) |
| **E6** four rejected approaches still rejected | not exercised — nothing observed revises the rejection | **validated exactly** — structured envelope makes scraping/parsing unnecessary; SDK inversion untouched (opencode.md E6 row) | not exercisable — approaches prohibited, not tested (codex.md E6 row) |

**M009 rule applied:** a Usage Accounting milestone proceeds only if every
exercisable join is validated exactly. It is not: E0 fails on all three
drivers, E2 is revised on OpenCode, E3 is revised on Claude and OpenCode,
and E1/E4 fail on Codex. **The M009 limitation stands** — with two of its
conclusions revised in the *other* direction (see §8): attribution is
easier than M009 assumed on two drivers, while the dimension set is less
uniform than M009 assumed on all three.

## 2. Dimensions (E0)

| Driver | Token dimensions actually observed |
|---|---|
| Claude | `subagent_tokens` (one, undifferentiated) |
| OpenCode | `input`, `output`, `total` (per-turn only), `reasoning`, `cache.read`, `cache.write` |
| Codex | none for agent/model usage (`original_token_count` is command-output metadata) |

**No common set of four exists.** The "four supported dimensions" claim is
driver-specific at best and does not describe any driver observed here: one
reports one, one reports six, one reports zero. Any schema field beyond a
single opaque count would be populated on OpenCode alone.

## 3. Partition (E1)

| Driver | main | subagent | auxiliary |
|---|---|---|---|
| Claude | nothing reported | reported (notification) | nothing reported |
| OpenCode | reported (`step_finish`) | reported (own session envelope) | nothing reported |
| Codex | nothing reported | nothing reported | not exercisable |

Auxiliary produced a figure on no driver; there is nothing to fold, and no
record folded anything.

## 4. Per-instance attribution (E3)

| Driver | Stable identifier observed | Attributable without inference? |
|---|---|---|
| Claude | notification `task-id`, identical across three readings of one agent | **yes** — to the instance; the reading's meaning is the open question |
| OpenCode | `sessionID` / `callID` / `parentSessionId`, preserved across `--session` resume | **yes** |
| Codex | `Sender` / `task_name`, stable across readings | identity yes, **usage not claimable** — no figure exists |

Revises M009's "requires beta traces": on Claude and OpenCode a stable
per-instance identifier is on the stable surface. M009's conclusion holds
only in the sense that Codex still has nothing to attribute.

## 5. Decision 3 buckets — populatable only from a directly reported figure

| Bucket | Claude | OpenCode | Codex |
|---|---|---|---|
| Main | **unavailable** — nothing reported | **populatable** — `step_finish.part.tokens` of the main session (e.g. `{"total":9799,"input":2223,…}`), per turn | **unavailable** |
| Orchestrator (separate session) | **populatable as readings only** — the dispatched Orchestrator's notification `subagent_tokens` (M041: 72,821 … 109,766), semantics undeterminable; no total | **populatable** — the dispatched session's own `step_finish` (e.g. worker `{"total":8955,…}`), per turn, keyed by `sessionID`; no total | **unavailable** — separate identity reported nothing |
| Orchestrator (fused with Main) | empty, not estimated | empty, not estimated | empty, not estimated |
| Worker | **populatable as readings only** — same surface as above (e.g. `<subagent_tokens>30201</subagent_tokens>`) | **populatable** — per-turn `step_finish`; reviewer indistinguishable from worker | **unavailable** |
| Auxiliary | **unavailable** | **unavailable** | **unavailable** |

Every "populatable" cell quotes a figure the runtime reported for that
session without arithmetic. No cell is populated by subtraction, splitting,
or summing; no milestone total or percentage is derivable on any driver.

## 6. Semantics ruling and M041 §6 restatement

- **Claude:** `subagent_tokens` is neither cumulative nor per-segment
  (30,201 → 30,513 → 29,319 across dispatch, one-tool resume, zero-tool
  resume; `tool_uses` cumulative, `duration_ms` monotone). **Undeterminable**
  from the stable surface.
- **OpenCode:** `step_finish.part.tokens` is **per turn** (total 9799 →
  9962 while input 2223 → 1443; worker turns 8547/8955 → 9764/9918/10083
  never approach a 2× cumulative). Do not sum across turns.
- **Codex:** no figure; nothing to rule on.

**M041 §6, restated:** the Orchestrator row's "72,821 tokens (segment 1) +
94,451 tokens (segment 2)" is not supportable. The Main Agent received five
readings for that one dispatched identity — 72,821, 94,451, 107,369,
110,481, 109,766 — and the last one decreased. They are five readings of a
figure whose semantics the Claude surface does not state; they are not
segments and must not be added. The correct row is: *Orchestrator —
readings observed (undetermined semantics); no session total statable.* The
Main Agent, Worker, and Auxiliary rows of §6 stand as written.

## 7. Derived values (E2)

| Value | Status on every driver |
|---|---|
| Orchestration overhead (Main-vs-Orchestrator delta) | PitWay-derived and conditional — would require subtraction between sessions; **not computed** |
| Inline task cost | Claude/Codex: unavailable; OpenCode: **directly measured per turn** (revises M009's E2 for that driver); never mixed with the derived rows |
| Any cumulative or milestone total | unavailable on all three — no driver reports one |

## 8. Rejected approaches (E6)

| Approach | Verdict |
|---|---|
| Transcript parsing | remains rejected — OpenCode shows a structured envelope makes it unnecessary; Claude/Codex offered no new evidence |
| TUI scraping | remains rejected — UI displays were unreadable on all three; nothing observed changes the fragility argument |
| Snapshot accumulation | remains rejected — per-turn (OpenCode) and non-monotone (Claude) figures would make diffed snapshots meaningless |
| Agent SDK inversion | remains rejected — architectural boundary, untouched; OpenCode reports fully without it |

## 9. What the usage-schema migration may and may not add

**May add (measured on ≥1 driver, additive-optional, null elsewhere):**
- `bucket` — Main / Orchestrator / Worker / Auxiliary, set by the driver
  from which session produced the reading (all three drivers expose a
  stable identity; only two expose a figure to attach to it).
- A single opaque per-reading count — populated from Claude's
  `subagent_tokens` or OpenCode's `total`, stored **as a reading, never
  accumulated**, with its semantics label (`per-turn` for OpenCode,
  `undetermined` for Claude).
- `input`, `output`, `reasoning`, `cache.read`, `cache.write` — populated
  on OpenCode only; null on Claude and Codex.
- `model` and `provider` — populated on OpenCode only (`modelID` /
  `providerID` in the envelope); null elsewhere (Claude's notification
  carries neither).
- A raw provider-usage object preserved verbatim — OpenCode's
  `part.tokens`; Claude's `<usage>` element as text; absent on Codex.
- An evidence-only per-instance identifier (`task-id` / `sessionID` /
  `Sender`), never read by resume or trailers.

**Must not add:**
- Any session, milestone, or bucket **total** — no driver reports one, and
  the only figures are per-turn or non-additive.
- Any **percentage** or Main/Orchestrator ratio.
- A Main Agent figure on Claude or Codex, or any Auxiliary figure anywhere.
- Any field populated from Codex's `original_token_count` — it is
  command-output metadata with no session attribution.
- Any per-task split of a multi-task reading (the M041 case).
- A "four dimensions" schema presented as driver-neutral.

## 10. Honesty floor — gaps

- E5 (OpenTelemetry) was not exercised on any driver.
- E6 was actively exercised on OpenCode only.
- Claude's `subagent_tokens` semantics remain unknown; the per-turn
  context-size hypothesis was not tested.
- Codex's separate Orchestrator identity was exercised, but with no usage
  surface the Main-vs-Orchestrator question is moot there, not answered.
- Auxiliary sessions were represented by a background process (Claude) and
  by absence (OpenCode, Codex); no harness-internal auxiliary session was
  directly observed on any driver.
- All three runs used one model each; nothing here speaks to other models
  or provider configurations.
