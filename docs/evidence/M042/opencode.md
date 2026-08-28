# M042/T002 — OpenCode driver: what the runtime reports, observed

Driver: OpenCode 1.18.25 (provider `opencode`, model `muse-spark-1.2-contributor-free` for all sessions as reported by harness metadata).
Date: 2026-08-29. Throwaway repo: `/var/folders/vj/vzc5sn6x0n5943_jx5s1_8680000gn/T/opencode/m042-opencode-scratch` (`git init`, `pitway init --opencode`, one committed `README.md`). This repository's `.pitway/` was not touched by any experiment. Every figure below is quoted from the harness as received; nothing is summed, split, or estimated. Provenance: `opencode run --format json` on that throwaway repo and `opencode export <sessionID>` for worker sessions.

## Where usage appears — the surface found

The **only** envelope where token counts reached the driving shell was the **`step_finish` event's `part.tokens` object** on the `opencode run --format json` stream, and the equivalent persisted form in `opencode export <sessionID>` (`info.tokens` and each assistant `message.info.tokens` / `part.tokens`). No token figure appeared on a dispatch launch result's tool-result field itself, no log line, no status line. A UI-only display (TUI) was not readable from the harness and is recorded as **unavailable**.

Not present on: the parent `tool_use` part for `tool: task` (the dispatch) — it carries only `state`, `metadata.parentSessionId/sessionId/model`, and `output` — see raw samples below. Auxiliary/background notifications do not exist on this driver.

## Samples by session shape

### (a) Inline task in the main session — reported on `step_finish`

Main session `ses_fb690f5deffe5dkamwZEpQX2cN` executed inline work (two consecutive `opencode run` invocations, first prompt `say hello world` then `--session` continuation `say hello again`). Both readings arrived as `step_finish` envelope keys on the same session's own stream.

Reading 1 — `opencode run --format json "say hello world"` verbatim `step_finish` line (single line preserved exactly as emitted):

```json
{"type":"step_finish","timestamp":1787938416465,"sessionID":"ses_fb690f5deffe5dkamwZEpQX2cN","part":{"id":"prt_0496f274e0015xPQ6T4W0FYrsK","reason":"stop","snapshot":"5885e976fa11390b4e13f4cd765cf51ab7e76c7e","messageID":"msg_0496f1766001Uq2DXSspSWp1ub","sessionID":"ses_fb690f5deffe5dkamwZEpQX2cN","type":"step-finish","tokens":{"total":9799,"input":2223,"output":12,"reasoning":27,"cache":{"write":0,"read":7537}},"cost":0}}
```

Reading 2 — same `sessionID` resumed via `opencode run --format json --session ses_fb690f5deffe5dkamwZEpQX2cN "say hello again"` verbatim `step_finish` line:

```json
{"type":"step_finish","timestamp":1787938432041,"sessionID":"ses_fb690f5deffe5dkamwZEpQX2cN","part":{"id":"prt_0496f6422001OLGcSp5kFsMxAV","reason":"stop","snapshot":"5885e976fa11390b4e13f4cd765cf51ab7e76c7e","messageID":"msg_0496f564f001jhfwALcDKNXBAt","sessionID":"ses_fb690f5deffe5dkamwZEpQX2cN","type":"step-finish","tokens":{"total":9962,"input":1443,"output":12,"reasoning":10,"cache":{"write":0,"read":8497}},"cost":0}}
```

Semantics probe on same main session (two consecutive `step_finish` readings):

| Reading | tokens.total | tokens.input | tokens.cache.read | Interpretation |
|---|---|---|---|---|
| 1 | 9799 | 2223 | 7537 | — |
| 2 | 9962 | 1443 | 8497 | total rose +163 while input fell −780; a cumulative total would be ~19k and monotonically non-decreasing in every field. The second reading is a fresh per-turn figure, not a cumulative sum. |

**Ruling for (a): per-turn (per `step_finish`)**, not cumulative, not per-segment. Do not sum.

### (b) Dispatched worker — NOT on parent tool result; reported on worker's own envelope

Parent session `ses_fb68f43cbffez3Xaw9gEKgxCaq` dispatched a general subagent via the `default.task` tool:

