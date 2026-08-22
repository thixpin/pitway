---
name: architecture-review
description: Method for assessing a codebase's structure — duplication, single-responsibility violations, layering problems, and coupling — and recommending minimal, incremental improvements. Use when asked to review architecture, assess structure or technical debt, evaluate module boundaries, or plan a refactor. Reviews the system, not a single change: for reviewing one diff or branch use the code-quality-review skill.
---

# Architecture Review

Judge structure by how safely the system can change, not by resemblance to a textbook pattern. Recommend the smallest set of moves that improves changeability; never propose a rewrite when an incremental path exists.

## Scope

**Reviews the system** — modules, layers, and dependencies across the codebase.

**Use for** structural assessment: technical debt, module boundaries, coupling, duplication across modules, planning a refactor.

**Do not use for:**
- Reviewing a single diff or file for quality — use `code-quality-review`. The same concerns (DRY, single responsibility) appear in both; the difference is altitude. Within one change, they are that skill's; across modules, they are this one's.
- Implementing the refactor. This skill produces recommendations; carrying them out is ordinary work under `CLAUDE.md`.

## Method

1. **Map before judging.** Identify the modules/layers, what depends on what, and where the domain logic actually lives. Use the dependency direction the code has, not the one the docs claim.
2. **Find where change hurts.** Ask of recent or likely changes: how many places must be touched? Files that always change together but live far apart, or single files that change for unrelated reasons, mark the real problems.
3. **Diagnose against the checklist below.**
4. **Recommend minimally.** Each recommendation: the problem, the concrete evidence (files/modules), the smallest fix, and what it unblocks. Order by pain relieved per effort. Explicitly list what should be left alone.

## Checklist

**Duplication**
- Same business rule or knowledge implemented in multiple places (the dangerous kind — they drift apart).
- Copy-paste variants of one workflow differing only in details that should be parameters.
- Do not flag incidental similarity between things that change for different reasons; merging those creates coupling, not reuse.

**Single responsibility**
- Modules or classes that change for unrelated reasons (e.g., a "service" doing validation, persistence, formatting, and notifications).
- God objects most of the codebase imports; files disproportionately large for their layer.

**Layering & dependencies**
- Lower layers importing upward (domain logic importing web/UI types; persistence importing controllers).
- Business rules trapped inside framework artifacts (controllers, handlers, views) where they can't be tested or reused.
- Circular dependencies between modules.
- Leaky boundaries: raw database rows, ORM entities, or wire DTOs flowing through layers that shouldn't know them.

**Coupling & cohesion**
- Feature logic scattered across layers such that one feature change touches every layer folder ("shotgun surgery").
- Shared mutable state or implicit ordering between modules.

## Constraints

- Respect the project's existing architectural style; recommend making it consistent before recommending replacing it.
- Every proposed step must leave the system working — no recommendation may require a big-bang migration.
- If the architecture is sound, say so; do not manufacture findings.
