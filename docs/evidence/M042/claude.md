# M042/T001 — Claude driver: what the runtime reports, observed

Driver: Claude Code (this session; model reported by the harness as
`claude-fable-5` for the main session, subagents on the harness default).
Date: 2026-08-29. Throwaway repo: `scratchpad/m042-claude` (`git init`,
`pitway init`, one committed `add.mjs`). This repository's `.pitway/` was
not touched by any experiment. Every figure below is quoted from the
harness as received; nothing is summed, split, or estimated.

## Where usage appears — the only surface found

The **only** place usage reached the driving session was the
`<task-notification>` the harness delivers when a dispatched subagent
stops. Its usage element, verbatim shape:

```
<usage><subagent_tokens>N</subagent_tokens><tool_uses>N</tool_uses><duration_ms>N</duration_ms></usage>
```

Not present on: the dispatch *launch* result (the `Agent` tool's return
value carries only an agent id and an output path), the main session's own
turns, tool results, `SendMessage` results, or background-command
notifications. No JSON usage object, no log line, no status line was
observed on any other surface. A UI-only token display, if the terminal
shows one, was not readable from the session and is recorded as
**unavailable**.

## Samples by session shape

### (a) Inline task in the main session — **nothing reported**

The main session performed inline work (repo setup, file writes, CLI
calls) and received **no usage figure of its own on any surface**. Main
Agent usage for this driver: nothing reported.

### (b) Dispatched worker — reported on completion

Worker dispatched via the `Agent` tool to write and run a one-assertion
test. Completion notification, usage element verbatim:

```
<usage><subagent_tokens>30201</subagent_tokens><tool_uses>2</tool_uses><duration_ms>12602</duration_ms></usage>
```

### (c) Same worker resumed — two further readings (semantics probe)

The same agent identity was resumed twice via `SendMessage`:

| Reading | Job | Verbatim usage element |
|---|---|---|
| 1 (dispatch) | write test, run it (2 tools) | `<usage><subagent_tokens>30201</subagent_tokens><tool_uses>2</tool_uses><duration_ms>12602</duration_ms></usage>` |
| 2 (resume) | run test once more (1 tool) | `<usage><subagent_tokens>30513</subagent_tokens><tool_uses>3</tool_uses><duration_ms>31778</duration_ms></usage>` |
| 3 (resume) | reply "ack" (0 tools) | `<usage><subagent_tokens>29319</subagent_tokens><tool_uses>3</tool_uses><duration_ms>47434</duration_ms></usage>` |

Observations, per field:
- `tool_uses` is **cumulative** across resumes (2 → 3 → 3).
- `duration_ms` is **monotonically increasing** across resumes.
- `subagent_tokens` is **neither cumulative nor per-segment**: reading 2 rose
  by 312 for a one-tool job (a fresh per-segment total would be ~30k, the
  size of reading 1), and reading 3 **fell** by 1,194 on a zero-tool resume.
  A monotone cumulative total cannot decrease. The stable surface does not
  say what the number is; the shape is *consistent with* a per-turn
  context-size reading, but that is a hypothesis, not an observation.

**Semantics ruling: undeterminable from the stable surface.** The figure is
non-monotonic and non-additive across resumes of one identity. It must not
be summed across readings, and consecutive readings are not segments.

**Ruling on M041 §6:** M041 recorded two readings of its Orchestrator
subagent (72,821 and 94,451) and wrote a `+` between them. The full series
the Main Agent received across that agent's five resumes was
72,821 → 94,451 → 107,369 → 110,481 → 109,766 — the last reading decreased,
matching the probe above. The two readings are not additive segments; §6
should read "two readings of an undetermined-semantics figure", and no
Orchestrator-session total can be stated from them.

### (d) Dispatched reviewer — reported on completion, same surface

Reviewer dispatched via the `Agent` tool to read one file and return three
lines. Completion notification, usage element verbatim:

```
<usage><subagent_tokens>29762</subagent_tokens><tool_uses>1</tool_uses><duration_ms>7577</duration_ms></usage>
```

Same surface and fields as a worker; nothing distinguishes a reviewer
dispatch from a worker dispatch in the reported usage.

### (e) Auxiliary session — background process: **nothing reported**

A background shell command (`Bash` with `run_in_background`) completed with
a `<task-notification>` containing only `task-id`, `status`, and `summary`
(exit code) — **no usage element at all**. Other harness-created sessions
(hooks, tooling) were not observed to emit anything to this session.
Auxiliary usage on this driver: nothing reported.

## Fields present (E0 — dimensions actually observed)

| Field | Present? | Notes |
|---|---|---|
| `subagent_tokens` | yes | one undifferentiated token count; semantics undeterminable (above) |
| input tokens | no | — |
| output tokens | no | — |
| total tokens | no (unless `subagent_tokens` is one, which the surface does not state) | — |
| cache-read / cache-write | no | — |
| model | no | not in the usage element; the subagent's model is not reported to the driver |
| provider / driver | no | implicit (this is the Claude harness), never stated in the element |
| session / run identifier | **yes** — the notification's `task-id` | a 16-hex-character id, identical across all three notifications for the same resumed agent |
| `tool_uses` | yes | cumulative count, not a token dimension |
| `duration_ms` | yes | wall-clock, not a token dimension |

**Dimensions named from observation: one** (`subagent_tokens`), plus two
non-token counters. This driver does **not** expose the four dimensions
M009 anticipated on its stable notification surface.

## Attribution (E3) and partition (E1)

- **Per-instance attribution: stable at the notification level.** The
  `task-id` on every notification for a resumed agent was identical across
  dispatch and both resumes, so a reading can be tied to one specific
  subagent instance without inference. What the reading *means* is the open
  question (above), not which instance it belongs to.
- **Partition:** main → nothing reported; subagent (worker, resumed worker,
  reviewer) → reported per notification; auxiliary (background process) →
  nothing reported. Nothing in the surface would let an auxiliary figure be
  folded into main or subagent — there is no auxiliary figure at all.

## Main vs Orchestrator as separate sessions

When the Orchestrator runs as a dispatched subagent of the Main Agent (as in
M041), its readings arrive on the same notification surface as any worker,
per resume, tagged with its stable `task-id`. The Main Agent's own usage is
**not reported anywhere**. So the split is *one-sided*: the Orchestrator's
figure is directly reported (semantics undetermined), the Main Agent's is
unavailable, and no Main/Orchestrator ratio or total is measurable.

## Labels (E2)

| Value | Label |
|---|---|
| `subagent_tokens` per notification | measured (semantics undeterminable) |
| any cumulative or per-segment subagent total | unavailable (would require an interpretation the surface does not give) |
| Main Agent usage | unavailable (nothing reported) |
| Auxiliary usage | unavailable (nothing reported) |
| Orchestration overhead, inline task cost | PitWay-derived and conditional (M009) — not computed here |

## Not exercised on this driver

- OpenTelemetry (E5): not enabled; no observation.
- A UI-only token display: not readable from the session.
