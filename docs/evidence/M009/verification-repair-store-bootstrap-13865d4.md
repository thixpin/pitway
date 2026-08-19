# M009 — Post-Completion Bootstrap Fix (commit `13865d4`)

Compiled 2026-08-20, discovered running `pitway milestone-complete M009` after all six of M009's
tasks had already completed and every verification check (CT001-CT008) had passed. A standalone,
trailer-less commit exception, developer-approved, mirroring M008's own `6f8b5e6`/`ed119ed`
precedent exactly.

## What happened

`milestone-complete M009` failed with an unhandled `StateStoreError` wrapping `ENOENT`:
`loadVerificationRepairs` (`src/state/store.ts`, added by T002) tried to read
`.pitway/milestones/M009-lifecycle-corrections-and-quick-change/verification-repairs.yaml`, which
did not exist.

## Root cause

`verification-repairs.yaml` is initialized only by `createMilestone`/`replaceMilestoneDraft`
(`src/core/milestones/create.ts`), a change T002 itself added. M009's own draft was materialized
via `milestone-add` **before** T002 completed — the same self-referential bootstrap timing already
disclosed for M005 ("M005 itself is the transition milestone... this model only becomes usable
partway through M005") and M006 ("M006's own confirm necessarily happened through the pre-existing,
non-interactive `milestone-confirm` command"). `complete.ts`'s new `assertNoPendingVerificationRepair`
gate (also T002) then crashed instead of refusing cleanly, because `loadVerificationRepairs` had no
tolerance for a milestone predating the file's own existence.

## Why this could not go through `verification-repair` itself

`verification-repair approve` (the mechanism built specifically for exactly this lifecycle window —
tasks complete, not yet `milestone-complete`d) **also** calls `loadVerificationRepairs` internally,
to check for an already-pending repair before allocating a new one. It hit the identical `ENOENT`.
The mechanism could not be used to fix its own prerequisite — a genuine bootstrap circularity, not
a design flaw in the mechanism itself (every milestone created *after* M009 will always have this
file; only M009's own pre-T002 materialization is affected, and it can never recur).

## The fix

`loadVerificationRepairs` now checks `existsSync` first: a **missing** file (ENOENT specifically,
checked structurally via `existsSync`, never inferred from a caught error's message) returns an
empty, schema-valid `{schema_version: 1, records: []}` store — the same additive-optional/
grandfathered-migration tolerance already established elsewhere in this codebase (`mapped_ac_ids`
absent on pre-M007 tasks; bare M001-M005 milestone directories predating M006's slug support). A
file that genuinely exists but is malformed YAML, fails schema validation, or can't be read for any
other reason (a directory at that path in the added regression test, standing in for any non-ENOENT
I/O failure) still fails visibly through the exact same `loadYaml`/`readText` path every other
per-milestone file already uses — the tolerance is scoped to "file absent," nothing broader.

## Verification

Four new focused unit tests (`tests/unit/state-store.test.ts`): missing file → empty store; a
genuinely existing store still round-trips (not masked by the tolerance path); malformed YAML still
throws `StateStoreError` naming the file; a non-ENOENT read error (path is a directory) still throws.
`npm test -- tests/unit/state-store.test.ts` → 37/37 passed. `npx tsc --noEmit` → clean. Full suite
(`npm test`) → 698/698 passed. Diff staged and committed as exactly two files:
`src/state/store.ts` and `tests/unit/state-store.test.ts` — nothing else.

## Why this landed as a standalone, trailer-less commit

Every one of M009's six tasks was already `completed` when this was found. No task's `write_scope`
could receive the fix, and — unlike M008's own `6f8b5e6` — `verification-repair` itself could not
either, since it shares the exact same broken dependency. The developer explicitly approved one
narrow exception: commit `13865d4 fix(workflow): bootstrap missing verification repair store`,
scoped to exactly the two files above, carrying no `PitWay-Task` trailer since no task owns it.

## Carried forward

No new workflow gap is recorded here — this is a one-time, non-recurring bootstrap artifact of
M009's own self-referential timing (the same category as M005's and M006's own disclosed bootstrap
caveats), not a design defect requiring a future milestone. `verification-repair`'s own design
remains correct for every milestone created after M009.
