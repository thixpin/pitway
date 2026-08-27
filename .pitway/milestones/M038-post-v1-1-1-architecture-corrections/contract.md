---
schema_version: 1
id: M038
title: Post-v1.1.1 Architecture Corrections
status: completed
requirement: null
confirmed_at: 2026-08-27T15:47:34Z
verification_approved_hash: sha256:ddca97e49f4f4c6123433fba9e5fcbf8a04545ba4aff853cd4359bcebdf26999
base_branch: main
base_revision: 193f0cfd28b67d1d2f8445d56c00b4820c99f991
acceptance_criteria:
  - id: AC001
    text: The canonical shared body of every command doc exists once, under
      src/integrations/common/commands/<name>.md, in the description-only
      quoted-frontmatter shape codex and opencode already use. The
      src/integrations/codex/ and src/integrations/opencode/ directories contain
      no command docs (they resolve entirely to common/). A driver whose
      frontmatter genuinely differs may retain its own whole-file override copy
      -- today only Claude Code (argument-hint), under
      src/integrations/claude/commands/ -- and each such override's body is
      byte-identical to its common/ counterpart.
  - id: AC002
    text: The resolved asset set, resolved source content, and destination paths for
      all three drivers are unchanged in bytes and in path layout from v1.1.1 --
      pitway init for any driver installs identical files, a repo initialised on
      v1.1.1 reports no configuration drift after the move, and the existing
      driver-asset resolution mechanism (resolveAssetSourceFromDirs,
      driver-wins-then-common) is reused with no change to
      src/state/driver-assets.ts's lookup rule.
  - id: AC003
    text: The parity tests are rewritten to pin the new invariant rather than the
      old layout -- for every common/commands/<name>.md a claude override exists
      whose body is byte-identical and whose description matches; the ms-*
      aliases stay byte-identical to their milestone-* counterparts in common/;
      codex/opencode resolve every command doc to common/; the pinned-sha256
      migration manifest for claude/common content still passes unmodified; the
      build copy step and build-bin test tolerate a driver directory that no
      longer exists.
  - id: AC004
    text: src/state/journal.ts no longer imports from src/core/, and no module under
      src/core/journal/ is imported by src/state/ -- the pure journal helpers
      (derivePending, buildJournalEntry, resolveTargetPath,
      JournalValidationError) live in the State layer with identical behavior,
      and every existing importer (src and tests) is updated to the new path.
  - id: AC005
    text: src/git/safety.ts imports nothing from src/state/ or src/core/. Its
      journal-aware classification takes already-resolved repo-relative target
      paths as an input option; the journal read, pending derivation, and
      milestone-directory resolution move into one Core helper that every former
      journalMilestone caller (tasks/update.ts, tasks/verify.ts,
      tasks/integrate.ts, milestones/complete.ts) uses. Classification results
      for every existing scenario (pending entry for the milestone, pending
      entry for an unrelated milestone, checkpointed entry, unresolvable
      milestone directory, root-level backlog.yaml target) are unchanged.
  - id: AC006
    text: Focused tests prove the relocated behavior unchanged -- the existing
      derivePending / buildJournalEntry / resolveTargetPath / reconcilePending
      unit tests pass against the new State-layer module; the git-safety
      classification tests pass with target paths supplied directly; a new unit
      test covers the Core helper's pending-target resolution for the same
      scenarios the old safety.ts branch handled; and an import-direction test
      asserts state/journal.ts and git/safety.ts have no upward imports.
  - id: AC007
    text: Documentation that describes the driver-asset layout or the layering
      boundary is updated to match -- AGENTS.md's driver-asset sentence, the
      README driver section, and the header comments in
      src/state/driver-assets.ts, src/state/claude-assets.ts,
      scripts/copy-claude-assets.mjs, src/git/safety.ts, and the relocated
      journal helper module -- with no stale claim that command docs live per
      driver or that safety.ts depends on the State layer.
  - id: AC008
    text: Every CLI command's human and --json output is byte-for-byte unchanged,
      and every pre-existing test's asserted output is unchanged except where
      AC001-AC007 deliberately replace a layout-pinning assertion with its
      successor. Full suite and typecheck pass.
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npx vitest run tests/unit/claude-assets.test.ts
      tests/unit/codex-assets.test.ts tests/unit/opencode-assets.test.ts
  - id: CT002
    criterion: AC002
    type: command
    command: npx vitest run tests/integration/multi-driver-assets.test.ts
      tests/integration/init.test.ts tests/integration/build-bin.test.ts
  - id: CT003
    criterion: AC003
    type: command
    command: npx vitest run tests/unit/claude-assets.test.ts
      tests/unit/codex-assets.test.ts tests/unit/opencode-assets.test.ts
      tests/integration/multi-driver-assets.test.ts
      tests/integration/build-bin.test.ts
  - id: CT004
    criterion: AC004
    type: command
    command: npx vitest run tests/unit/journal.test.ts tests/unit/backlog-state.test.ts
  - id: CT005
    criterion: AC005
    type: command
    command: npx vitest run tests/unit/git-safety.test.ts
      tests/integration/task-update.test.ts
      tests/integration/task-verify.test.ts
      tests/integration/milestone-complete.test.ts
  - id: CT006
    criterion: AC006
    type: command
    command: npx vitest run tests/unit/journal.test.ts tests/unit/git-safety.test.ts
  - id: CT007
    criterion: AC007
    type: review
    instruction: Read AGENTS.md, README.md's driver section, and the header comments
      of src/state/driver-assets.ts, src/state/claude-assets.ts,
      scripts/copy-claude-assets.mjs, src/git/safety.ts, and the relocated
      journal helper module. Confirm none still claims command docs live per
      driver, or that safety.ts depends on the State/Core layers.
  - id: CT008
    criterion: AC008
    type: command
    command: npm run typecheck && npm test
    timeout_ms: 900000
