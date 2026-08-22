---
name: debugging
description: Investigate failures whose root cause is still unknown — narrow the search space, instrument, and test falsifiable hypotheses. Use for intermittent or environment-dependent behavior, unexplained stack traces, regressions with no known trigger, or any symptom without a confirmed cause. Ends once the root cause is identified; the fix and its regression test belong to bug-fix. For a flaky test over sound production code, use testing.
---

# Debugging

Locate the cause by narrowing the search space, not by guessing at fixes. A hypothesis you cannot disprove is not a diagnosis.

## Scope

**Use for** investigation where the cause is unknown: irreproducible or intermittent failures, unexplained stack traces, environment-dependent behavior, regressions with no known trigger, any symptom you would otherwise "try a fix" against.

**Do not use for:**

- A defect you can already reproduce and explain — `bug-fix` owns everything from the named cause onward. Hand off as soon as this skill names it.
- Flaky *test infrastructure* over sound production code — isolation, execution order, shared fixtures, and nondeterministic assertions belong to `testing`.
- Code with no failure report — use `code-quality-review`.

**On flaky behavior, the line is which code is unreliable.** Production code misbehaving intermittently is a mystery — debug it here. A test failing at random over sound code is a test-design problem — `testing` owns it. If you cannot yet determine whether the production code or the test is at fault, start here.

## Method

1. **Pin the observable.** Verbatim error, actual versus expected, failing input, environment — written down before theorizing. "It's broken" is not an observable.
2. **Find the last known-good state.** A commit, release, config, machine. The delta between known-good and known-bad *is* the search space.
3. **Make it reproducible before explaining it.** A reliable trigger is far easier to investigate, so build one first — a loop, fixed seed, captured payload, restored dataset. If it stays intermittent, treat reproduction rate as a number to raise (1 in 100 → 1 in 3), not a yes/no gate.
4. **Shrink the case.** Cut to the minimum that still fails. Every element removed while the failure survives is a ruled-out suspect.
5. **Bisect, don't browse.** Halve each step — `git bisect` over history, layer by layer through the stack, or by disabling half the config or data. Prefer halving the search space over reading code sequentially or relying on intuition.
6. **One falsifiable hypothesis at a time.** State the suspected cause *and* the observation that would disprove it, then go get that observation. Two changes at once make the result uninterpretable.
7. **Observe, do not infer.** Full stack trace, actual values, real request and response, timestamps — via debugger, logs, or temporary instrumentation. Assuming what the code "does" is why bugs survive an hour of reading.
8. **Trust the evidence over the story.** When a measurement contradicts your model, update the model. Re-check you are running the code you think you are: right branch, rebuilt binary, cleared cache, no stale container, the environment you are actually hitting.
9. **State the cause in one sentence, with its evidence.** A cause you cannot state plainly has not been found. Then hand off to `bug-fix`: confirmed cause, supporting evidence, reproduction steps, affected components.

## Intermittent and environment-dependent failures

When it fails only sometimes, or only *there*, suspect state that differs between runs — and go compare it directly rather than reasoning about it.

| Suspect           | Examples                                                                          |
| ----------------- | --------------------------------------------------------------------------------- |
| Concurrency       | Race conditions, ordering assumptions, shared mutable state, missing locks         |
| Time              | Timeouts, clock skew, timezones, daylight saving, expiry boundaries, month and year ends |
| Resource state    | Leftover data, cache contents, connection pool exhaustion, disk or memory pressure |
| Ordering          | Job or request execution order, dependence on a previous run's side effects        |
| Environment delta | Versions, config, feature flags, locale, filesystem case sensitivity, architecture |

## Rules

- Never fix while the cause is a guess. A symptom that disappears without an explanation may have only been masked.
- Change one variable per experiment; revert it before the next.
- Keep a running list of what is ruled out and how — it prevents retesting theories, and is the handoff if someone else takes over.
- Remove temporary instrumentation; promote useful instrumentation to permanent observability in a separate change.
- Timebox. When the search space stops shrinking, report what was ruled out and what evidence is missing rather than continuing to guess.
