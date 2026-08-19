# M007/AC005 — Lightweight Quick-Change Workflow: Design Decision

Compiled 2026-08-19, as part of T005. A design only — no implementation regardless of the
decision below (AC006's Adaptive Workflow Intensity decision governs which workflow tiers exist,
and a brand-new mechanism cannot itself supply real usage evidence before it's built).

## Worked example: commit 85fa243

`85fa243` (`chore: ignore local workflow reports`) is the concrete case motivating this design: a
genuinely tiny, legitimate, between-milestone repository-maintenance change (a one-line
`.gitignore` normalization) with no supported PitWay-attributed path — no contract, no task, no
`PitWay-Milestone`/`PitWay-Task` trailer applies to a change with no milestone. **Is it the kind of
change quick-change is meant to cover?** Yes, precisely — it is small, bounded, needed an explicit
objective and a trivial verification step (confirm the ignore rule actually takes effect via `git
check-ignore`), and one atomic commit. **What would a `PitWay-Change`-trailed version have looked
like under this design's lifecycle?** `quick-change create --objective "..." --scope .gitignore
--verify "git check-ignore -v reports/M005.md reports/M006.md"`, then `quick-change approve`
(developer confirms objective/scope/verification command before anything executes — the same
approval gate milestones already require), then `quick-change run` (executes exactly the approved
verification command, nothing else), then `quick-change commit` — producing a single commit with
message `chore: ignore local workflow reports` plus a `PitWay-Change: <change-id>` trailer, where
`<change-id>` is a short content-derived slug (not a milestone id, since none exists).

## Design specification

**Lifecycle:** `draft -> approved -> committed`, with `draft|approved -> cancelled` and `approved
-> promoted` (before commit) — never a transition out of `committed`, mirroring the task state
machine's `completed` terminality.

**Approved-verification handling:** the verification command is declared at `create` time and
explicitly approved at `approve` time — hashed and gated exactly as `verification_approved_hash`
gates `pitway verify` today (`loadApprovedContract`'s pattern, reused conceptually, not
literally). `quick-change run` refuses to execute anything that doesn't match the approved hash —
an arbitrary, unapproved command can never run under this mechanism, the same guarantee milestone
verification already provides.

**State/journal storage:** a new top-level journal kind, `quick_change`, sibling to
`entry`/`checkpoint`/`auto_run` — never folded into a checkpoint commit, structurally excluded
from `derivePending`/`resolveTargetPath`/checkpoint-folding by type signature alone, mirroring
M006/AC009's `auto_run` pattern exactly (a dedicated regression test would assert this the same
way `auto_run`'s does).

**Crash recovery:** an in-flight quick-change is discoverable via `pitway resume` (extended to
report a pending quick-change alongside milestone state) or a new `quick-change status` — the
same repo/worktree-local durability class as `auto-run`: persists across sessions within this
repository, does not survive `.git` deletion or a fresh clone.

**Commit identity:** a `PitWay-Change: <change-id>` trailer, parallel to
`PitWay-Milestone`/`PitWay-Task`, resolved by re-reading committed content the same way — no SHA
ever persisted in state (decision 4, unchanged).

**PitWay-Change trailer lookup:** a resolver scoped only to `quick_change` journal records,
analogous to `resolveTargetPath` but a distinct function, never touching or being touched by it.

**Cancellation:** `quick-change cancel` appends a new journal record, never rewrites or deletes a
prior one, never touches a commit that already landed.

**Promotion-to-milestone:** an explicit `quick-change promote` command, triggered when scope or
risk expands beyond the declared bounded scope, converting the quick-change into a milestone draft
referencing its original objective — never automatic, never silent.

**Exact anticipated file census** (for a future implementation task, if adopted):
`src/state/schemas.ts`, `src/state/journal.ts`, `src/core/quick-change/create.ts`,
`src/core/quick-change/run.ts`, `src/core/quick-change/commit.ts`,
`src/core/quick-change/promote.ts`, `src/cli/commands/quick-change.ts`, `src/cli/index.ts` (one
new registration line), plus `tests/unit/quick-change-*.test.ts` and
`tests/integration/quick-change.test.ts`.

**Safety invariants:** clean-tree-at-start, one atomic commit, no unapproved commands — identical
to the milestone workflow, by design, not by coincidence.

## Recommendation

**Defer.** This design is now fully specified and ready to implement whenever adopted, but the
evidence for adopting it *now* is exactly one real case (`85fa243`) across the entire M001-M007
history to date. Building a new journal kind, six new source files, and a new top-level CLI
command for a pattern observed once is ahead of the evidence this milestone's own objective states
it exists to require ("these decisions are not made speculatively ahead of real usage evidence").
Ad hoc handling (a plain commit, no trailer, disclosed and reviewed the same way every standalone
hotfix this session was) worked without incident for `85fa243` itself. The honest recommendation
is: wait for a small number of further real, tiny, non-milestone changes to accumulate (a
qualitative threshold, not a hard number — but more than one) before committing to new Core/CLI
surface, rather than building ahead of a pattern that has not yet repeated.

**Decision:** Defer, as recommended. The design above is preserved complete and ready to
implement — no implementation now, and no specific later milestone is scheduled yet. Revisit after
at least three legitimate tiny-change cases accumulate across multiple milestones, or when
repeated unattributed maintenance commits create a measurable traceability problem — whichever
threshold is reached first, not on a fixed schedule.