Prompt: `Create the file /var/.../m042-opencode-scratch/general.txt containing exactly: hello general`

Parent `tool_use` part verbatim — note **no `tokens` key anywhere** (complete line as emitted, truncated only after `metadata` for layout; raw file at `/tmp/opencode_general.json`):

```json
{"type":"tool_use","timestamp":1787938546542,"sessionID":"ses_fb68f43cbffez3Xaw9gEKgxCaq","part":{"type":"tool","tool":"task","callID":"call_01a04970ef8872f1a027dca783ccd9ea","state":{"status":"completed","input":{"description":"create file","prompt":"Create the file /var/folders/vj/vzc5sn6x0n5943_jx5s1_8680000gn/T/opencode/m042-opencode-scratch/general.txt containing exactly: hello general","subagent_type":"general","command":"create file general.txt"},"output":"<task id=\"ses_fb68f099affewgwx9iHa60K1ef\" state=\"completed\">\n<task_result>\nFile created at `/var/folders/vj/vzc5sn6x0n5943_jx5s1_8680000gn/T/opencode/m042-opencode-scratch/general.txt` containing exactly `hello general` (13 bytes, no trailing newline).\n</task_result>\n</task>","metadata":{"parentSessionId":"ses_fb68f43cbffez3Xaw9gEKgxCaq","sessionId":"ses_fb68f099affewgwx9iHa60K1ef","model":{"modelID":"muse-spark-1.2-contributor-free","providerID":"opencode"},"truncated":false},"title":"create file","time":{"start":1787938535017,"end":1787938546534}},"metadata":{"openai":{"itemId":"fc_01a04970ef8872f1a027dca783ccd9ea"}},"id":"prt_04970f11c001ljKRPbL8PUNalt","sessionID":"ses_fb68f43cbffez3Xaw9gEKgxCaq","messageID":"msg_04970c307001nUYXN3ZrA1KcWf"}}
```

Surface verdict for parent: **nothing reported on tool-result field / envelope key** for the dispatch. UI-only: **unavailable**.

Worker session `ses_fb68f099affewgwx9iHa60K1ef` (model `muse-spark-1.2-contributor-free`, provider `opencode`, parent `ses_fb68f43cbffez3Xaw9gEKgxCaq`) persisted its own usage, retrievable via `opencode export ses_fb68f099affewgwx9iHa60K1ef`. Verbatim samples from that export (exact objects as stored):

`info.tokens` (session-level aggregate as stored):

```json
"tokens": {"input": 8654, "output": 363, "reasoning": 70, "cache": {"read": 17171, "write": 0}}
```

One assistant message's `info.tokens` (first worker turn):

```json
{"cost":0,"tokens":{"total":8547,"input":8143,"output":117,"reasoning":46,"cache":{"write":0,"read":241}},"modelID":"muse-spark-1.2-contributor-free","providerID":"opencode","time":{"created":1787938535054,"completed":1787938538909}}
```

Corresponding `step_finish` part inside export for that same turn (verbatim `part.tokens`):

```json
{"reason":"stop","snapshot":"7bbb41ab325d39b50aa4f419444b818fc0071132","type":"step-finish","tokens":{"total":8955,"input":308,"output":65,"reasoning":21,"cache":{"write":0,"read":8561}},"cost":0,"id":"prt_049712318001Ya1iLlSlCmYG86","sessionID":"ses_fb68f099affewgwx9iHa60K1ef","messageID":"msg_049711711001FMaPs07qIBGAtW"}
```

Parent's own `step_finish` for the dispatch turn (`ses_fb68f43cbffez3Xaw9gEKgxCaq`) reported only parent's own tokens `{"total":10345,"input":9707,"output":162,"reasoning":299,"cache":{"write":0,"read":177}}` — not including worker's 8547/8955. The two sessions' figures are separate.

### (c) Same worker resumed for a second task — two further readings (semantics probe)

The same worker identity `ses_fb68f099affewgwx9iHa60K1ef` was resumed for a distinct second task via `opencode run --format json --session ses_fb68f099affewgwx9iHa60K1ef "Create second file .../general2.txt containing exactly: hello again"`. Verbatim `step_finish` lines from that resumed stream (two consecutive readings of the **same** worker session):

