# M008 — Post-Completion Verification Repair (commit `6f8b5e6`)

Compiled 2026-08-19, after all five of M008's tasks had already completed. Durable evidence for a
finding and a one-time, developer-approved exception that `reports/M008.md` (untracked, gitignored,
non-authoritative) also discloses — this file is the clone-durable record of the same facts.

## What happened

The first real `pitway verify M008` run, executed after T001–T005 were all `completed`, failed
CT008 (`npm test`, the full suite) with `MODULE_NOT_FOUND` for `dist/cli/index.js`, surfaced from
`tests/integration/completed-task-revision-path.test.ts` — an M007 test, untouched by M008. An
isolated rerun of just CT008 passed.

## Root cause — supersedes an earlier, incorrect hypothesis

The shape of the failure (transient, full-suite-only, not reproducible in isolation) initially
resembled M006's disclosed CT012 environmental flakiness — no specific mechanism, load-sensitive.
**That hypothesis is superseded.** The actual, directly reproduced cause: `tests/integration/
build-bin.test.ts` and `tests/integration/npm-pack.test.ts` (both new in M008) both referenced the
shared repository `dist/` directory. `npm-pack.test.ts`'s `beforeAll` deleted and rebuilt that same
`dist/` to exercise a clean-state `prepack` lifecycle, racing against `build-bin.test.ts`'s
concurrent subprocess spawns of `dist/cli/index.js` under Vitest's normal parallel file execution.
This is a specific, genuinely reproducible bug in M008's own two new test files — not inherited
flakiness, and not the same category as M006's CT012 finding. No already-completed task result or
milestone evidence (T001–T005's own results, M006/M007's own report/evidence files) was edited to
reflect this correction; it lives only here and in the fix commit.

(Also recorded here so it is not silently reused: M007's earlier suggestion to compare
`pool: 'forks'` against a default, or to tune `poolOptions.forks.maxForks`, was stale for the
Vitest 4 already in use — `pool` already defaults to `'forks'`, and `poolOptions.forks.maxForks`
has been replaced by `maxWorkers`. Neither was relevant to this bug; the fix is isolation, not
worker-pool tuning.)

## The fix

`npm-pack.test.ts` now builds and packs from its own isolated temporary staging copy — its own
`mkdtemp`'d directory containing copies of `src/`, `scripts/`, and the package manifests, plus a
**symlinked** `node_modules` (copying it would be slow and is unnecessary — this test never writes
into it) — and never touches the shared repository `dist/` at all. Verified before trusting it:
`fs.rmSync(dir, { recursive: true })` on a directory containing a symlink unlinks only the symlink
entry, never follows it into deleting the real target (independently reproduced in a sandboxed
directory before relying on it in this test's `afterAll`). Verified after the fix: the two
previously-racing test files pass together 5/5 repeated rounds; the full suite passes twice
(586/586 both times) with zero surviving processes; a fresh `pitway verify M008` reruns CT008
cleanly.

## Known caveat, disclosed rather than fixed: Windows symlink privilege

The fix's use of `fs.symlinkSync(nodeModulesPath, stagingPath, 'dir')` is a real, disclosed
portability gap, not a claimed cross-platform guarantee. On Windows, creating a symbolic link
(as opposed to a junction) requires either Administrator privileges or Developer Mode enabled
(`SeCreateSymbolicLinkPrivilege`) — an unprivileged, non-Developer-Mode process gets `EPERM`. This
repository's own precedent already treats Windows portability as a real constraint elsewhere
(`scripts/copy-claude-assets.mjs` was written as a Node script specifically because a shell
`cp -r` "is not cross-platform," per AC001). `npm-pack.test.ts`'s isolated-staging fix has not been
run or verified on Windows, and this document makes no claim that it works there — it is disclosed
as a known limitation of this specific test-harness change, carried forward rather than silently
assumed away, matching the same honesty discipline this milestone's AC002 already applies to the
registry boundary and AC004 applies to read-enforcement claims.

## Why this landed as a standalone, trailer-less commit

Every one of M008's tasks was already `completed` when this was found; there was no active,
`in_progress` task whose `write_scope` could receive the fix the way M007/AC004's ripple-fix
policy assumes (that policy presumes a *discovering task* still in flight), and no supported
PitWay command exists to reopen a completed task or otherwise repair a completed milestone's
verification. The developer explicitly approved one narrow exception: commit `6f8b5e6
test(packaging): isolate npm pack build output`, scoped to exactly one file
(`tests/integration/npm-pack.test.ts`), carrying no `PitWay-Task` trailer since no task owns it.

This gap — no supported verification-repair path once a milestone's task graph is already fully
completed but the milestone itself is not yet `milestone-complete`d — is carried forward as a
future workflow candidate, not designed or implemented here (see this session's memory record and
`reports/M008.md`).

## Verification history — preserved append-only

CT008's `verification-results.yaml` entries were never overwritten or edited: `fail`
(2026-08-19T15:08:53Z, the original shared-`dist/` race), `pass` (2026-08-19T15:12:27Z, the
isolated retry — a real pass, but won on the strength of a race not yet fixed), `pass`
(2026-08-19T15:23:26Z, the first fresh full run after the real fix landed), and a further `pass`
recorded on the milestone's final pre-completion verification run. The latest entry is
authoritative by position, the same convention already established throughout M006/M007.
