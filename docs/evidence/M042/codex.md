# M042/T003 — Codex driver: what the runtime reports, observed

Driver: Codex, from this actual Codex session. Date: 2026-08-29.
Throwaway repository: `/private/tmp/pitway-m042-codex.YR8lEO`, initialized
with `git init` and `pitway init --codex`. The main repository's `.pitway/`,
source, and assets were not modified. No token figure was estimated, summed,
subtracted, inferred from attribution, parsed from a transcript, or scraped
from a TUI.

## Result

The Codex collaboration surface exercised here did not report agent/model
token usage for the main session, dispatched worker, resumed worker,
dispatched reviewer, or separate Orchestrator-role session.

One token-named field, `original_token_count`, appeared on command-tool
results. It is attached to command output, not to a Codex agent session. It
therefore does not populate Main, Orchestrator, Worker, or Auxiliary usage
buckets.

## 1. Inline task in the main session

Two consecutive `exec_command` results returned command metadata and
`original_token_count`. Neither result contained agent/model input, output,
total, cache-read, cache-write, model, provider, or session usage.

Complete raw sample:

```text
Script completed
Wall time 0.2 seconds
Process exited with code 0
Final output:
{"reading_1":{"chunk_id":"b152f4","wall_time_seconds":0.000003291,"exit_code":0,"original_token_count":10,"output":"/private/tmp/pitway-m042-codex.YR8lEO\n"},"reading_2":{"chunk_id":"fabaf7","wall_time_seconds":0.00000275,"exit_code":0,"original_token_count":10,"output":"/private/tmp/pitway-m042-codex.YR8lEO\n"}}
```

Fields present: `chunk_id`, `wall_time_seconds`, `exit_code`,
`original_token_count`, and `output`. Agent/model token fields present: none.

Both command results reported `original_token_count` on their individual
command-result objects. The readings alone do not establish whether that
field is exact or how it relates to model usage. It is not attached to a
Codex agent/session identifier.

Agent/model usage semantics: **undetermined; nothing reported**. Main Agent
bucket: **unavailable**.

## 2. Dispatched worker

Complete dispatch-launch result:

```json
{"task_name":"/root/telemetry_worker"}
```

The only field was `task_name`; no usage field was present.

Complete first worker result:

```text
Message Type: FINAL_ANSWER
Task name: /root
Sender: /root/telemetry_worker
Payload:
WORKER_SEGMENT_1_COMPLETE
usage: nothing reported
```

The worker itself reported that no token-usage metadata was directly exposed
to it.

## 3. Same worker resumed for a second task

The existing `/root/telemetry_worker` identity was resumed rather than
creating a fresh worker. Complete second result:

```text
Message Type: FINAL_ANSWER
Task name: /root
Sender: /root/telemetry_worker
Payload:
WORKER_SEGMENT_2_COMPLETE
usage: nothing reported
```

Both readings carried the same directly visible worker identity. Neither
carried token usage. Cumulative, per-turn, and per-segment semantics were not
established; the ruling is **undetermined; nothing reported**.

A stable worker identifier was present, but no usage figure existed to attach
to it. Stable per-instance usage attribution was therefore not validated.
Worker bucket: **unavailable**.

## 4. Dispatched reviewer

First reading:

```text
Message Type: FINAL_ANSWER
Task name: /root
Sender: /root/telemetry_reviewer
Payload:
REVIEW_COMPLETE
check: pass
usage: nothing reported
```

Second reading from the same reviewer identity:

```text
Message Type: FINAL_ANSWER
Task name: /root
Sender: /root/telemetry_reviewer
Payload:
REVIEW_SECOND_READING_COMPLETE
check: pass
usage: nothing reported
```

The stable reviewer identity `/root/telemetry_reviewer` appeared on both
readings. No token usage appeared on either. Semantics: **undetermined;
nothing reported**. Worker bucket for reviewer usage: **unavailable**.

## 5. Auxiliary/background/tooling session

No separate auxiliary Codex agent/model session was created or exposed by the
harness during this experiment.

Command-tool invocations exposed `original_token_count`, but those were
command results without an agent-session identifier. Treating them as
Auxiliary model usage would require inferred attribution.

Verdict: **NOT EXERCISABLE as an auxiliary Codex session**. Auxiliary bucket:
**unavailable**.

## 6. Separate Main Agent and Orchestrator sessions

Codex's collaboration surface supported creating a separate subagent identity
and assigning it the Orchestrator role. The separate identity was
`/root/telemetry_orchestrator`.

Dispatch launch:

```json
{"task_name":"/root/telemetry_orchestrator"}
```

First Orchestrator reading:

```text
Message Type: FINAL_ANSWER
Task name: /root
Sender: /root/telemetry_orchestrator
Payload:
ORCHESTRATOR_SEGMENT_1_COMPLETE

No active milestone. Run milestone-add to start one.

usage: nothing reported
```

