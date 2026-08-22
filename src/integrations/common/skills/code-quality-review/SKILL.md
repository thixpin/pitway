---
name: code-quality-review
description: Checklist and method for reviewing code quality — readability, maintainability, SOLID, DRY, performance, and backward compatibility. Use when asked to review code, a diff, a branch, or a merge request for quality, or before finalizing significant changes. For GitHub PR review use the built-in /review; for security-focused review use the security-audit skill.
---

# Code Quality Review

Review for defects and maintainability, in that order. Every finding names the location, the concrete problem, and a suggested fix; every finding has a severity.

## Scope

**Reviews a change** — a diff, branch, or set of files — at the function and file level.

**Use for** quality review of written code: readability, maintainability, correctness risks, backward compatibility.

**Do not use for:**
- System-wide structure, module boundaries, or layering — use `architecture-review`. If a finding here is really "the whole codebase is shaped wrong," it belongs there.
- Security review — use `security-audit`.
- Reviewing a GitHub pull request — use the built-in `/review`.

## Method

1. Understand the change's intent before judging it — read the description, then the diff, then enough surrounding code to know how the pieces are used.
2. Review the design first (is this the right shape?), then the details (is it written well?). A perfectly formatted wrong abstraction is still wrong.
3. Report findings by severity: **blocker** (bugs, data loss, breaking changes), **should-fix** (maintainability problems that will hurt soon), **nit** (style and polish, clearly labeled as optional).
4. Distinguish "this violates the project's conventions" from "this differs from my preference." Only the first is a finding.

## Checklist

**Correctness & safety**
- Edge cases: empty inputs, nulls, boundaries, concurrency, partial failure.
- Error handling: failures surfaced, not swallowed; resources released on all paths.

**Backward compatibility**
- Public APIs, wire formats, database schemas, and config keys keep working for existing callers, or the break is explicit and justified.
- Behavior changes to shared code checked against all existing call sites.

**Maintainability** — scoped to the change; escalate system-wide findings to `architecture-review`
- DRY: real duplication (same knowledge in two places) flagged; incidental similarity left alone.
- Single responsibility: each unit has one reason to change; mixed concerns (I/O + logic + formatting in one function) flagged.
- Dependencies point the right way — no new coupling from low-level modules to high-level ones, no cycles.
- Naming says what things are; no comment needed to decode a name.

**Readability**
- Control flow followable top-to-bottom; nesting shallow; clever one-liners replaced by clear code.
- Comments explain *why*, not *what*; stale comments flagged.

**Performance**
- Algorithmic issues only unless the project has stated perf budgets: N+1 queries, work inside hot loops that belongs outside, unbounded growth, missing pagination.
- No speculative micro-optimization findings without evidence.

**Tests**
- Changed behavior is covered; tests assert behavior, not implementation (see `testing` skill).
