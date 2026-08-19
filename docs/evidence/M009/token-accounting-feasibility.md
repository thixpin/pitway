# M009/T006 — Token-Accounting Feasibility: Independently Reviewed Conclusion

Recorded 2026-08-20, as part of T006's roadmap-reconciliation. This is a durable, clone-durable
record of an independently reviewed feasibility conclusion covering whole-run/main-agent and
per-subagent token accounting for PitWay's own dogfooded usage — preserved here accurately, never
paraphrased away, and never only in a gitignored `reports/*.md` file. No token-accounting
implementation, schema, or CLI code exists anywhere in M009's diff; this is a roadmap-recording
requirement only (M009/AC004).

## Verdict

**Feasible only partially.** Some dimensions of token accounting are reliably capturable today;
others are not, for reasons rooted in what the runtime actually reports rather than anything
PitWay's own architecture could work around. The distinction between the two is the load-bearing
fact this document exists to preserve.

## Exactly four supported token dimensions

PitWay's exact supported data is four token dimensions — no more, no fewer, and this document
does not silently round that count up or down for convenience. Any future implementation task
must name these four precisely against the runtime's own real reporting shape at the time it is
built, not assume they are stable indefinitely.

## Session partition: main + subagent + auxiliary, not main + subagent

The real session partition worth accounting for is **three-way** — main (the driver session
itself), subagent (a dispatched worker), and auxiliary (neither of those two: background/tooling
sessions, or any other session shape the runtime creates that isn't a direct driver-to-worker
dispatch). A two-way main-plus-subagent model undercounts by construction — it has no bucket for
auxiliary sessions at all, so their usage would either be silently dropped or incorrectly folded
into one of the other two buckets. Any future accounting design must carry all three buckets
distinctly, never collapse auxiliary into either of the other two.

## Inline-main-task and orchestration-overhead values are PitWay-derived and conditional

Two figures that would be useful — the token cost of work the driver does inline (not dispatched)
and the token overhead of orchestration itself (dispatch startup, context assembly) — are **not**
directly reported by the runtime. They can only be **derived** by PitWay by comparison and
subtraction (e.g. against a known dispatch-startup baseline, or by attributing session deltas to
periods of inline work), and any such derivation depends on assumptions about session boundaries
that may not hold generally. These two values, if ever implemented, must be labeled explicitly as
PitWay-derived and conditional — never presented as directly measured, and never blended with the
four genuinely supported dimensions above without that distinction visible.

## Stable per-subagent-instance attribution requires beta traces

Attributing usage reliably to one *specific* subagent instance (as opposed to an aggregate across
all subagents in a run) is not achievable with the runtime's stable, generally-available reporting
surface as of this review. It requires **beta trace** functionality — not yet a stable, generally
available capability. A future implementation cannot claim stable per-instance attribution without
either that beta capability graduating to stable, or an equivalent stable mechanism becoming
available; claiming it prematurely would violate PitWay's own "never estimate" discipline (decision
8) by presenting a derived approximation as a real per-instance fact.

## Multi-session totals are partial segment accumulation, never exact

Summing usage across multiple sessions in one milestone (many dispatched subagents plus the main
driver session) can only ever be a **partial accumulation of measured segments** — never a
mathematically exact total. Some segments may be unmeasured (a session whose usage the runtime
never reported), and the beta-trace gap above means per-instance segments may themselves be
approximate even when a total figure exists. Any future multi-session total must be presented with
this caveat attached, never as an exact figure, mirroring the existing `Tokens: 84.2k (2 tasks
N/A)` surfacing convention (§12) rather than silently blending measured and unmeasured segments.

## OpenTelemetry is opt-in and operationally expensive

Using OpenTelemetry-based tracing to close some of the gaps above is a real option, but not a free
one: it is opt-in (requires explicit configuration, not ambient by default) and operationally
expensive (real infrastructure and overhead cost, not a toggle with no consequence). A future
implementation task must treat this as a genuine cost/benefit trade-off to be evaluated on its own
merits, not assumed to be the obvious next step.

## Rejected approaches

Four alternative approaches to closing the gaps above were evaluated and are rejected, not merely
deferred:

- **Transcript parsing** — inferring usage by parsing conversation transcripts. Fragile, format-
  dependent, and not a reporting mechanism the runtime itself commits to keeping stable.
- **TUI scraping** — extracting usage figures by scraping terminal/TUI output. Same fragility,
  worse: display formatting is explicitly not a stable interface.
- **Snapshot accumulation** — periodically snapshotting and diffing some external state to infer
  usage deltas. Introduces its own timing/consistency gaps and does not solve the beta-trace
  per-instance attribution problem above.
- **Agent SDK architectural inversion** — restructuring PitWay to depend on the Agent SDK directly
  to get richer usage telemetry. Rejected on architectural grounds independent of the telemetry
  question itself: this project's own binding constraint (CLAUDE.md's Architecture Constraints —
  "Core must never import AI-provider code") would be violated outright by making Core depend on
  an AI-provider SDK. This is not a close call weighed against telemetry benefit; it is a hard
  architectural boundary this repository has held since M001, and no telemetry gain justifies
  crossing it.

## Unknown or incomplete values

Any value that is unknown or incomplete stays `null`/N/A — never estimated. This is not a new rule
introduced by this review; it is decision 8's existing discipline (§12, Token Accounting Strategy),
restated here because it applies with full force to whatever a future Token Telemetry Spike or
Usage Accounting milestone builds. A partially-supported dimension does not get a filled-in
placeholder value; it gets `null` and is surfaced as unmeasured, exactly like every other honestly-
disclosed gap in this project's own usage accounting to date (e.g. the M008/T010 completed-task
usage-correction gap).

## How this is used

This conclusion is the basis for the Token Telemetry Spike roadmap candidate recorded in
`IMPLEMENTATION_PLAN.md`'s Revised Roadmap (unnumbered, time-boxed, positioned after M011 —
Claude Skills): seven experiments, E0–E6, each targeting one load-bearing join this document
identifies (the four dimensions, the three-way session partition, the derived-value labeling
discipline, per-instance attribution, multi-session accumulation bounds, OpenTelemetry's real
cost/benefit, and a re-confirmation of the four rejected approaches). A full Usage Accounting
milestone becomes a real candidate for scheduling only if that spike validates every one of those
seven joins exactly; if any fails to validate exactly, the limitation documented above stands
permanently and the idea is deferred indefinitely, not retried on a fixed schedule — the same
evidence-before-adoption discipline this project already applies to quick-change's and Claude
Skills' own threshold overrides.
