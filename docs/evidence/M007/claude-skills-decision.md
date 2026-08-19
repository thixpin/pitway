# M007/AC009 — Explicit Task-Specific Claude Skills: Decision

Compiled 2026-08-19, as part of T008. Decided **autonomously** under the tiered Decision Authority
Policy (AC013 clause 6) — evidence-backed, documentation-only, no code/schema/CLI change, no
mechanism adopted or scheduled.

## Open design questions, resolved

1. **Does `claude-assets.ts`'s existing glob pick up a nested `SKILL.md` with zero installer
   changes?** **Yes — verified by direct inspection, not assumed.** `listMarkdownAssets`
   (`src/state/claude-assets.ts`) recursively walks every directory under
   `src/integrations/claude/` and collects any file ending in `.md`, filtered only by extension —
   a `SKILL.md` at `src/integrations/claude/skills/<name>/SKILL.md` would be discovered and
   installed automatically, with zero changes to the installer.
2. **Does a task gain a new field naming its required skill(s), with visible dispatch-time
   failure when missing?** Not resolved to a concrete schema design here — this requires deciding
   a field name, its interaction with `write_scope`/`context_files`, and where the dispatch bundle
   generator (`task-status --context --json`) would validate it. Genuinely open.
3. **Which installation strategy (project-local / reference-only / both)?** Not decided — the
   session notes this candidate finding drew from lean toward project-local (consistent with
   PitWay's deterministic-process principle) but this was never tested against real usage.
4. **Behavioral comparison (skill-enabled vs. skill-free dispatch)?** Not measured — no skill has
   ever been built or dispatched in this repository, so there is nothing to compare yet.

## Recommendation and decision

**Defer.** Question 1 is resolved and durable (a real, re-verifiable fact about the installer that
does not change with more evidence). Questions 2-4 remain genuinely open design work, and — more
importantly — **zero skills have ever existed or been dispatched in this repository**: there is no
usage evidence to measure a behavioral comparison against, the same evidentiary gap AC005's
quick-change design hit (deferred there for the same reason). Building schema/installer/dispatch-
validation plumbing for a mechanism with zero real usage would be speculative, not evidence-based
— directly contrary to this milestone's own stated purpose. github.com/thixpin/claude-config
remains a validated reference for *how* to build this later (reviewed firsthand this session:
README.md, CONTRIBUTING.md, `skills/bug-fix/SKILL.md` all fetched and read verbatim), but adopting
it now would be ahead of the evidence.

**Decision:** Defer. No skills implementation, schema field, or installer change lands in this or
any scheduled milestone. Question 1's finding (glob pickup works with zero installer changes) is
preserved as durable design input for whenever this is revisited. Revisit when a concrete,
motivating use case for a specific skill exists — not on a fixed schedule.