Second reading from the same Orchestrator identity:

```text
Message Type: FINAL_ANSWER
Task name: /root
Sender: /root/telemetry_orchestrator
Payload:
ORCHESTRATOR_SEGMENT_2_COMPLETE

No active milestone. Run milestone-add to start one.

usage: nothing reported
```

The Orchestrator identity was stable across both readings, but neither reading
reported usage. The main session likewise received no agent/model usage
figure. Main and Orchestrator usage were therefore **not separately
reported**. Their identities were separate; their usage was unavailable.
Semantics: **undetermined; nothing reported**.

## Fields and dimensions actually observed

| Field or dimension | Observed? | Surface |
|---|---:|---|
| Agent/model input tokens | no | — |
| Agent/model output tokens | no | — |
| Agent/model total tokens | no | — |
| Agent/model cache-read tokens | no | — |
| Agent/model cache-write tokens | no | — |
| Reasoning tokens | no | — |
| Model | no | not attached to a usage result |
| Provider | no | not attached to a usage result |
| Stable worker/reviewer/orchestrator identity | yes | `task_name` / `Sender` |
| Agent run/session identifier carrying usage | no | — |
| `original_token_count` | yes | command-tool result only |

Token dimensions actually observed: **`original_token_count` only**, scoped
to command-tool output rather than agent/model usage. No common four-dimension
agent-usage set was observed on Codex.

## M040 Decision 3 buckets

| Bucket | Runtime report | Populatable without arithmetic? |
|---|---|---:|
| Main | nothing reported | no |
| Orchestrator | nothing reported on two readings of a stable separate identity | no |
| Worker | nothing reported for dispatch, resume, or reviewer | no |
| Auxiliary | no separate auxiliary Codex session exposed | no |

No bucket may be populated from `original_token_count`: it belongs to a
command result and lacks a directly reported agent-session attribution.

## Labels

| Value | Label |
|---|---|
| `original_token_count` on each command result | measured command-output metadata; not agent/model usage |
| Main usage | unavailable |
| Orchestrator usage | unavailable |
| Worker and reviewer usage | unavailable |
| Auxiliary usage | unavailable / not exercisable |
| Inline-task cost | PitWay-derived and conditional; not computed |
| Orchestration overhead | PitWay-derived and conditional; not computed |
| Combined or milestone total | unavailable; not computed |

## M041 section 6 input evidence

M041 section 6 contains two Claude Orchestrator readings, `72,821` and
`94,451`, joined with `+`. This Codex experiment supplies no evidence about
the semantics of those Claude readings. They remain two reported readings
with **undetermined semantics**, not established additive segments. No
per-task attribution or combined figure is derived from them here.

## E0–E6 verdicts

| Experiment | Verdict | Codex evidence |
|---|---|---|
| E0 — four supported token dimensions | **not validated** | No agent/model token dimensions were reported. Only command-result `original_token_count` was observed, so an exact four-dimension agent-usage set was not reproduced. |
| E1 — main/subagent/auxiliary partition | **not validated** | Main, worker, and reviewer identities were exercised, but none reported usage. No auxiliary Codex model session was exposed. The three-way usage partition could not be populated. |
| E2 — derived-value labeling | **validated exactly** | Inline-task cost and orchestration overhead were not directly reported. Both remain unavailable unless derived conditionally; no derivation was performed. |
| E3 — stable per-instance attribution | **not validated** | Stable worker, reviewer, and Orchestrator identities were present, but no usage figure attached to them. Per-instance usage attribution was unavailable. |
| E4 — multi-session accumulation bounds | **not validated** | Multiple sessions were exercised, but no agent/model usage segments were reported. There was nothing that could be accumulated directly, partially, or exactly. |
| E5 — OpenTelemetry cost/benefit | **not exercisable** | OpenTelemetry was not enabled, and no OpenTelemetry experiment was authorized or configured in the throwaway repository. |
| E6 — four rejected approaches | **not exercisable** | Transcript parsing and TUI scraping were explicitly prohibited. Snapshot accumulation and Agent SDK inversion were outside this evidence-only task and were not attempted. No Codex observation revises M009's rejection, but this run does not independently validate it. |

## Conclusion

Codex dispatch, same-worker resume, reviewer dispatch, and a separate
Orchestrator-role session were exercisable. Stable role/session identities
were visible, but agent/model token usage was not reported on their launch or
completion surfaces.

The only token-named field observed was command-result
`original_token_count`. Because it was attached to tooling output rather than
an agent session, it cannot populate any M040 usage bucket without inferred
attribution.

M009's limitation therefore stands for Codex. This driver did not validate
every exercisable E0–E6 join exactly.
