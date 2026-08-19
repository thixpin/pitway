# M007/AC012 — Structured Failure-Evidence Extraction: Decision

Compiled 2026-08-19, as part of T011. Uses T001's compiled live failure-evidence findings (the
CT002/CT012 recursion-guard incident) as the evidence base, per this task's own dependency on T001.

## The problem, restated precisely

`executeCommandCheck` (`src/core/verification/run.ts`) captures raw `stdout+stderr` and trims it
with the shared tail-preserving `trimTail` cap (`src/core/verification/text-trim.ts`) — a
byte-position decision, not a content-aware one. During M006's own live CT002/CT012 incident, the
retained tail landed mid-stack-trace, discarding the actual failing test name even though it
existed earlier in the captured output. The fix actually applied at the time was test-specific
(moving the fixture's marker to the deterministic tail) — a workaround available only because the
driver controlled the failing test's own output. **For a real command-check failure whose output
the driver does not author** (an arbitrary `npm test`, `tsc`, or any other approved verification
command), no such workaround exists — the failing test/check name can appear anywhere in the
output, and a large real failure's tail may not contain it at all.

## Generality across arbitrary command output

Not resolved to a single universal parser — command output formats vary too much (vitest's
summary format differs from tsc's, differs from an arbitrary shell script's). What is generalizable
across most test runners and structured CLI tools: a small set of common patterns (a line
containing `FAIL`, `✗`, `×`, or a runner-specific "N failed" summary line) capture the common case
without needing per-runner parsers; anything not matched falls back to today's tail-only behavior,
never worse than the current state.

## Mechanism, if adopted

A new, narrowly-scoped extraction step ahead of `text-trim.ts`'s cap — not a `text-trim.ts` change
itself, since `trimTail` is a generic, content-agnostic helper reused in three places
(`process-exec.ts`, `run.ts`'s evidence trimming, AC006's worker-report capping) and should stay
that way. The extraction step would scan the raw (pre-cap) output for a small set of common
failure-summary patterns and, when found, prepend the matched line(s) to the evidence ahead of the
tail-preserved excerpt — so both the structured summary and the raw tail survive the cap together,
neither replacing the other.

## Recommendation

**Adopt the decision, defer implementation** (per AC012's own design — this AC delivers a decision
only, mirroring AC005/AC009). This is not speculative in the way AC005/AC009 were: the problem is
already demonstrated, live, in this repository's own history (CT002/CT012), and the fix applied at
the time was a one-off workaround unavailable for real command-check failures the driver doesn't
author. Every future `verify` run on any command-type check carries this same risk. The
recommendation is **adopt**, not defer — but per the tiered Decision Authority Policy, adopting or
scheduling a new mechanism is a mandatory developer-gate decision regardless of how strong the
supporting evidence is, so this is presented for explicit selection rather than decided
autonomously.

**Decision:** Adopt as a future direction, implementation deferred. The developer added binding
design constraints for whenever this is implemented: the extractor must be **best-effort and
tool-agnostic** (no runner-specific parser is assumed correct); it must **preserve the bounded raw
tail** unchanged (the extraction is additive, never a replacement for the existing cap); it may
**prepend only confidently matched failure-summary lines** — never a low-confidence guess; it must
**never alter the real exit status or termination_reason** the underlying command actually
produced; and it must **fall back cleanly to today's tail-only behavior** whenever no structure is
recognized, so an unrecognized format is never worse than the current state. No implementation
milestone is scheduled — that happens as part of T013's roadmap reconciliation, if at all.