Reading 3 — first `step_finish` of the resume (write of `general2.txt`):

```json
{"type":"step_finish","timestamp":1787938590585,"sessionID":"ses_fb68f099affewgwx9iHa60K1ef","part":{"id":"prt_04971cf73001PkmRmylTBUFqlJ","reason":"tool-calls","snapshot":"21536642c9bea60950205eb583c8add65edeaa67","messageID":"msg_04971b8b9001QkYvEbfcDZ8n2o","sessionID":"ses_fb68f099affewgwx9iHa60K1ef","type":"step-finish","tokens":{"total":9764,"input":6776,"output":119,"reasoning":4,"cache":{"write":0,"read":2865}},"cost":0}}
```

Reading 4 — second `step_finish` of the same resume (verification `hexdump` turn):

```json
{"type":"step_finish","timestamp":1787938593934,"sessionID":"ses_fb68f099affewgwx9iHa60K1ef","part":{"id":"prt_04971dc84001w2LcMgcQWaDHWu","reason":"tool-calls","snapshot":"21536642c9bea60950205eb583c8add65edeaa67","messageID":"msg_04971d06b001D0xGZN6kLlzct6","sessionID":"ses_fb68f099affewgwx9iHa60K1ef","type":"step-finish","tokens":{"total":9918,"input":204,"output":129,"reasoning":0,"cache":{"write":0,"read":9585}},"cost":0}}
```

Reading 5 — final `stop` of same resume (explicit check: reading 5 `total` 10083):

```json
{"type":"step_finish","timestamp":1787938596293,"sessionID":"ses_fb68f099affewgwx9iHa60K1ef","part":{"id":"prt_04971e5be001UZfwnTIuZXLYM6","reason":"stop","snapshot":"21536642c9bea60950205eb583c8add65edeaa67","messageID":"msg_04971dd1e0014Swr8LaTiDXeIW","sessionID":"ses_fb68f099affewgwx9iHa60K1ef","type":"step-finish","tokens":{"total":10083,"input":246,"output":60,"reasoning":0,"cache":{"write":0,"read":9777}},"cost":0}}
```

Observations across resumes of the same worker identity (`ses_fb68f099affewgwx9iHa60K1ef` — dispatch turn totals 8547/8955 vs resume turn totals 9764/9918/10083): `total` values are all in the 8–10k band; they do **not** double when a second task is added (cumulative would be ~18k+). `input` fluctuates sharply (8143 → 308 → 6776 → 204 → 246) while `total` stays flat, and `cache.read` compensates. This matches per-turn reporting with prompt-cache reuse, not a monotonically accumulating counter.

**Semantics ruling for (b)/(c): per-turn (per `step_finish`)**, not cumulative, not per-segment. Do NOT sum readings across turns/tasks. The `info.tokens` aggregate in `export` is a stored per-session rollup of a different shape (no `total` in `info.tokens`, only in per-message/per-step `tokens`), but the live `step_finish` envelope is per-turn.

**Ruling on M041 §6 (72,821 and 94,451):** On OpenCode the two consecutive resume readings of one dispatched session (`ses_fb68f099affewgwx9iHa60K1ef`: 8955 → 9764 → 9918) are per-turn figures; summing them would be arithmetic attribution, not measurement. The M041 `+` between 72,821 and 94,451 is likewise not validated on this driver — consecutive readings must be reported as separate readings, not added.

### (d) Dispatched reviewer — reported same as worker, via worker's own envelope (not parent)

Parent `ses_fb68d2f1cffe4eiId86oabxXnr` dispatched a general reviewer subagent (prompt: `Review .../general.txt ... return 3 bullet findings`). Parent `tool_use` verbatim fragment (no tokens):

