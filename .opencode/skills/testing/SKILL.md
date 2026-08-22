---
name: testing
description: Strategy and rules for writing or improving automated tests. Use when adding tests, improving coverage, fixing flaky tests, setting up a test suite, or deciding what and how to test. Emphasizes deterministic tests, testing behavior over implementation, and a tight validation loop. For diagnosing production failures whose cause is unknown, use the debugging skill. Once the cause is identified, bug-fix returns here for the regression test.
---

# Testing

Write tests that fail for exactly one reason, pass deterministically, and survive refactoring.

## Scope

**Use for** deciding what to test and writing it: new tests, coverage gaps, flaky tests, test structure, setting up a suite.

**Do not use for:**

- Diagnosing why production code misbehaves when the cause is unknown — use `debugging`. Once the cause is identified, `bug-fix` returns here for the regression test.
- Judging non-test production code — use `code-quality-review`.

## What to test

- Test observable behavior and contracts, not implementation details. A refactor that preserves behavior should not break tests.
- Prioritize by risk: core business logic and boundary conditions first, then error paths, then integration seams. Do not chase coverage numbers for trivial code (getters, framework glue).
- Every bug fix gets a regression test (see the `bug-fix` skill).
- Follow the project's existing test framework, directory layout, naming, and assertion style — do not introduce a new test framework into a project that has one.

## Determinism

- No hidden dependencies on wall-clock time, timezones, locale, random seeds, network, or test execution order. Inject clocks, seed randomness, and fake external services at the boundary.
- Each test owns its setup and teardown; tests must pass in isolation and in any order.
- Treat flaky tests as defects in the test suite: find the nondeterminism instead of masking it with retries or sleeps. If the nondeterminism turns out to be in the production code rather than the test, hand off to `debugging`.

## Databases and external state

- Never test against a development, staging, or production database. Use the project's test database, or add a disposable one (container or in-process instance) if none exists.
- Assert in global setup that the target is the test database; never let a missing test configuration fall back to the default database.
- Reset between tests — transaction rollback, truncation, or a fresh schema. Never rely on data left by another test or manual seeding.
- Never share a test database between parallel test runs unless the project explicitly supports it.
- Apply the same isolation rules to caches, queues, object storage, and search indexes — use isolated instances or per-test namespaces.

## Structure

- One behavior per test; name the test after the behavior and expected outcome, following the project's naming convention.
- Arrange–Act–Assert (or Given–When–Then), kept visually distinct.
- Prefer real collaborators inside the process; mock only at process or network boundaries. Heavy mocking usually signals the unit under test is doing too much.
- Keep test data minimal and meaningful — only include fields the behavior depends on.
- Prefer the project's existing factories or fixtures over handwritten setup such as raw SQL.

## Validation loop

- While developing, run only the affected test file or case; run the broader relevant suite before declaring the work done.
- Confirm a new test fails for the expected reason before relying on it.
- Do not weaken or rewrite an existing test simply to make it pass. Fix the production code unless the test itself is incorrect.