---

# Contract

## Objective

Land the two highest-priority findings of the post-v1.1.1 architecture
review as corrective, behavior-preserving changes:

1. **Driver command docs are triplicated.** 96 files under
   `src/integrations/{claude,codex,opencode}/commands/`; codex and opencode
   are byte-identical, claude differs only by frontmatter, and the `ms-*`
   aliases double it again — one conceptual command-doc edit touches six
   files, with nothing but a parity test to catch drift. The
   driver-overrides-common lookup that would remove the duplication
   already exists in `src/state/driver-assets.ts` and is exactly the
   mechanism AGENTS.md sanctions; it is simply not used for command docs.
2. **Two upward edges violate the declared `CLI → Core → State + Git`
   layering.** `src/state/journal.ts` imports pure helpers from
   `src/core/journal/operations.ts`, which type-imports back (a State↔Core
   cycle); and `src/git/safety.ts` reads the journal and resolves milestone
   directories itself, reaching into both State and Core to do so.

Both are consistency fixes within the architecture the repo already
declares. Nothing here redesigns a boundary, changes a state machine, or
alters any CLI output.

## Scope

- **T001 — Driver command docs.** Move each shared command-doc body to
  `src/integrations/common/commands/<name>.md` in the description-only
  quoted-frontmatter shape codex/opencode already ship. Delete the
  now-redundant codex/ and opencode/ command docs (their directories
  disappear entirely). Keep `src/integrations/claude/commands/` as the one
  set of full-file overrides, because the static lookup is file-level and
  Claude Code's `argument-hint` frontmatter is a real UX difference. Rewrite
  the parity tests to pin the new invariant (claude override body ≡ common
  body); make the build copy step and `build-bin` test tolerate a missing
  driver directory. Before changing anything, run the existing asset and
  parity tests green and record the resolved-asset manifest for all three
  drivers so the post-move result can be diffed against it.
- **T002 — Layering.** (a) Move `derivePending`, `buildJournalEntry`,
  `resolveTargetPath`, and `JournalValidationError` from
  `src/core/journal/operations.ts` into a State-layer module and update
  every importer; delete the Core module rather than leaving a re-export
  shim. (b) Replace `classifyDirtyPaths`' `journalMilestone` option with an
  option that accepts already-resolved repo-relative target paths; add one
  Core helper that performs the journal read + pending derivation +
  milestone-directory resolution (including the existing swallow-on-
  unresolvable-directory behavior) and have all five call sites use it.
  `src/git/safety.ts` ends with imports from `./exec.js` only.
- **T003 — Documentation.** Update the layout/layering statements listed in
  AC007 after T001 and T002 land. Regenerate any pinned common/claude asset
  hash that a doc change under `src/integrations/` invalidates (none is
  expected — T001 moves files without editing bodies).
- **T004 — Final gate.** `npm run typecheck && npm test` as the milestone's
  closing verification, run after T001–T003.

T001 and T002 touch disjoint files and are independently executable; T003
depends on both; T004 depends on T003.

## Non-Goals

- The lower-priority review findings: extracting `buildResumeView` /
  `buildMilestoneStatusView` into Core, the racing-footer helper, and the
  `core/tasks/update.ts` split. These are tracked separately via the
  backlog, not here.
- Any change to the driver-asset lookup rule, the `DRIVERS` list, install
  destinations, drift detection, or `pitway init` behavior. If T001 finds
  it needs a lookup-rule change, that is a scope conflict: stop and propose
  a Change Log entry.
- Merging or generating frontmatter per driver at install time. The lookup
  stays a static whole-file override; Claude Code's 32 overrides remain
  whole files.
- Changing what `classifyDirtyPaths` classifies as expected or unexpected,
  or any of its binding semantics — only where the journal-derived paths
  are computed moves.
- Any edit to command-doc bodies, protocol docs, or skills. T001 relocates;
  it does not reword.
- Version bump, CHANGELOG entry, or release preparation.

## Change Log

- 2026-08-27: Draft created from the post-v1.1.1 architecture review
  (findings 1 and 2 of 5; findings 3–5 deferred to backlog).
