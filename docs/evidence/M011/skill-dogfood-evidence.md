# M011 Skill Dogfood Evidence

Compiled 2026-08-20, T007. Recorded per M011/AC007: a real comparative dogfood test of one
vendored skill (`architecture-review`), mirroring M006/AC005's and M007's own model-held-constant
methodology, with the four validity requirements AC007 makes binding.

## Non-bootstrap gap (disclosed up front, per M007/M008 precedent)

M011's own `tasks.yaml` is drafted and confirmed before T003 lands `required_skills` in this
repository's own validation code, so no task in M011's own graph — including this one — could
declare `required_skills` on itself. This comparison is therefore a standalone, auxiliary
dispatch built specifically for this evidence, not a real M011 task exercising the pre-dispatch
gate. The skill-loaded run below loads its skill through the dispatching harness's own skill
mechanism directly (the same live, manual mechanism this session already used for two
architecture-review contract passes earlier in M010/M011's own drafting). This demonstrates only
whether loading a vendored skill's content changes a dispatched worker's real output — it is not
a demonstration of AC003's own pre-dispatch context gate, which is covered exclusively by AC003's
own tests.

## Rubric (written before either dispatch ran)

**Bounded task, identical prompt text for both dispatches:**

> Review the structural design of `src/state/managed-init-paths.ts` and its two call sites
> (`src/core/quick-change/create.ts`, `src/core/quick-change/commit.ts`) in the PitWay repository
> at `/Users/thixpin/project/thixpin/pitway`. This is a read-only investigation — do not edit,
> create, or delete any file. Report: (1) how these modules/layers relate and what depends on
> what; (2) any structural issues you find (duplication, layering, coupling, single-responsibility
> concerns); (3) up to 3 concrete, minimal recommendations, each naming the problem, the concrete
> evidence (files/modules), and the smallest fix — or explicitly state that the design is sound if
> you find no real issues. Keep your report under 400 words.

**Model/config held constant:** both dispatches use the `Agent` tool with `subagent_type:
"general-purpose"` (a fresh session, no inherited conversation context), no `model` override on
either call — both inherit the same session-resolved model. Neither dispatch names or references
the other.

**Comparison checklist**, grounded in `architecture-review`'s own documented method
(`src/integrations/claude/skills/architecture-review/SKILL.md`), decided before either report was
read:

1. **Map before judging** — does the report state the modules/layers and their dependency
   relationships *before* diagnosing problems (the skill's own step 1), rather than jumping
   straight to a findings list?
2. **Checklist-shaped findings** — are findings organized under the skill's own named categories
   (Duplication / Single responsibility / Layering & dependencies / Coupling & cohesion), rather
   than an unstructured list?
3. **Recommendation shape** — does each recommendation name the problem, concrete evidence
   (files/modules), and the smallest fix (the skill's own step 4), rather than a vague suggestion?
4. **"Say so if sound"** — does the report explicitly state whether the architecture is sound
   instead of manufacturing findings to fill space (the skill's own explicit constraint)?

Each item scored PASS/FAIL per run from the report text alone (never inferred from anything else,
including the driver's own knowledge of the skill).

## Validity requirements (2) and (3)

**(2) Read-only.** The bounded task requires no file write — a review/investigation task only. No
`write_scope` was involved.

**(3) Fresh-context, mutually isolated.** Both dispatches were issued as two separate `Agent` tool
calls in one message (parallel, non-chained) — neither run's prompt referenced the other run,
named the comparison being conducted, or could see the other's output, since sub-agent transcripts
are not shared across sibling dispatches.

---

## Results

### Artifact-verified facts

These are backed by something the harness itself produced, quoted or checked directly against
ground truth below — not merely asserted.

**(4) Concrete loading evidence.** The skill-loaded run's report opened with:

> "Judge structure by how safely the system can change, not by resemblance to a textbook
> pattern... Recommend the smallest set of moves that improves changeability; never propose a
> rewrite when an incremental path exists."

This is checked, byte-for-byte (modulo the run's own mid-sentence elision), against
`src/integrations/claude/skills/architecture-review/SKILL.md`'s actual first paragraph: *"Judge
structure by how safely the system can change, not by resemblance to a textbook pattern. Recommend
the smallest set of moves that improves changeability; never propose a rewrite when an incremental
path exists."* — an exact match. This project-specific text does not exist anywhere else and is
not the kind of phrasing a model would independently reconstruct verbatim, so this is treated as
genuine confirmation the Skill tool was invoked and its content actually reached the run's context
— not merely a driver-trusted claim.

**Runtime-reported token cost** (per-dispatch, from each agent's own `<usage>` block, never
estimated):

| Run | Tokens | Tool uses | Duration |
|---|---|---|---|
| Skill-loaded | 46,889 | 12 | 59.3s |
| Baseline (no skill) | 53,081 | 18 | 101.4s |

**Rubric-scored comparison** (each item scored from the report text alone):

| # | Checklist item | Skill-loaded | Baseline |
|---|---|---|---|
| 1 | Maps dependencies before diagnosing | PASS — explicit "1. Relationships" section precedes findings | PASS — same structure |
| 2 | Findings organized under the skill's own named categories (Duplication/Single responsibility/Layering & dependencies/Coupling & cohesion) | FAIL — findings are lettered (a)/(b)/(c), not mapped to the skill's own category headings | FAIL — same shape, bolded ad hoc headings, not the skill's own category names |
| 3 | Each recommendation names problem + concrete evidence + smallest fix | PASS, though evidence is referenced implicitly (points back to section 2) rather than re-cited per recommendation | PASS, more rigorously — explicitly labels a separate "Evidence:" line per recommendation, closer to the skill's own wording |
| 4 | Explicitly says whether the architecture is sound, rather than manufacturing findings | Partial PASS — states "No issue there" for the module itself and explicitly marks one item "Leave alone", but never states the overall verdict in the skill's own words | PASS — explicitly states "...is sound", the skill's own exact term |

**Content overlap.** Both runs independently found the *same* two real structural issues (a split
`QuickChangeError` class identity between `create.ts` and `run.ts`, and a byte-identical
`requireQuickChange` helper duplicated across three files) and made materially the same two
recommendations, with the same third "leave alone" call on the already-documented dirty-path-diff
duplication pattern.

### Driver-attested facts (not independently provable from this document)

The rubric's own (1) and (3) — that the rubric was genuinely written before either dispatch ran,
and that the two dispatches were genuinely independent/non-chained with no cross-visibility,
including the actual order the two `Agent` tool calls were issued in — are stated here only as
driver-attested: both `Agent` calls were issued in a single message in this session, before either
result was read, and the git history of this evidence file's own commit timestamps supports but
does not independently prove that ordering. Neither claim is re-asserted as artifact-verified
above.

### Outcome, reported honestly

**Net result: negative / null for this single comparison.** Loading `architecture-review` did not
produce a measurably more structured or more thorough report than the baseline run on this bounded
task — the two runs found the same real issues, made the same recommendations, and the baseline
actually scored marginally *better* on rubric items 3 and 4 (more explicit per-recommendation
evidence labeling, and the skill's own exact "sound" wording used verbatim). The skill-loaded run
did use meaningfully fewer tokens and tool calls (46,889 vs 53,081; 12 vs 18), consistent with the
skill's own "map before judging" method providing a more direct investigation path — a real,
measured cost difference, distinct from the (unconfirmed) thoroughness/structure hypothesis.

This is a single trial per condition (n=1), not a statistically powered comparison — it cannot
support a general claim that this skill has no effect, only that it had no clearly measurable
structural/thoroughness effect *on this one bounded task*, mirroring M006/AC005's own precedent of
reporting a raw-cost finding candidly rather than omitting or reframing it.