```json
{"type":"tool_use","timestamp":1787938678208,"sessionID":"ses_fb68d2f1cffe4eiId86oabxXnr","part":{"type":"tool","tool":"task","callID":"call_01a04972e90a78328d3d72303d8b9ec5","state":{"status":"completed","input":{"description":"review file","prompt":"Review /var/folders/vj/vzc5sn6x0n5943_jx5s1_8680000gn/T/opencode/m042-opencode-scratch/general.txt for correctness and return 3 bullet findings","subagent_type":"general"},"output":"<task id=\"ses_fb68d152dffeQw2X68CHnmeI7k\" state=\"completed\">\n<task_result>\nReview of `general.txt:1`:\n\n* **Trivial placeholder content:** File contains only `hello general` (`general.txt:1`) — no structure, logic, or correctness criteria to evaluate; appears to be placeholder/test data.\n...","metadata":{"parentSessionId":"ses_fb68d2f1cffe4eiId86oabxXnr","sessionId":"ses_fb68d152dffeQw2X68CHnmeI7k","model":{"modelID":"muse-spark-1.2-contributor-free","providerID":"opencode"},"truncated":false}}}
```

Worker/reviewer session `ses_fb68d152dffeQw2X68CHnmeI7k` export verbatim `info.tokens` and per-step `tokens` (reviewer indistinguishable from worker in reporting):

```json
"tokens": {"input": 8535, "output": 237, "reasoning": 264, "cache": {"read": 8610, "write": 0}}
```

```json
{"tokens":{"total":8609,"input":8269,"output":105,"reasoning":58,"cache":{"write":0,"read":177}},"modelID":"muse-spark-1.2-contributor-free","providerID":"opencode"}
```

Parent's `step_finish` for that dispatch reported only parent tokens `{"total":10387,"input":9764,"output":144,"reasoning":302,"cache":{"write":0,"read":177}}`. Nothing distinguishes a reviewer dispatch from a worker dispatch in the reporting surface.

### (e) Auxiliary session — **nothing reported**

No background/tooling session emitted a token figure to the driving shell on any surface. OpenCode's `default.bash` has no `run_in_background` flag; auxiliary sessions (LSP, tooling, hooks) did not surface any `tokens` envelope to the observed session. Explicit entry:

*Auxiliary/background/tooling session: nothing reported on tool-result field, envelope key, log line, or status line. Not foldable into another bucket — no figure exists to fold.*

### (f) Orchestrator as separate session vs Main Agent

Exercised by running two independent top-level sessions (`ses_fb68f43cbffez3Xaw9gEKgxCaq` as "Main" and `ses_fb68f099affewgwx9iHa60K1ef` / `ses_fb68d152dffeQw2X68CHnmeI7k` as dispatched "Orchestrator/Worker" sessions). Each session's `step_finish` / `export` reports its own `tokens` separately, keyed by its stable `sessionID` / `parentSessionId`. Parent totals do **not** include worker totals (parent 10345 vs worker 8547/8955; parent 10387 vs reviewer 8609). So Main and Orchestrator are reported **separately** where both are run as `opencode run` sessions (each via `step_finish.part.tokens` and `export`).

