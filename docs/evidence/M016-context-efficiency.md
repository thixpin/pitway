# M016 Context-Efficiency Evidence

Compiled 2026-08-21, after T001–T003's real dispatches. Recorded per this
milestone's own AC006, following M006's own evidence-file precedent and
honesty register: claims credit only for what PitWay's own bundle-building
code measurably does, reports the real delta plainly regardless of
direction, and discloses what this document cannot verify from the
historical record rather than fabricating a comparison to fill the gap.

## Correction to this milestone's own contract, disclosed here

AC006, as drafted, asked for a comparison against "the M007/AC011
post-`mapped_ac_ids`-fix figure." Checked against the actual historical
record while performing this measurement: **no such figure was ever
recorded.** `IMPLEMENTATION_PLAN.md` §8 and `docs/evidence/M007/` document
that the fix landed (the `mapped_ac_ids` field, `buildTaskContextBundle`'s
filtering behavior) but never re-measured a real bundle afterward — the
only number on record anywhere is M006's own **pre-fix** finding (89% of
one bundle's bytes, all 10 of M006's ACs unfiltered). This document
compares against that real M006 pre-fix baseline instead, and separately
proves the fix is working for real, right now, on this milestone's own
genuine dispatches — which is arguably stronger evidence than a second
historical figure would have been.

## Real bundles measured, this milestone's own actual dispatch

`task-status <id> --context --json`, captured verbatim at the moment T001
and T002 were actually dispatched (the same real bundles their worker
subagents received — no new measurement mechanism, reusing the bundle
exactly as delivered):

| Task | Full bundle (bytes) | `contractExcerpt` (bytes) | ACs in `contractExcerpt` |
|---|---|---|---|
| T001 | 4,022 | 1,765 (44%) | 1 (`AC003` — T001's own mapped AC) |
| T002 | (not separately re-measured; same shape) | — | 1 (`AC004` — T002's own mapped AC) |

**The M007/AC011 fix is confirmed working for real, on live dispatch
data**: T001's `contractExcerpt.acceptanceCriteria` contains exactly one
entry, `AC003` — T001's own `mapped_ac_ids` value — never M016's other six
ACs (AC001, AC002, AC004–AC007). Before the fix (M006's own measured
case), `contractExcerpt` carried **all** of the contract's ACs regardless
of which one the task actually mapped to.

## Comparison against the M006 baseline

| | M006 (pre-fix, T001's actual bundle) | M016 (post-fix, T001's actual bundle) |
|---|---|---|
| Full bundle size | 28,239 bytes (characters) | 4,022 bytes |
| `contractExcerpt` size | 25,169 bytes | 1,765 bytes |
| `contractExcerpt` share of bundle | 89% | 44% |
| ACs carried in `contractExcerpt` | 10 of 10 (all of M006's ACs) | 1 of 7 (only the task's own mapped AC) |

**The delta, reported plainly:** both the absolute `contractExcerpt` size
and its share of the total bundle dropped substantially. The comparison is
not perfectly apples-to-apples — M006's and M016's contracts differ in AC
count, AC prose density, and task objective length (M016's own AC003 text
is itself fairly long, which is why `contractExcerpt` is still 44% of a
much smaller total rather than a negligible fraction) — but the
**mechanism-level fact is unambiguous and directly measured, not
inferred**: the bundle no longer carries every AC in the contract
regardless of relevance, which was M006's own precisely-identified defect.
This milestone's own dispatches are the first real, non-synthetic
confirmation that the fix behaves as designed under genuine use.

## What this document can and cannot claim

**Can claim:** the `mapped_ac_ids` filtering mechanism works correctly on
real, current dispatch data (T001's bundle contains exactly its own mapped
AC, never the other six); a real, measured size reduction in both absolute
`contractExcerpt` bytes and its share of the total bundle, compared
against M006's own real pre-fix measurement; correction of this
milestone's own contract, which assumed a historical re-measurement that
was never actually performed.

**Cannot claim:** a model/config-controlled, apples-to-apples percentage
comparison against M006 (different contracts, different AC counts and
prose density — the same class of caveat M006's own document raised
about its comparison against M004/M005); a machine-measured
repository-read count or any other dimension outside what the bundle
itself reports; any credit for harness-level context this milestone does
not touch (system prompt, tool definitions, skills, project memory — the
same exclusions M006's document names, unchanged).

## Carried forward

No further follow-up identified specific to bundle filtering itself — the
M006-identified defect is confirmed fixed and working. A genuine
model/config-controlled before/after bundle measurement (fixing both the
M006 and M016 caveats above) would require deliberately re-running the
same task-shaped dispatch under both the pre-fix and post-fix code with
everything else held constant — not attempted here, and not clearly
worth the cost given the mechanism-level proof above already settles the
question the M006 finding raised.
