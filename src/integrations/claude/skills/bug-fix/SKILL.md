---
name: bug-fix
description: Regression-first workflow for fixing a defect whose cause is known. Reproduce the confirmed defect, fix the root cause minimally, protect it with a regression test, and verify. If the root cause is still unknown, use the debugging skill first.
---

# Bug Fix

Fix bugs regression-first: prove the bug exists, fix the cause minimally, prove it cannot return.

## Scope

**Use for** any defect with observably wrong behavior and a known cause — crashes, incorrect output, regressions.

**This skill begins once the root cause is identified.** If the cause is still unknown, use `debugging` first, then return here with it.

**Do not use for:**
- Writing or restructuring tests against working code — use `testing`.
- Improving healthy code that has no defect — use `code-quality-review`.

A vulnerability is a bug: use this workflow *and* the `security-audit` checklist together.

## Workflow

1. **Reproduce first.** Confirm the bug with a concrete failing case — a command, request, or input that demonstrably misbehaves. If you cannot reproduce it, use `debugging` to establish a reliable trigger before continuing here.
2. **Confirm the root cause.** State it in one sentence before fixing, and check the fix targets it rather than the symptom (no null check where the real problem is that the value should never be null). If tracing from symptom to cause is still open work, finish that in `debugging` first.
3. **Write the regression test before the fix** whenever the project has a test suite and the bug is testable. The test must fail on the current code for the same reason the bug occurs. If an automated test is infeasible (environment-dependent, UI-only, timing), state why and describe the manual verification used instead.
4. **Fix minimally.** The smallest change that removes the root cause. No drive-by refactoring, renames, or style changes in the same edit — propose those separately if worthwhile.
5. **Verify.** Run the regression test, then the smallest relevant surrounding test suite to catch collateral damage.
6. **Check for siblings.** Search for other call sites or copies of the same pattern that share the defect. Fix or report them — a bug that exists in three places and is fixed in one is still open.

## Judgment calls

- If the "bug" is actually intended behavior, stop and explain before changing anything.
- If the correct fix requires a breaking change or wide refactor, present the minimal safe fix and the larger fix as options rather than choosing the invasive one unilaterally.
- If the fix touches security-sensitive code (auth, permissions, input handling), also apply the `security-audit` skill's checklist to the change.