When one session plays both Main and Orchestrator together (today's default), only that session's single `step_finish` figure exists — no second Orchestrator figure exists to report, so the Orchestrator bucket is **empty, not estimated**.

## Fields present (E0 — dimensions actually observed)

| Field | Present? | Where observed (exact surface) |
|---|---|---|
| `input` | **yes** | `step_finish.part.tokens.input` and `export.info.tokens.input` / `export.messages[].info.tokens.input` |
| `output` | **yes** | same `tokens.output` |
| `total` | **yes** | `part.tokens.total` per `step_finish`; not in `info.tokens` aggregate (which has only input/output/reasoning/cache) |
| `reasoning` | **yes** | `tokens.reasoning` (provider-specific reasoning tokens; observed 0–1362) |
| `cache-read` | **yes** | `tokens.cache.read` |
| `cache-write` | **yes** | `tokens.cache.write` (always observed 0 in these runs) |
| `cost` | **yes** | sibling `cost: 0` beside `tokens` (no dollar figure; always zero for this provider) |
| `model` | **yes** | `metadata.model.modelID` on `task` tool_use, and `export.info.model` / `export.messages[].info.modelID` (`muse-spark-1.2-contributor-free`) |
| `provider` | **yes** | `metadata.model.providerID` / `info.providerID` (`opencode`) |
| `session / run id` | **yes** | `sessionID` on every event/part, `messageID` / `part.id`, `metadata.sessionId` / `parentSessionId` on task dispatch, `export.info.id/parentID` |
| `task / dispatch id` | **yes** | `callID` on `tool_use` (`call_…`), and the dispatched `sessionId` (`ses_…`) which is the stable dispatch identifier |
| `duration_ms` / wall-clock | **yes, derived** | `part.time.start/end` on each tool_use/step gives millisecond timestamps; no explicit `duration_ms` field, but computable from timestamps (not a token dimension) |
| `tool_uses` count | **no** | not reported |
| UI-only token display | **unavailable** | not readable from the session |

**Dimensions named from observation: six token dimensions** (`input`, `output`, `total`, `reasoning`, `cache.read`, `cache.write`) — plus `cost`, `model`, `provider`, `session/task` identifiers. M009 anticipated exactly four token dimensions; this driver reports a different set (extra `reasoning` and `total` where `total` is absent from the session-level aggregate, and `cost` is zero). No single "exactly four" matches the live shape.

## Attribution (E3) and partition (E1)

- **Per-instance attribution: stable via `sessionId`.** Every `step_finish` and every `task` tool_use / `export` carries a stable `sessionID` / `metadata.sessionId` / `metadata.parentSessionId` and `callID`. The same worker identity `ses_fb68f099affewgwx9iHa60K1ef` retained its id across dispatch and resume (second task via `opencode run --session ses_fb68f099…`), so a reading can be tied to one specific dispatch/worker instance without inference. This is achieved without beta traces — the stable identifier is directly in the envelope.

- **Partition:** main → reported via its own `step_finish.part.tokens`; subagent (worker, resumed worker, reviewer) → reported via its *own* session's `step_finish` / `export` (not via parent's tool result); auxiliary → nothing reported. Nothing in the surface would let an auxiliary figure be folded into main or subagent — there is no auxiliary figure at all, and parent figures do not already contain worker figures.

## Main vs Orchestrator as separate sessions

When the Orchestrator runs as a dispatched subagent of the Main Agent (as in M041), its usage arrives via its *own* session's envelope (`ses_fb68f099…`, `ses_fb68d152…`) tagged with `parentSessionId` pointing at the Main session (`ses_fb68f43…`, `ses_fb68d2f1…`). The Main Agent's own `step_finish.tokens` remain separate (10k) from the Orchestrator/worker's (8–9k). No Main/Orchestrator ratio or milestone total is reported by the harness — only per-session per-turn figures, and a total would require summing, which the per-turn semantics forbids.

## Labels (E2)

| Value | Label |
|---|---|
| `step_finish.part.tokens` per turn (main, worker, reviewer, resumed) | **measured** (per-turn semantics above) |
| Any cumulative or summed total across turns/sessions | **unavailable** (would require summing per-turn readings — no cumulative figure is reported; see semantics probe) |
| Auxiliary usage | **unavailable** (nothing reported) |
| Orchestration overhead, inline task cost as decomposed figures | **PitWay-derived and conditional** — not computed here; main-session tokens are measured directly, but an "overhead" delta would require subtraction between separate sessions, which is arithmetic attribution, not measurement |

## Explicit negative evidence

- Inline task surface other than `step_finish.part.tokens` / `export`: **nothing reported**.
- Dispatched worker parent tool-result field: **nothing reported** (sample above has no `tokens` key).
- Auxiliary session on any surface: **nothing reported**.
- UI-only TUI display: **unavailable** (not readable from session).
- OpenTelemetry trace (E5): **not enabled; not exercised** (no observation).
- Transcript parsing, TUI scraping, snapshot accumulation, Agent SDK inversion: **not exercised** — usage is already available via the structured `step_finish`/`export` envelope, so no scraping/parsing was attempted or needed.

## E0–E6 verdicts (per M009 as mapped in the contract)

