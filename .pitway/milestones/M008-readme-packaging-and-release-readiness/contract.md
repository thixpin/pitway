---
schema_version: 1
id: M008
title: README, Packaging, and Release Readiness
status: in_progress
requirement: null
confirmed_at: 2026-08-19T14:37:51Z
verification_approved_hash: sha256:07eb19bd66ff464c3b47437d39db93af3e402f47aed6a0adb7fa98f00181d143
acceptance_criteria:
  - id: AC001
    text: "A real build step exists and produces a genuinely npm-installable,
      real-subprocess-invokable `pitway` binary — closing the M004/T007 finding
      named in IMPLEMENTATION_PLAN.md's Revised Roadmap: Node's native TS loader
      does not remap this repository's `.js` import specifiers to `.ts` sources,
      so `package.json`'s current `bin` (`./src/cli/index.ts`, executed
      directly) fails with `ERR_MODULE_NOT_FOUND`. **Build tool: `tsc`, the
      existing devDependency, preferred over introducing a new bundler
      dependency — this is low-risk specifically because this repository's
      source already writes every relative import with a `.js` specifier
      (NodeNext-style, anticipating a compiled sibling), so `tsc`'s emitted
      output resolves those same specifiers against its own real emitted `.js`
      files with no rewriting needed; evidence otherwise required before
      choosing differently.** The current `tsconfig.json` sets `noEmit: true`
      and must not be flipped in place (it is also the typecheck/test
      configuration); a new, separate `tsconfig.build.json` (extending
      `tsconfig.json`, overriding `noEmit: false` and `outDir: dist`) is the
      emit configuration. Compiling TypeScript alone is insufficient:
      `src/integrations/claude/` currently holds 20 Markdown files and zero
      `.ts` files — `tsc` does not copy them — so a cross-platform Node script
      (`scripts/copy-claude-assets.mjs`, never a shell `cp -r`, which is not
      cross-platform) copies every file under `src/integrations/claude/` to
      `dist/integrations/claude/`. **The script discovers files recursively at
      run time (mirroring `claude-assets.ts`'s own `listMarkdownAssets` walk) —
      it never hard-codes the current 20-file count or an enumerated file
      list**, so a later task adding a new asset under
      `src/integrations/claude/` (e.g. a future skill, per the M007-deferred
      candidate) is copied automatically with no change to this script, the same
      glob-not-a-list guarantee `claude-assets.ts` already gives the installer.
      Copying preserves the exact relative layout `claude-assets.ts`'s own
      `assetsSourceDir` (resolved via `import.meta.url` relative to the compiled
      module's own location) requires to keep resolving correctly
      post-compilation. `package.json` gains a `build` script running both steps
      (`tsc` emit, then the copy script) and a `prepack` script running `build`
      — so a clean clone with no pre-existing `dist/` still produces a valid,
      installable package (AC002). `bin` points at the compiled entry point
      (`dist/cli/index.js`) with a working shebang. Every one of the 14 existing
      commands, `--json` output, and exit codes are preserved unmodified through
      the build — proven by a real subprocess spawn of the built `dist/`
      artifact (never `npx tsx`, never `node --experimental-*` flags) that
      individually confirms **all 14 commands are registered and reachable**
      (not inferred from `--help` text or a single command alone, mirroring
      M004/T007's own per-command reachability discipline, now against the real
      compiled output) plus one real state-mutating round trip (`init` in a
      throwaway temp repo) that confirms the copied Claude assets are actually
      installed by default."
  - id: AC002
    text: "npm packaging metadata is complete, explicit, and validated by a real
      automated packaging check — never left to defaults, never validated only
      against the unpacked `dist/` tree. Every one of the following is addressed
      as a stated decision with reasoning, not a silent default: `name`
      ('pitway', unscoped — re-verified as still unclaimed on the real npm
      registry at task-execution time, since the 2026-08-18 check recorded in
      IMPLEMENTATION_PLAN.md §17 is now stale and is not treated as
      authoritative; if the name is claimed or ambiguous at check time, this
      task stops for an explicit developer decision — it never renames the
      package automatically); `version` (an explicit choice, e.g. staying at a
      pre-release `0.x` marker appropriate for a first public release, stated
      with a reason rather than silently inherited); `files` (an explicit
      allowlist — the compiled `dist/` output plus this milestone's decided
      documentation/license files, never the full `src/`/`tests/` source tree
      unless explicitly justified); `main`/`exports` (the default position,
      absent a concrete need surfacing during this task, is CLI-only — `bin`
      only, no `exports` — stated as a decision, not an oversight); `license`
      (`MIT`, already set — a real `LICENSE` file is added at the repository
      root, none currently exists); `author` (recommended: `{ \"name\":
      \"thixpin\", \"url\": \"https://github.com/thixpin\" }` — no email added
      unless the developer explicitly supplies and approves a public contact
      address); `repository` (recommended: `{ \"type\": \"git\", \"url\":
      \"git+https://github.com/thixpin/pitway.git\" }`); `bugs` (recommended: `{
      \"url\": \"https://github.com/thixpin/pitway/issues\" }`); `homepage`
      (recommended: `\"https://github.com/thixpin/pitway#readme\"`) — every
      recommended value is exactly what ships unless the developer chooses
      different wording during task execution. `package-lock.json` is included
      in this task's write_scope because any of these metadata changes
      (`name`/`version` in particular) regenerate it. A real, automated
      packaging check proves all of this, not just the unpacked `dist/` tree:
      build from a clean state (no pre-existing `dist/`, exercising the
      `prepack` lifecycle from AC001), run `npm pack` for real with its output
      directed at a throwaway temp directory (`npm pack --pack-destination
      <tmpdir>`, never the repository root or any tracked path) so the
      repository's own working tree is never touched by the test — the tarball
      is created and cleaned up entirely inside that temp directory, inspect the
      produced tarball's file allowlist directly (never assumed from the `files`
      field alone), install that real tarball into a fresh, throwaway temp
      project (`npm install <tarball-path>`, never `npm link`, never a workspace
      shortcut), and invoke **that installed project's own real `pitway`
      binary** (never the direct `dist/` path this AC's own AC001 already tests)
      confirming: `--help` succeeds; all 14 commands are individually registered
      and reachable; representative `--json` output and exit-code behavior are
      correct; default `init` installs the Claude assets (proving AC001's
      asset-copy step survived packing, not only the local build); and the
      packed `package.json` contains exactly the approved
      `author`/`repository`/`bugs`/`homepage` metadata above, checked by a real
      automated assertion, not a manual read. **The exact registry boundary,
      stated precisely rather than claimed as fully offline: no `npm publish` or
      any other registry *write* occurs anywhere in this task or its tests.**
      Read-only registry access is permitted only for two specific, named
      operations — the explicit name-availability check this AC already
      requires, and ordinary dependency resolution during a fresh tarball
      install (`npm install <tarball-path>` may legitimately need the registry
      to resolve `pitway`'s own runtime dependencies into the fresh temp
      project, exactly as any real end-user install would). No test may mutate
      registry state or credentials, and no test is claimed to run fully offline
      unless it is actually implemented against a controlled local dependency
      source or cache — this task does not build or claim that; an accurate,
      narrower claim is what ships."
  - id: AC003
    text: "A real, honest README.md exists at the repository root (none currently
      exists) covering: what PitWay is and its core philosophy ('Claude drives
      the interaction; PitWay controls the workflow state and engineering
      boundaries'); a real quickstart using the actual built-and-packed bin
      AC001/AC002 produce and AC002's automated packaging check proves (never a
      placeholder command that doesn't actually work against what ships); an
      accurate summary of the milestone/contract/task workflow and the
      human-confirmation gate; a pointer to `--help` and the installed Claude
      Code integration assets as the source of truth for the full command
      surface, never a duplicated, driftable copy of `--help` text embedded in
      the README itself. **Every claim is bounded only by clone-durable,
      authoritative evidence — committed Git history, `.pitway/` state, the test
      suite, and `docs/evidence/**` — never by `reports/*.md`.**
      `reports/M007.md` (and the other local milestone reports) may be cited
      internally as supplementary, local-only context during this task's own
      drafting, exactly as M007's own contract already established for its
      evidence base, but **no public README claim may rest on a `reports/*.md`
      file as its support**, since `reports/` is untracked, gitignored, and does
      not survive a fresh clone — a claim sourced only there is not actually
      verifiable by anyone who clones this repository. The repo-wide standing
      rule that README/public claims must never exceed actual validation
      evidence applies with full force here, where it is most externally
      visible. Specifically and by name: the README states worker-read-boundary
      enforcement exactly as AC004's decision resolves it — never implying
      enforcement that does not exist, per M007/T013's explicit carried-forward
      constraint."
  - id: AC004
    text: "The worker read-boundary enforcement question M007 left genuinely
      undecided (M006/AC004 deferred it 'to an M007 decision'; no M007 AC
      addressed it directly; M007/T013 explicitly assigned its disposition to
      M008) is resolved with an explicit decision, held to a real technical bar:
      **an isolated worktree alone does not constitute read enforcement** — a
      worker's own shell or tool calls can still read arbitrary paths inside
      that worktree, and nothing about worktree isolation by itself blocks reads
      that escape it (absolute paths, symlinks, environment-variable tricks). A
      candidate is only judged 'feasible' if it names a mechanism that addresses
      **both** shell/tool reads **and** escape paths through a real, enforced
      permission or sandbox boundary (e.g. an actual OS-level sandbox, or a
      restricted tool-permission allowlist genuinely enforced by the dispatching
      harness) — not a worktree, and not a documentation-only convention
      mistaken for enforcement. If no such real mechanism can be named and
      justified, **the honest decision is advisory-only** (a non-goal), not a
      weak 'feasible' claim resting on worktree isolation alone. Either outcome
      — (a) a real candidate mechanism is named, feasible, and judged in scope
      for a later, not-yet-numbered milestone, with actual implementation still
      deferred regardless of this conclusion, mirroring M007/AC005's and AC009's
      decide-before-build discipline, or (b) an explicit,
      permanent-until-revisited non-goal, stating plainly that PitWay claims and
      builds only write-boundary enforcement (`write_scope`, already real and
      mechanically enforced) — is evidence-based, citing this repository's own
      real dispatch history, not speculation. No read-enforcement implementation
      code is added in this milestone regardless of which way this decision
      resolves."
  - id: AC005
    text: "A roadmap-reconciliation review (mirroring M005/T009, M006/T006, and
      M007/T013's identical precedent, including their identical
      self-referential timing discipline — **the currently-executing milestone
      never adds its own row to the Bootstrap delivery table**, only the next
      milestone's reconciliation task does that) confirms IMPLEMENTATION_PLAN.md
      accurately reflects M008's actual delivery: the command surface (unchanged
      at 14 unless this milestone's own work changes it); the Bootstrap delivery
      table gains **M007's own row** (correctly omitted by M007/T013 per that
      same discipline, added now that M007 has actually completed) — **M008's
      own row is correctly omitted here too**, left for a future M009
      reconciliation task, never added by this task about itself; AC002's and
      AC004's decisions are reflected accurately wherever IMPLEMENTATION_PLAN.md
      currently states them as open (§8's read-enforcement paragraph, the M008
      roadmap bullet's 'must also resolve' clause). The prior Status line's own
      volatility — it read 'pending milestone-complete M007... draft Milestone
      M008's contract' at the moment of M007/T013's own commit, then became
      stale the instant `milestone-complete M007` actually ran afterward, the
      same staleness pattern repeating for a fourth time across M005/M006/M007's
      own Status lines — is corrected structurally, not just re-stated with new
      facts that will go stale the same way: the Status line either points to
      `pitway resume`/`.pitway/state.yaml` as the authoritative live source
      rather than hardcoding a status snapshot in prose, or is explicitly
      labeled as a task-time snapshot ('as of this commit — see `pitway resume`
      for current state') so a later milestone-completion event cannot silently
      make it read as false. Any other discovered drift between this document
      and M008's actual delivery is corrected as part of this task, not left
      stale for a future milestone to find."
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npm test -- tests/integration/build-bin.test.ts
  - id: CT002
    criterion: AC001
    type: manual
    instruction: Confirm tsc (not a new bundler) is the build tool,
      tsconfig.build.json is separate from the existing noEmit tsconfig.json,
      the cross-platform asset-copy script places Claude assets at exactly
      dist/integrations/claude/, package.json's build/prepack scripts run both
      steps, and the real-subprocess test individually confirms all 14 commands
      (not inferred from --help alone) plus a real init round trip proving
      default Claude-asset installation.
  - id: CT003
    criterion: AC002
    type: command
    command: npm test -- tests/integration/npm-pack.test.ts
  - id: CT004
    criterion: AC002
    type: manual
    instruction: Confirm every packaging field (name/version/files/main
      /exports/license/author/repository/bugs/homepage) is an explicit,
      justified decision with the recommended public-identity metadata applied
      verbatim unless the developer chose different wording, no email was added
      without explicit developer approval, package-lock.json is updated
      consistently, and no npm publish or other registry-write command ran
      anywhere in this task or its tests -- only the two named read-only
      registry operations (name-availability check, and dependency resolution
      during fresh tarball install) are permitted, and no test claims to run
      fully offline.
  - id: CT005
    criterion: AC003
    type: manual
    instruction: Confirm README.md exists, its quickstart actually works against the
      packed-and-installed artifact AC002 proves, it points to --help rather
      than duplicating command documentation, every claim traces only to
      clone-durable evidence (committed history, .pitway/ state, tests,
      docs/evidence/**) and never to reports/*.md as support, and its
      read-boundary-enforcement claim matches AC004's decision exactly.
  - id: CT006
    criterion: AC004
    type: manual
    instruction: Confirm the read-boundary-enforcement decision correctly treats
      worktree isolation as insufficient on its own, any feasible-candidate
      conclusion names a real mechanism addressing both shell/tool reads and
      escape paths, the decision is evidence-based, and no read-enforcement
      implementation code exists in this milestone's diff regardless of the
      decision.
  - id: CT007
    criterion: AC005
    type: manual
    instruction: Confirm IMPLEMENTATION_PLAN.md's command surface and Bootstrap
      delivery table gain M007's row and correctly omit M008's own row, the
      Status line is structurally fixed (points to live state or is explicitly
      snapshot-labeled) rather than merely re-stated, and the AC002/AC004 open
      items are reconciled.
  - id: CT008
    criterion: AC001
    type: command
    command: npm test
---

# Contract — M008: README, Packaging, and Release Readiness

## Objective

Deliver the first real, publishable release of the validated sequential-MVP
PitWay CLI: a genuine `tsc`-based build producing a real npm-installable
binary that also ships its Markdown Claude-integration assets (closing the
M004/T007 finding this repository has worked around since M004), complete
and validated npm packaging metadata proven by a real pack-and-install
check (never just the unpacked `dist/` tree), an honest README bounded only
by clone-durable evidence, and an explicit, evidence-based resolution of
the worker read-boundary enforcement question M007 left undecided and
assigned here. This milestone establishes release readiness; it does not
publish.

## Scope

- Real `tsc`-based build (`src/` → `dist/` via `tsconfig.build.json`),
  cross-platform Claude-asset copy script, `build`/`prepack` package.json
  scripts, `bin` pointed at the compiled output, proven by a real subprocess
  spawn confirming all 14 commands individually plus default-`init`
  asset installation.
- npm packaging metadata: `name`/`version`/`files`/`main`/`exports`/
  `license`/`author`/`repository`/`bugs`/`homepage` each an explicit
  decision, `package-lock.json` updated, a real `LICENSE` file, proven by
  an automated `npm pack` → fresh-temp-project-install → real-binary-invoke
  check.
- README.md: honest, clone-durable-evidence-bounded, quickstart that
  actually works against the packed artifact, pointing to `--help` rather
  than duplicating it.
- Worker read-boundary enforcement: an explicit, evidence-based decision
  held to a real technical bar (worktree alone is not enforcement) —
  feasible-and-deferred-to-a-later-milestone, or a stated non-goal — no
  implementation either way.
- Roadmap-reconciliation review against `IMPLEMENTATION_PLAN.md`, including
  a structural fix to the Status line's recurring staleness pattern.

## Non-Goals

- **Running `npm publish`.** This milestone establishes release readiness
  only; publishing to the real registry is a separate external action
  requiring its own explicit developer approval, not implied by this
  contract's confirmation.
- Automatically renaming the package if `pitway` is found claimed or
  ambiguous on npm at check time — that stops for an explicit developer
  decision instead.
- Actually implementing worker read-boundary enforcement, regardless of
  AC004's decision — implementation, if the decision favors it, is a later,
  not-yet-numbered milestone.
- Quick-change, Claude skills, or structured failure-evidence extraction —
  all three remain M007-deferred items with no milestone number assigned;
  this milestone does not schedule or implement any of them.
- Any M009/M010 branch-isolation or parallel-worktree work.
- Re-opening or amending M005/M006/M007 contracts or their completed task
  history.
- Changing the approved runtime stack (TypeScript strict / Node ≥ 20 / ESM
  / `commander` + `yaml` + `zod` as the only runtime deps) — the build step
  is tooling added around that stack, not a replacement for it.

## Design Decisions

- **Build tool is `tsc`**, the existing devDependency, not a new bundler —
  justified by this repository's source already using NodeNext-style `.js`
  import specifiers throughout, which a plain `tsc` emit satisfies directly
  with no specifier rewriting needed. A different tool is not precluded if
  real evidence during task execution shows `tsc` insufficient, but the
  contract does not anticipate needing one.
- `version`/`name`/`files`/`main`/`exports`/`author`/`repository`/`bugs`/
  `homepage` are all explicit-decision fields (AC002) — even where the
  answer is the recommended default given in this contract, the task
  records it as a considered decision, not an unstated assumption.
- Packaging validation must exercise the **packed and installed** artifact,
  never only the unpacked `dist/` tree — a build that works locally but
  fails once packed (missing files, broken relative asset paths, a
  `files` allowlist that silently drops something required) is exactly the
  failure mode `npm pack` + fresh-install + real-invoke catches and a
  `dist/`-only test cannot.
- AC004 mirrors M007/AC005's and AC009's decide-before-build discipline
  exactly, with an explicit technical floor: worktree isolation is
  disqualified as sufficient evidence for "feasible," closing a specific
  weak-argument path before it can be used to justify a claim this
  contract would not honestly support.
- AC005's Bootstrap-delivery-table and Status-line handling explicitly
  names and closes a recurring staleness pattern already observed across
  M005, M006, and M007's own equivalent tasks, rather than repeating it
  faithfully a fourth time.
- README claims (AC003) are downstream of AC002's and AC004's decisions,
  not independent of them — CT005 explicitly checks both dependencies, and
  the task graph orders AC003's task after AC002's and AC004's for exactly
  this reason.

## References

- IMPLEMENTATION_PLAN.md Revised Roadmap M008 entry (the "must also
  resolve" clause is this contract's AC004).
- IMPLEMENTATION_PLAN.md §7 (command surface), §8 (Agent Interface — the
  read-boundary-enforcement disclosure this contract's AC004 resolves),
  §17 (Open Questions — npm name, license, stack, all previously decided,
  the name/license decisions re-verified fresh by this contract's AC002).
- M004/T007's result (the CLI-reachability task; its own commit message and
  `tests/integration/cli.test.ts` document the exact `.js`/`.ts` resolution
  gap this contract's AC001 closes for real, and the per-command
  reachability testing pattern this contract's AC001/AC002 extend to the
  compiled and packed artifacts).
- `reports/M007.md` §7 (the Adaptive Workflow Intensity decision — the four
  workflow tiers and the roadmap-numbering discipline this contract's
  Non-Goals section follows) — cited here as internal drafting context
  only, never as AC003's public evidence source (see AC003's own text).
- `docs/evidence/M007/adaptive-workflow-intensity-decision.md` and
  `docs/evidence/M007/dogfood-evidence.md` (the read-boundary-enforcement
  gap's original disclosure and its M008 assignment).

## Change Log

- (none yet — draft, not confirmed.)