| Experiment | M009 join | Verdict on this driver | Evidence |
|---|---|---|---|
| **E0** — confirm the four supported dimensions against real captured data | four token dimensions | **not validated exactly** | Driver reports six token-adjacent dimensions (`input`, `output`, `total`, `reasoning`, `cache.read`, `cache.write`) plus `cost`; the "exactly four" shape is not reproduced. The live `total` is per-turn (per `step_finish`) and absent from the session-level `info.tokens` aggregate, so the four-way set as named in M009 is not exactly reproduced. |
| **E1** — three-way main/subagent/auxiliary partition | main+subagent+auxiliary, not main+subagent | **validated exactly** | Main reported via own `step_finish` (9799, 9962); subagent via own session `step_finish`/`export` (8547/8955, 8609); auxiliary nothing reported and not folded — three buckets distinct, never collapsed. |
| **E2** — inline-main-task / orchestration-overhead are PitWay-derived and conditional, not directly measured | derived-value labeling | **not validated** (revised) | Inline main task **is** directly measured on this driver (`step_finish.part.tokens` for the main session itself, e.g. 9799). An orchestration-overhead delta would still be PitWay-derived (requires subtraction between separate sessions), but the inline-cost half of E2 does not hold as-stated here. |
| **E3** — stable per-subagent-instance attribution requires beta traces | per-instance attribution | **not validated** (revised) | Stable attribution **is** achievable without beta traces via the harness's own `sessionID` / `callID` / `parentSessionId` (e.g. `ses_fb68f099affewgwx9iHa60K1ef` stable across resume). M009's beta-trace requirement is not reproduced on this driver. |
| **E4** — multi-session totals are partial segment accumulation, never exact | accumulation bounds | **validated exactly** | No cumulative session/session-group total is reported; `step_finish` is per-turn, so any milestone total would require summing per-turn figures (explicitly forbidden by semantics probe — `input` 2223→1443→…) and some sessions (auxiliary) have no figure at all. Any total is therefore partial and never exact, matching M009. |
| **E5** — OpenTelemetry opt-in operational cost vs accuracy | OTEL cost/benefit | **not exercisable on this driver** | OpenTelemetry not enabled in these throwaway runs; no operational-cost or accuracy observation was made. |
| **E6** — the four rejected approaches still fail to meet the bar (transcript parsing, TUI scraping, snapshot accumulation, Agent SDK inversion) | rejected approaches re-confirmed | **validated exactly** | All four remain rejected: usage is already available via the structured `step_finish`/`export` envelope on this driver, so transcript/TUI scraping and snapshot accumulation are unnecessary and fragile by the same M009 rationale; Core never imports AI-provider code (Agent SDK inversion) and OpenCode sessions already report without it. No evidence revises the rejection. |

## Dimensions actually observed on OpenCode

`input`, `output`, `total` (per `step_finish` only), `reasoning`, `cache.read`, `cache.write` — six token dimensions — plus `cost` (always 0), `model` (`muse-spark-1.2-contributor-free`), `provider` (`opencode`), `sessionID`/`messageID`/`callID`/`parentSessionId`.

M009's "exactly four dimensions" is not universal; this driver reports a superset with `reasoning` and a `total` that is per-turn only, not a session aggregate.

## Per-instance attribution result

**Stable identifier observed.** `sessionID` (`ses_…`), `callID` (`call_…`), and `metadata.sessionId`/`parentSessionId` / `export.info.id`/`parentID` attach each reading to one specific dispatch/worker instance. Resume via `opencode run --session ses_fb68f099…` preserved the same `ses_…` across tasks.

## Main vs Orchestrator result

**Reported separately, exactly where measured.** Main session's `step_finish.part.tokens` (e.g. `ses_fb68f43cbffez3Xaw9gEKgxCaq` total 10345) and Orchestrator/worker session's own `step_finish`/`export` (e.g. `ses_fb68f099…` total 8955) are disjoint and tagged by `sessionID`/`parentSessionId`. No harness-computed ratio or total is emitted; a combined figure would require arithmetic attribution.

## Auxiliary handling

Auxiliary usage is **nothing reported** — no tool-result field, no envelope key, no log line carries it. It is never folded into main or subagent; the absence is explicit, matching M040 Decision 3's "never folded into another bucket" rule.

## OpenTelemetry, estimation, and hardening notes

No estimation, no arithmetic attribution, no transcript parsing, no TUI scraping was performed. No percentages or exact milestone totals are stated. Orchestrator vs main vs worker figures are quoted as separate per-turn readings, never summed. The throwaway repo's `.pitway/` is the only PitWay state touched by experiments; this repository's `.pitway/` saw only read-only `resume`/`status` checks.
