---
schema_version: 1
id: M011
title: Claude Skills
status: in_progress
requirement: null
confirmed_at: 2026-08-20T05:09:13Z
verification_approved_hash: sha256:b9fee3a6a6e4f61b6bcdb5dfc7481127ff31b73a9a94476ab2e9a02d8f6354f5
acceptance_criteria:
  - id: AC001
    text: "Six Claude Code skills are vendored verbatim, unmodified, from
      github.com/thixpin/claude-config (a first-party, developer-owned MIT
      repository -- see docs/evidence/M007/claude-skills-decision.md and this
      session's own m007-t008-claude-config-license-clarification memory: direct
      reuse is permitted, no third-party licensing concern applies), pinned to
      commit d498eae219441839f75f737643857f6c0f84df12, reviewed firsthand in
      full before vendoring (not assumed from memory of M006/M007's earlier
      review): debugging, bug-fix, testing, code-quality-review,
      architecture-review, security-audit. Each is domain-generic software
      engineering guidance with zero PitWay-specific or reference-repository-
      specific content, applies as-is to PitWay's own TypeScript/Node codebase,
      and is classified reuse-unchanged (no adaptation, no PitWay-specific
      rewrite -- content and frontmatter copied byte-for-byte from the pinned
      commit). infra-design and terraform-review are explicitly evaluated and
      rejected: PitWay has no infrastructure/IaC domain, so neither skill has a
      grounded PitWay use case. claude-config's own commands/ directory
      (`/review-changes`, `/add-skill`, `/check-config`, `/test-skill`) is
      explicitly NOT vendored, wholesale or otherwise -- those are reference
      material only, reviewed for design context, never installed; PitWay's own
      existing eighteen `commands/*.md` assets (M004-M010) are retained
      completely unchanged, and no vendored file is ever written under
      `src/integrations/claude/commands/`. Each vendored skill file lands at
      src/integrations/claude/skills/<name>/SKILL.md, installed automatically by
      pitway init's existing glob-based installer (listMarkdownAssets,
      src/state/claude-assets.ts) with zero installer-discovery code changes
      (the collision/idempotency semantics themselves are AC002's concern, not
      this one) -- this is re-verified by a real test (not re-assumed from
      M007/T008's prior finding), asserting all six install to
      .claude/skills/<name>/SKILL.md in a fresh temp repo. A single new file,
      src/integrations/claude/skills/NOTICE.md, records the source repository,
      pinned commit, MIT license identifier, and the copyright notice/holder
      preserved exactly as stated in the pinned commit's own LICENSE file
      (whatever it actually says, copied verbatim, never a value assumed or
      guessed at drafting time), and the reuse-unchanged classification for all
      six vendored skills -- attribution lives in this one file, never inside a
      vendored SKILL.md's own frontmatter or body, since altering vendored
      content risks breaking Claude's own description-based routing and defeats
      \"verbatim, unmodified.\" NOTICE.md itself installs alongside the skill
      directories via the same glob (a plain informational file, not itself a
      SKILL.md, inert to Claude's skill loader which looks for <dir>/SKILL.md
      specifically). No change to the claude-config repository's own .gitignore
      whitelist model is relevant here -- that governs claude-config's own
      personal ~/.claude dotfile repository; PitWay ships source assets that
      install into a target project's .claude/, an unrelated mechanism, and no
      analogous whitelist exists or is needed in PitWay's own repository.
      Nothing in this milestone ever inspects, reads, or writes the developer's
      own global `~/.claude/skills/`, `~/.claude/commands/`, or any other global
      Claude Code configuration -- every installation this milestone performs is
      exclusively project-local, under the target repository's own `.claude/`."
  - id: AC002
    text: >-
      pitway init's existing, coarse three-state `.claude/` probe
      (probeClaudeAssets: 'ok' | 'missing' | 'invalid', where any mix of
      present/absent managed assets refuses the entire init with no detail) is
      replaced entirely by a per-file, content-comparing classification --
      probeClaudeAssets and the ClaudeAssetsProbe type are removed, not kept
      alongside the new mechanism, and init.ts's one caller is updated.

      A new export, classifyClaudeAssets(root: string):
      ClaudeAssetClassification[] (src/state/claude-assets.ts, alongside the
      existing listClaudeAssets/installClaudeAssets), classifies every currently
      shipped asset (every command doc, protocol/coordination document, and --
      since AC001's skills and NOTICE.md are discovered by this same
      pre-existing glob, with zero special-casing needed -- every vendored skill
      file too) against `<root>/.claude/<asset>`: 'absent' when the destination
      does not exist; 'identical' when it exists and its bytes exactly match the
      shipped source (a real content comparison, never a mtime/size heuristic);
      'conflict' when it exists with different content. This is the one and only
      place in the codebase that compares installed `.claude/` asset bytes.

      pitway init's orchestration (src/cli/commands/init.ts) preflights this
      classification before writing anything at all (config.yaml, state.yaml, or
      any `.claude/` asset): if one or more assets classify as 'conflict', the
      whole init refuses outright, naming every conflicting destination path in
      one message (not just the first) -- exactly the same never-just-the-first
      discipline AC003's RequiredSkillsError already applies, applied here to a
      distinct concern. Zero writes occur when any conflict exists: not the
      non-conflicting assets, not `.pitway/`'s own files, not AC004's root
      discovery files (AC004 depends on this AC's preflight explicitly). When no
      conflicts exist, only the assets actually classified 'absent' are written
      -- `installClaudeAssets` (src/state/claude-assets.ts) gains an optional
      second parameter, `assets: string[] = listClaudeAssets()`, writing exactly
      the given subset instead of the full set unconditionally; its existing
      zero-argument call shape keeps writing everything, so this is additive,
      not a behavior change for any other caller (there are none today besides
      `init.ts`). `init.ts` calls it with exactly the classified-absent subset.
      An 'identical' asset is therefore never rewritten, not even with equal
      bytes -- a real behavioral guarantee, not merely a
      harmless-because-equal-bytes coincidence. A rerun where every asset is
      already 'identical' calls this function with an empty list (or skips the
      call entirely), writing nothing at all. This corrects a real, disclosed
      behavior change from the mechanism it replaces: today's coarse probe
      refuses on ANY partial mix, including a harmless one (e.g. a prior pitway
      version's asset set missing a file a newer version now ships) -- the
      corrected model refuses only on an actual content conflict, converging a
      partial-but-consistent state cleanly instead of always blocking it.

      `--no-claude` means what it says, completely: when passed,
      classifyClaudeAssets is never called and `.claude/` is never inspected,
      read, or written at all (AC004 below still handles `AGENTS.md`, since
      init's non-Claude-specific bootstrap file is not gated by this flag; only
      `CLAUDE.md` and everything under `.claude/` are).

      Never inspects or modifies the developer's global Claude Code
      configuration under their home directory -- every classification and
      installation call in this AC takes an explicit repository root and
      operates exclusively under `<root>/.claude/`.

      Test coverage: a fresh default installation (nothing present) installs
      every asset, skills included; an identical rerun performs zero writes and
      reports success; a mixed rerun (some assets already 'identical', at least
      one genuinely 'absent', zero conflicts) installs only the absent ones and
      asserts the already-identical files' bytes and mtimes are untouched -- the
      direct regression test for `installClaudeAssets`'s new subset parameter,
      not merely the all-identical or all-absent extremes; a single conflicting
      command doc (an existing, developer-authored `.claude/commands/<name>.md`
      with different content) refuses, naming exactly that path; a single
      conflicting skill (`.claude/skills/<name>/SKILL.md` with different
      content) refuses the same way; multiple simultaneous conflicts (at least
      one command doc and one skill) refuse with every conflicting path named
      together, not just one; a conflict alongside otherwise-absent assets
      writes nothing at all -- not the non-conflicting assets, not `.pitway/`'s
      own files (the existing atomic all-or-nothing discipline, now extended to
      per-file granularity); `--no-claude` leaves `.claude/` completely
      untouched (directory not even created if it did not already exist); and a
      dedicated structural test proves no source file anywhere this milestone
      touches (src/state/claude-assets.ts, src/cli/commands/init.ts as of this
      AC) references `os.homedir`, `process.env.HOME`, or
      `process.env.USERPROFILE` -- later ACs extend this same structural test to
      their own new files once they exist, rather than this AC needing to guess
      at files that do not exist yet.
  - id: AC003
    text: >-
      A task may declare zero, one, or at most two skills it explicitly
      requires, via a new additive-optional tasks.yaml field, required_skills:
      string[], on taskSchema (src/state/schemas.ts, strictObject, mirroring
      mapped_ac_ids' own additive-optional precedent exactly -- absent on every
      M001-M010 historical task, non-breaking). Each entry must be a non-empty
      kebab-case skill name (a new, dedicated regex, consistent with this
      codebase's existing practice of regex-validating identifier-shaped fields,
      e.g. taskId's `^T\d{3}$` pattern -- no existing kebab-case regex is
      reused, since none currently exists in this codebase for this shape); at
      most two entries; no duplicate names within one task's list -- all three
      violations refused at schema-validation time with a message naming the
      specific violation, never silently truncated or deduplicated. An absent
      field and a present-but-empty array are treated identically to "no skill
      requirement" throughout (mirroring mapped_ac_ids' own absent-vs-empty
      equivalence in src/core/tasks/context-bundle.ts).

      required_skills participates in no interaction with the existing
      relevant_files/context_files/write_scope five-case combination rule -- it
      is validated entirely independently, and does not affect that superRefine
      in any way.

      buildTaskContextBundle (src/core/tasks/context-bundle.ts) stays a pure
      function with no filesystem access -- it gains one new passthrough field,
      requiredSkills?: string[] (task.required_skills, unchanged, the same
      passthrough pattern as writeScope/contextFiles), and nothing else.

      Layering is strict and three-part, mirroring CLAUDE.md's binding CLI ->
      Core -> State Store constraint exactly -- no layer performs another's job:

      - Core (src/core/tasks/skills.ts) is pure: a new export,
      assertRequiredSkillsAvailable(requiredNames: string[], availableNames:
      string[]): void, taking two plain string arrays and nothing else. It
      contains no filesystem access, no root path parameter, no node:fs import,
      and no knowledge of .claude/ or any install-path convention -- it only
      compares the two arrays, throwing a new RequiredSkillsError naming every
      entry in requiredNames absent from availableNames (not just the first)
      when any exist, a complete no-op when requiredNames is empty. This is the
      one and only Core-owned concern here, and it stays exactly this narrow.

      - State (src/state/claude-assets.ts) owns discovery of what is actually
      installed: a new export, listInstalledSkillNames(root: string): string[],
      the State layer's own root-taking read of <root>/.claude/skills/ --
      returns every immediate subdirectory name that contains its own SKILL.md,
      sorted, empty array when .claude/skills/ does not exist. This sits
      alongside the existing root-taking reads in this same file (and AC002's
      new classifyClaudeAssets), never duplicated elsewhere.

      - CLI (src/cli/commands/task-status.ts) orchestrates, composing the other
      two layers without owning validation logic itself: the --context branch
      calls listInstalledSkillNames(root) (State), then
      assertRequiredSkillsAvailable(task.required_skills ?? [], available)
      (Core), before building/returning the bundle -- on a thrown
      RequiredSkillsError, the whole command exits non-zero and writes nothing,
      exactly like every other Core-validated refusal in this codebase; when the
      task has no required_skills, this whole sequence is a complete no-op,
      byte-for-byte matching every pre-M011 task's behavior.

      This is a **pre-dispatch context gate**, not "dispatch-time enforcement"
      -- a precise term, distinct from AC002's own installation-time conflict
      refusal (a different mechanism, different trigger, different file): what
      this AC actually proves is that `task-status <id> --context` -- the step a
      driver is already required to run immediately before dispatching a worker
      (protocol-driver.md/dispatch.md, AC006 below) -- refuses visibly when a
      declared skill's SKILL.md is not present in the target repository's own
      managed .claude/skills/ installation. It does not and cannot prove that a
      dispatching harness outside PitWay's control (or the worker it dispatches)
      actually loads that installed skill -- an explicit, disclosed limitation
      consistent with IMPLEMENTATION_PLAN.md section 8's existing advisory-only,
      permanent-until-revisited disposition on worker read-boundary enforcement
      (M008/AC004): PitWay verifies its own managed installation is present and
      correctly named at the conventional path, nothing about a harness it does
      not control. AC006 below makes this gate's position in the dispatch
      sequence explicit in driver protocol: a driver must not proceed to
      dispatch on a refused context bundle.
  - id: AC004
    text: >-
      pitway init makes PitWay usage immediately discoverable to any agent that
      opens the initialized project, via two new, minimal, non-destructive root
      files -- a concern entirely separate from AC001's skill vendoring and
      AC002's asset-collision semantics, and from every other Claude-specific
      concern in this milestone: `AGENTS.md` is the generic, provider-neutral
      bootstrap file (no Claude-specific wording, useful to any agent), and
      `CLAUDE.md` is the Claude-specific entry point.

      Both are entirely a State-layer concern (src/state/root-instructions.ts,
      new -- mirroring claude-assets.ts's own shape, no Core involvement needed:
      there is no PitWay domain-object validation here, only static content
      materialization with the same byte-comparison idempotency AC002 already
      established for .claude/ assets). Fixed content constants for both files
      share one underlying set of bullet lines (never duplicated independently,
      to prevent the two files drifting apart over time) stating exactly, and
      only: this project uses PitWay; run `pitway resume` before starting or
      resuming any work; never edit `.pitway/` directly; work only within a
      confirmed task boundary; obtain a task's bounded context via `pitway
      task-status <id> --context` (the supported command), not by reading
      milestone history directly. `CLAUDE.md`'s own framing additionally points
      to `AGENTS.md` (for the shared generic instructions) and to
      `.claude/protocol-driver.md` (for the full Claude Code driver protocol) --
      it never restates the driver protocol itself. Neither file ever contains
      contract text, milestone history, IMPLEMENTATION_PLAN.md content, or any
      other verbose protocol prose; both stay a handful of lines.

      A new, exported, read-only classification function --
      classifyRootInstructionFiles(root: string, opts?: {includeClaudeMd?:
      boolean}): RootInstructionClassification[] (default {includeClaudeMd:
      true}; RootInstructionClassification = {file: 'AGENTS.md' | 'CLAUDE.md',
      status: 'absent' | 'identical' | 'conflict'}) -- classifies each
      applicable file exactly the way AC002's classifyClaudeAssets classifies a
      `.claude/` asset: absent, byte-identical to the fixed generated content,
      or a genuine content conflict. When opts.includeClaudeMd is false,
      CLAUDE.md is never stat'd or read at all and is simply omitted from the
      returned array -- not merely marked absent -- preserving --no-claude's
      "never inspected" guarantee at the call sites that need it. This exported
      classifier is a first-class part of this AC's own deliverable, not a
      private implementation detail: AC005 below reuses it directly rather than
      duplicating any classification logic.

      applyRootInstructionFiles(root: string, opts: {includeClaudeMd: boolean}):
      {agentsMd: 'created'|'identical'|'preserved', claudeMd?:
      'created'|'identical'|'preserved'} is built directly on top of
      classifyRootInstructionFiles (calls it, then acts on each entry) -- per
      file: absent -> write the fixed content, report 'created'; identical ->
      report 'identical', no write; conflict -> never write or append, report
      'preserved'. This is the opposite of AC002's own conflict handling (fatal
      refusal, writes nothing) precisely because an existing root instruction
      file is far more likely to be genuine, pre-existing developer content that
      must never be touched, while an existing `.claude/` asset conflict is far
      more likely to be an inconsistent or tampered managed-asset state that
      must never be silently papered over. On a 'preserved' outcome, the CLI
      (src/cli/commands/init.ts) prints a concise warning containing the exact
      fixed content that would have been written -- the literal generated-file
      constant, not a paraphrase -- so a developer can merge it in by hand.

      `--no-claude` skips `CLAUDE.md` entirely (never inspected or created) but
      still creates/preserves `AGENTS.md`, since `AGENTS.md` is the generic
      agent-discovery file, not a Claude-specific asset -- the same distinction
      AC002 draws for `.claude/` itself.

      AC002's own `.claude/` conflict preflight is fatal and runs strictly
      before either root file is touched: a refused Claude-asset installation
      must never leave a partially initialized instruction setup behind (no root
      file created when the whole init call is about to refuse for an unrelated
      reason) -- the same ordering discipline pitway init already applies
      between its `.pitway/` and `.claude/` probes.

      **Baseline git-safety integration, delivered for real, not disclosed as a
      gap:** `pitway init` never runs `git add`/`git commit` itself -- a freshly
      created (or already-existing) `AGENTS.md`/`CLAUDE.md` sits untracked
      exactly the way freshly installed `.claude/` assets already do today,
      until the *first* `milestone-confirm` sweeps everything PitWay-managed
      into its baseline commit. `src/core/milestones/confirm.ts`'s
      `computeExpectedBaselinePaths` call is extended with the *content-aware*
      set this AC's own classifier produces:
      `classifyRootInstructionFiles(root).filter(c => c.status !==
      'conflict').map(c => c.file)`, added to the existing
      `listClaudeAssetDestinations()` as `extraExpectedPaths`. A root file
      classified 'conflict' is therefore **never** included in the expected set
      -- it is never silently staged into the baseline commit merely because its
      path is a known one, and if it happens to be genuinely dirty at that exact
      moment, it correctly becomes unexpected dirt like any other untracked
      stray file, refusing confirmation until the developer resolves it (the
      same treatment `.claude/` conflicts already get, extended here for
      consistency, not a new philosophy). In the realistic case this AC's own
      test coverage constructs -- a developer's own pre-existing AGENTS.md/
      CLAUDE.md already tracked and committed before ever running `pitway init`
      -- the file is simply clean (unchanged, `init` declined to touch it) and
      never enters the dirty-path conversation at all: `milestone-confirm`
      proceeds normally, and the file remains exactly as it was, never staged
      into PitWay's own baseline commit. Only a genuinely absent-then-created or
      already-identical root file is ever staged. Without this AC's own baseline
      wiring, every one of this project's own dozens of existing integration
      tests that run a real `init` followed by a real `milestone-confirm` (and
      every real developer repo) would break: an untracked, freshly-created
      `AGENTS.md` would become unexpected dirt the very first time
      `milestone-confirm` runs. `task-verify`'s dirty-path allowance and
      `completeTask`'s `expectedPaths` need no update -- both operate only after
      this first baseline commit already exists, by which point the root files
      are already committed history like everything else.

      AC005 below extends this same content-aware philosophy to `.claude/`
      assets themselves (today's `listClaudeAssetDestinations()` call in
      `confirm.ts` is still the older, path-only list at this AC's own point of
      delivery -- a pre-existing gap since M006, not introduced here, and not
      widened by this AC's own two new root paths, which are content-aware from
      the start) and to `quick-change create`'s own, separate clean-tree check,
      which this AC does not touch.

      Test coverage: both root files absent creates both; an identical rerun
      performs zero writes; an existing, user-authored AGENTS.md is preserved
      byte-for-byte, unchanged, with a warning printed containing the exact
      fixed content; an existing, user-authored CLAUDE.md is preserved the same
      way; the warning's printed snippet is asserted to equal the literal fixed
      constant, not a description of it; a simulated AC002 `.claude/` conflict
      alongside two otherwise-absent root files causes the whole init to refuse
      with neither root file created (proving the preflight ordering); and
      `--no-claude` creates/handles AGENTS.md only, `.claude/` and CLAUDE.md
      both left completely untouched. This AC's own dedicated structural test
      (extending AC002's tests/unit/no-global-claude-access.test.ts to also
      cover src/state/root-instructions.ts) confirms this file, too, never
      references a global home-directory path. A real, full-lifecycle test
      (extending the existing `pitway init` -> `milestone-add` ->
      `milestone-confirm` coverage in
      tests/integration/self-hosting-readiness.test.ts) proves: both root files
      are untracked immediately after `init`, `milestone-confirm` succeeds
      without refusing, both root files appear in the resulting baseline
      commit's file list, and `git status --porcelain` is empty immediately
      afterward -- the direct regression proof for this requirement, not merely
      an assertion about `confirm.ts`'s source code. A second full-lifecycle
      test proves the converse: a pre-existing, already-tracked-and-committed
      AGENTS.md with different content is left completely untouched by `init`
      (byte-identical to its original content afterward), `milestone-confirm`
      still succeeds (the file was never dirty, so it was never part of the
      dirty-path question at all), and the resulting baseline commit's file list
      does **not** include AGENTS.md -- the direct regression proof that a
      preserved file is never staged merely because its path is known.
      tests/integration/milestone-confirm.test.ts's own existing
      expected-baseline-file-list fixtures (already built from
      `listClaudeAssetDestinations()`) are updated to also include
      `classifyRootInstructionFiles`'s own currently-identical/absent root
      paths, and gain one new test confirming `milestone-confirm` succeeds
      cleanly with both root instruction files present and untracked.
  - id: AC005
    text: >-
      Two real, related gaps in how `pitway init`'s own managed-path output
      interacts with two other Git-safety checks are resolved for real, not
      disclosed as accepted limitations: `quick-change create`'s clean-tree
      check, and `.claude/` asset content-conflict awareness at
      `milestone-confirm`'s own baseline-staging time (AC004 above already made
      root-instruction-file staging content-aware; this AC extends the identical
      treatment to `.claude/` assets and consolidates both into one shared
      mechanism, closing a gap that has existed for `.claude/` assets alone
      since M006, unrelated to and not introduced by this milestone).

      A new shared function, listSafeManagedDirtyPaths(root: string): string[]
      (src/state/managed-init-paths.ts, new -- a State-layer concern, composing
      two existing State-layer classifiers, never duplicating either one's logic
      or hardcoding a new path list of its own beyond the two exact literal
      paths below), is the single mechanism both gaps are closed with: it calls
      AC002's classifyClaudeAssets(root) and AC004's
      classifyRootInstructionFiles(root), filters OUT every entry classified
      'conflict' from both (an 'absent' entry is harmless to include -- it is
      never actually dirty, so its presence in an expected-paths ceiling changes
      nothing), and unions in the two exact repository-relative paths
      '.pitway/config.yaml' and '.pitway/state.yaml' unconditionally, with no
      content classification of their own -- mirroring src/git/baseline.ts's own
      computeExpectedBaselinePaths, which already treats these identical two
      literal paths as unconditionally expected at milestone-confirm time. These
      two files are PitWay's own state, written only by PitWay's own commands,
      never by a developer directly; the only window in which either is
      genuinely dirty is between a fresh `pitway init` and that repository's
      first-ever baseline commit (once any baseline or quick-change commit
      lands, both become tracked and clean, so neither can reappear here as
      leftover dirt from a later, legitimate edit). The full return value is the
      combined list of real repository-relative destination paths
      (`.claude/<asset>` for Claude assets, the bare filename for root
      instruction files, plus the two `.pitway/*` paths). A path currently in
      'conflict' state -- whether a tampered `.claude/` asset or a
      different-content root file -- is therefore never treated as safe dirt by
      either consumer below; it surfaces as genuinely unexpected, exactly like
      any other untracked stray file.

      **quick-change after init**: src/core/quick-change/create.ts's
      assertCleanWorkingTree (today: refuses unconditionally on any dirty path
      at all, checkWorkingTreeClean(root).clean === true, no allowance mechanism
      whatsoever) is rewritten to mirror the existing
      assertNoUnexpectedDirtyPaths pattern already used identically in both
      src/core/milestones/confirm.ts and src/core/milestones/complete.ts (small,
      established, per-caller duplication this codebase already tolerates for
      this exact 6-line filter-and-throw shape -- not re-abstracted here,
      consistent with existing precedent): compute
      checkWorkingTreeClean(root).dirtyPaths, subtract
      listSafeManagedDirtyPaths(root), and refuse (naming only the genuinely
      unexpected remainder, in the same error shape as today: "cannot create
      quick-change: working tree is not clean: <paths>") only when that
      remainder is non-empty. A fresh `pitway init` (with or without
      --no-claude) followed immediately by `quick-change create`, with no other
      changes, now succeeds -- every dirty path at that moment (the two
      `.pitway/*` state files plus every freshly-installed, content-identical
      `.claude/` asset and root instruction file) is safe managed dirt. Any
      additional, non-managed untracked or modified file -- a stray source edit,
      an unrelated new file, anything outside both classifiers' scope and the
      two literal `.pitway/*` paths -- still refuses, naming exactly that file,
      the same as before this AC.

      **quick-change commit, same window**: src/core/quick-change/commit.ts's
      own assertDirtySubset(root, current.scope) has the identical, previously
      unnoticed trap -- a create that now succeeds in the fresh-init window
      still leaves the same managed dirt present at commit time, and
      current.scope (the change's own declared file scope) never includes it, so
      commit would refuse on exactly the paths create just allowed through.
      assertDirtySubset's call site is updated to pass [...current.scope,
      ...listSafeManagedDirtyPaths(root)] as its expected set, and
      commitOrResume's own expectedPaths argument (the set it actually stages)
      is extended identically, so this first quick-change commit -- when it is
      also the repository's first commit since init -- genuinely stages and
      lands the managed init output alongside the change's own scope, rather
      than leaving it perpetually dirty. A later, genuine milestone-confirm
      baseline is unaffected: by then these paths are already tracked and clean,
      so computeExpectedBaselinePaths' own handling of them is simply a no-op
      ceiling, exactly as today.

      **Baseline staging, extended to `.claude/` assets**:
      src/core/milestones/confirm.ts's `computeExpectedBaselinePaths` call is
      updated once more (AC004 already added it for root files specifically) to
      pass `listSafeManagedDirtyPaths(root)` as its whole `extraExpectedPaths`
      argument, replacing the separate `listClaudeAssetDestinations()` call
      entirely. `.claude/` assets are therefore eligible for baseline staging
      only when they currently pass AC002's own identity/conflict classification
      as 'identical' (or are genuinely absent, harmless) -- never merely because
      their path is a recognized managed one. A `.claude/` asset manually edited
      to diverge from its shipped content, sitting dirty at `milestone-confirm`
      time, now correctly refuses the confirm (naming that path) instead of
      being silently swept into the baseline commit -- closing the pre-existing,
      since-M006 gap this milestone's own earlier drafting round had only
      disclosed rather than fixed.

      Test coverage, real temp-repo tests, no mocking of the classifiers
      themselves: a fresh default `pitway init` immediately followed by
      `quick-change create` succeeds; the same create followed through
      approve/run/commit lands one commit containing the change's own scope plus
      the swept managed init output (`.pitway/config.yaml`,
      `.pitway/state.yaml`, and every installed `.claude/` asset), proving the
      commit-time trap above is genuinely closed, not just create; the same
      create-through-commit sequence after `pitway init --no-claude` also
      succeeds (fewer managed paths -- AGENTS.md only, no `.claude/` assets --
      still all safe); a fresh init plus one arbitrary extra untracked file
      (e.g. a stray source file) still refuses `quick-change create`, naming
      only that stray file, never any of the managed paths (the existing
      "refuses on a dirty working tree" test in
      tests/integration/quick-change.test.ts, which predates this AC and uses
      its own already-committed-post-init fixture, continues to pass unchanged
      -- an explicit regression check, not a new behavior); a dedicated mixed
      dirty-state regression case -- a fresh `pitway init`
      (`.pitway/config.yaml` and `.pitway/state.yaml` genuinely dirty, plus
      every installed `.claude/` asset) with one additional unrelated
      developer/source file also dirty or untracked at the same time -- asserts
      `quick-change create` still refuses, and that the refusal message names
      exactly and only that unrelated file, explicitly proving neither
      `.pitway/config.yaml`, `.pitway/state.yaml`, nor any `.claude/` asset ever
      appears in that unexpected-paths list even when genuinely dirty alongside
      real unrelated dirt (distinct from the single-stray-file case above: this
      proves the mixed case, managed dirt plus unrelated dirt coexisting, not
      just unrelated dirt alone); a real `milestone-confirm` test (extending
      tests/integration/milestone-confirm.test.ts) proves a manually-tampered,
      genuinely-conflicting `.claude/` asset present at confirm time now refuses
      confirmation, naming that asset, rather than being silently staged (the
      direct regression test for the M006-era gap closed here); and a focused
      unit test (tests/unit/managed-init-paths.test.ts, real temp directory
      trees, no full `pitway init`) exercises listSafeManagedDirtyPaths directly
      across a representative mix of absent/identical/conflict `.claude/` assets
      and root instruction files together, confirming: every 'conflict' entry
      from either classifier is excluded from the result; every
      'absent'/'identical' entry from either is included; the two `.pitway/*`
      paths are always present in the result regardless of classifier state; and
      the combined result is stable and idempotent across repeat calls with no
      filesystem side effects of its own (a pure read, mirroring both
      classifiers it composes) -- the shared-mechanism-level proof that mixed
      identical/absent managed paths, across both asset kinds together, remain
      correctly and atomically classified.
  - id: AC006
    text: >-
      A new structural test (tests/unit/skills-structure.test.ts) validates the
      vendored skill set's frontmatter shape without ever mutating the real
      vendored files. The parsing/validation logic is a pure, local function
      taking plain string content -- e.g. validateSkillFrontmatter
      (directoryName: string, skillMdContent: string): string[], returning a
      list of violation messages (empty when valid) -- so every negative case
      (missing name/description, non-kebab-case name, a name that does not match
      its own directory, a too-short description) is exercised by calling this
      pure function directly with synthetic string literals, never by writing
      into, corrupting, or temporarily moving any real file under
      src/integrations/claude/skills/. Separately, one positive-case test reads
      every real vendored SKILL.md (read-only -- readFileSync only, no
      writeFileSync/rmSync/renameSync anywhere in this test file) and asserts
      the same pure function reports zero violations for each, plus a
      duplicate-name check across the real set. This is PitWay's own mechanical
      validation, analogous in spirit to claude-config's scripts/check-config.sh
      but implemented as an ordinary Vitest structural test consistent with this
      codebase's existing pattern -- not a shell script, and PitWay adds no new
      CI/script infrastructure for this milestone. claude-config's separate
      behavioral trigger evaluation (scripts/eval-triggers.sh --
      non-deterministic, requires the Claude CLI, deliberately outside CI) is
      explicitly evaluated and not adopted: it has no PitWay-owned equivalent
      and is out of scope for this milestone; AC007's dogfood evidence is the
      comparable real-usage signal this milestone relies on instead.

      protocol-driver.md and dispatch.md each gain a small, targeted section
      (not a rewrite) documenting: how a driver declares required_skills on a
      task being drafted, when to do so (a task whose work genuinely benefits
      from one of the six vendored skills' scope -- named explicitly, not
      "whenever unsure"); that a driver or a dispatched worker may also load any
      installed skill informally/voluntarily even when a task does not require
      it (the exact live practice this session already used for M010's own two
      architecture-review passes, formalized here for the first time as
      documented guidance rather than left as undocumented ad hoc practice);
      that loading code-quality-review never changes or reduces the driver's own
      mandatory independent diff/write_scope review (protocol-driver.md's
      existing language, M006/AC004) -- it is a tool that review can use, never
      a replacement for the review requirement itself; and that dispatch.md's
      existing pull-context-bundle step (already immediately before its dispatch
      step, unchanged in sequence by this milestone) is where AC003's
      pre-dispatch context gate actually fires -- a driver must treat a refused
      task-status <id> --context call exactly like any other blocking refusal
      and must not proceed to dispatch a worker on a task whose context bundle
      it could not retrieve.
  - id: AC007
    text: >-
      Real comparative dogfood evidence, mirroring M006/AC005's and M007's own
      model-held-constant methodology, with four validity requirements a prior
      drafting round left underspecified, now binding: (1) **the comparison
      rubric is written down in docs/evidence/M011/skill-dogfood-evidence.md
      before either dispatch runs**, not derived afterward to fit whatever
      happened -- fixing, in advance: the exact bounded read-only task both
      dispatches receive (identical prompt text), the model/config held constant
      across both, and a concrete checklist of what
      "structure/thoroughness/adherence differs" means for the specific skill
      under test (e.g. for code-quality-review: are findings labeled by severity
      per the skill's own method; for architecture-review: does the output map
      dependencies before recommending). (2) **Both dispatches are read-only**
      -- the bounded task itself must not require any file write (a
      review/investigation task, not an editing task), so neither run can
      collide with the other or with the repository's own working tree. (3)
      **Both dispatches are fresh-context and mutually isolated**: two
      independently launched sub-agents, neither given any visibility into the
      other's transcript, output, or existence -- launched so that dispatch
      order cannot leak information from one into the other (e.g. two separate,
      non-chained dispatch calls in the same turn, not a sequential pair where
      the second could be influenced by having "gone first" or by seeing the
      first's result). (4) **The skill-loaded run's own use of the skill is
      evidenced concretely, not merely asserted in prose** -- the recorded
      evidence must include something the harness itself produced showing the
      skill was actually loaded (e.g. a quoted tool-invocation record, a
      transcript excerpt naming the skill, or an equivalent concrete artifact
      from that run) -- a driver's own unverified claim that "the skill was
      loaded" does not satisfy this AC.

      Record in docs/evidence/M011/skill-dogfood-evidence.md: the rubric itself
      (written first, per (1)); total token cost for each dispatch
      (runtime-reported only, never estimated, per decision 8; a
      startup/overhead component only as an explicitly-labeled derived estimate
      if the harness does not report it directly, never presented as measured);
      the rubric-scored comparison of report structure/thoroughness/adherence;
      the concrete loading evidence per (4); and the task outcome for both. The
      comparison is reported honestly regardless of outcome -- a null or
      negative result is not grounds to omit or reframe it, matching
      M006/AC005's own precedent of reporting a raw-cost increase candidly.

      The document itself must explicitly separate, under its own labeled
      headings or an equivalent unambiguous marking, two different kinds of
      claim: **artifact-verified facts** (token costs as runtime-reported, the
      rubric text, the rubric-scored comparison, (2)'s read-only construction --
      checkable directly from the bounded task text itself, since it either
      required a write or it didn't -- and (4)'s concrete loading evidence --
      each backed by something the harness itself produced, or by the task text
      itself, and quoted or attached in the document) versus **driver-attested
      facts** (that the rubric was genuinely written before either dispatch ran,
      that the two dispatches were genuinely independent and non-chained with no
      visibility into each other's transcript, output, or existence, and the
      actual order the two dispatch calls were issued in -- procedural facts
      about how this session invoked the harness, which the document itself
      cannot independently verify, only report on the driver's own account). The
      document must not word (1)'s write-first ordering, (3)'s mutual isolation,
      or dispatch ordering generally, as independently proven by the committed
      evidence file -- it may only state that these are driver-attested at
      dispatch time, exactly as (1) and (3) above already require, never claimed
      as artifact-verified alongside (2) and (4)'s genuinely
      checkable-from-document evidence.

      This document also discloses, explicitly, the same non-bootstrap gap
      mapped_ac_ids disclosed in M007/M008 (AC011/T010's own precedent): M011's
      own tasks.yaml is drafted and confirmed before AC003's schema field exists
      in this repository's own validation code, so none of M011's own tasks can
      declare required_skills on themselves. The skill-loaded dispatch therefore
      loads its skill through the dispatching harness's own skill mechanism
      directly (the same live, manual mechanism this session already used for
      M010's two architecture-review passes -- not required_skills/task-status
      --context, which this standalone auxiliary dispatch never goes through at
      all). This comparison is not a demonstration of AC003's pre-dispatch
      context gate (AC003's own tests are the sole coverage for that mechanism)
      -- it demonstrates only whether loading a vendored skill's content changes
      a dispatched worker's real output, stated plainly rather than implied to
      exercise required_skills itself.
  - id: AC008
    text: "IMPLEMENTATION_PLAN.md is reconciled against this milestone's actual
      delivery, mirroring M005/T009 through M010/T004's identical
      self-referential discipline: the Bootstrap delivery table gains M010's row
      (M011's own row correctly omitted, left for whichever milestone next runs
      its own reconciliation task); section 9's Claude-asset file count and
      installed-assets list are updated for the six new skill files plus
      NOTICE.md (24 -> 31, unaffected by AC002/AC004/AC005's own new logic-only
      files, which ship no new `.md` asset under src/integrations/claude/);
      section 7's `init` description is updated to describe the corrected
      per-file collision/idempotency semantics (AC002), the new root
      `AGENTS.md`/`CLAUDE.md` bootstrap-file behavior (AC004), and the
      content-aware git-safety integration covering quick-change and baseline
      staging (AC005), while explicitly confirming the command surface count
      itself is unchanged (no new CLI command -- `init` remains one command,
      `required_skills` is a schema/gate addition surfaced through the existing
      `task-status --context`, not a new command); the Revised Roadmap's M011
      entry reflects actual delivery (vendored skill set with the
      infra-design/terraform-review rejection explicitly recorded, the corrected
      `init` asset-collision semantics, the new root agent-discovery files wired
      into baseline git-safety, the quick-change and
      `.claude`-conflict-at-confirm-time fixes, required_skills schema and the
      pre-dispatch context gate, the dogfood evidence finding and its disclosed
      non-bootstrap gap) in place of its current not-yet-drafted placeholder;
      the Status line reflects M011's actual delivery."
verification:
  - id: CT001
    criterion: AC002
    type: command
    command: npm test -- tests/integration/init.test.ts
      tests/unit/claude-assets.test.ts
      tests/unit/no-global-claude-access.test.ts
  - id: CT002
    criterion: AC003
    type: command
    command: npm test -- tests/unit/schemas.test.ts tests/unit/skills.test.ts
      tests/unit/claude-assets.test.ts tests/integration/task-status.test.ts
  - id: CT003
    criterion: AC004
    type: command
    command: npm test -- tests/integration/init.test.ts
      tests/unit/root-instructions.test.ts
      tests/unit/no-global-claude-access.test.ts
      tests/integration/self-hosting-readiness.test.ts
      tests/integration/milestone-confirm.test.ts
  - id: CT004
    criterion: AC005
    type: command
    command: npm test -- tests/integration/quick-change.test.ts
      tests/unit/managed-init-paths.test.ts
      tests/integration/milestone-confirm.test.ts
  - id: CT005
    criterion: AC001
    type: manual
    instruction: Confirm all six vendored SKILL.md files are byte-for-byte identical
      to the pinned commit d498eae219441839f75f737643857f6c0f84df12 (no
      accidental edits during vendoring); confirm infra-design and
      terraform-review are genuinely absent, not partially vendored; confirm
      claude-config's commands/ directory was not vendored, wholesale or
      partially, anywhere under src/integrations/claude/; confirm PitWay's own
      eighteen existing command docs are unchanged; confirm NOTICE.md names the
      source repo, the pinned commit, MIT license identifier, and the copyright
      notice/holder copied verbatim from the pinned commit's own LICENSE file
      (not a hardcoded or assumed string/year -- read NOTICE.md against that
      LICENSE file directly to confirm the match) and the reuse-unchanged
      classification for all six; confirm a real test proves all six (plus
      NOTICE.md) install to .claude/skills/... in a fresh temp repo; confirm no
      vendored SKILL.md's frontmatter or body was altered to carry attribution
      text; confirm nothing in this milestone reads or writes any path under the
      developer's own home directory.
  - id: CT006
    criterion: AC002
    type: manual
    instruction: Confirm probeClaudeAssets/ClaudeAssetsProbe are removed entirely,
      not left alongside the new mechanism; confirm classifyClaudeAssets does a
      real byte comparison (not size/mtime) for every managed asset, skills and
      NOTICE.md included via the pre-existing glob with zero special-casing;
      confirm installClaudeAssets's new optional subset parameter actually
      writes only the given assets, and that an 'identical' asset is never
      rewritten (bytes/mtime unchanged) in the mixed-state case, not merely
      harmlessly overwritten with equal bytes; confirm init refuses the whole
      command and writes nothing at all (config.yaml, state.yaml, any .claude/
      asset, and AC004's root files) when even one conflict exists, naming every
      conflicting path together; confirm a fresh install, an identical rerun, a
      mixed absent+identical rerun, a single conflicting command doc, a single
      conflicting skill, and multiple simultaneous conflicts are each covered by
      a real test with the expected behavior; confirm --no-claude never calls
      classifyClaudeAssets or touches .claude/ at all; confirm the dedicated
      structural test genuinely fails on a real os.homedir/HOME/USERPROFILE
      reference (not a trivially-passing check) for every file this AC touches.
  - id: CT007
    criterion: AC003
    type: manual
    instruction: Confirm required_skills is additive-optional and byte-for-byte
      non-breaking for every task without it; confirm kebab-case/max-two/
      no-duplicate validation refuses with a specific message per violation;
      confirm buildTaskContextBundle stays a pure function and only gains the
      passthrough field; confirm src/core/tasks/skills.ts's
      assertRequiredSkillsAvailable takes only two plain string arrays -- no
      root parameter, no node:fs import, no .claude/ knowledge anywhere in that
      file; confirm src/state/claude-assets.ts is the sole module that reads
      .claude/ from disk (both AC002's classifyClaudeAssets and this AC's
      listInstalledSkillNames live there), and that listInstalledSkillNames
      specifically is the one export the required-skills gate actually calls;
      confirm task-status.ts's --context branch is the only place that composes
      the two (State read, then Core validation) before building the bundle;
      confirm task-status --context refuses visibly (nonzero exit, no bundle
      written) naming every missing declared skill when one or more are not
      installed, and is a complete no-op when required_skills is absent or
      empty; confirm this is consistently described as a pre-dispatch context
      gate, distinct from AC002's own installation-time conflict refusal, and
      that the disclosed limitation (installation presence only, not proof a
      harness actually loads the skill) is stated plainly and consistently with
      IMPLEMENTATION_PLAN.md §8's existing advisory-only disposition.
  - id: CT008
    criterion: AC004
    type: manual
    instruction: Confirm AGENTS.md and CLAUDE.md's fixed content contains only the
      five required elements (uses PitWay, run pitway resume, never edit
      .pitway/ directly, work only within a confirmed task boundary, obtain
      context via pitway task-status --context) and nothing else -- no
      contract/milestone/IMPLEMENTATION_PLAN.md content, no verbose protocol
      text; confirm both files derive from one shared bullet source, not two
      independently drifting copies; confirm CLAUDE.md points to both AGENTS.md
      and .claude/protocol-driver.md; confirm classifyRootInstructionFiles is a
      real exported classifier (not private), and that applyRootInstructionFiles
      is built directly on top of it rather than duplicating its comparison
      logic; confirm classifyRootInstructionFiles never stats or reads CLAUDE.md
      at all when includeClaudeMd is false; confirm the printed warning on a
      preserved file contains the exact literal fixed content, not a paraphrase;
      confirm the AC002 .claude/ conflict preflight genuinely runs before either
      root file is touched (a real test proves a conflict leaves neither root
      file created); confirm --no-claude still creates/preserves AGENTS.md while
      leaving CLAUDE.md and .claude/ untouched; confirm the structural
      no-global-access test now also covers src/state/root-instructions.ts.
      Confirm confirm.ts's computeExpectedBaselinePaths call is genuinely
      content-aware for root files -- a 'conflict'-classified root file is
      excluded from the expected set, never staged merely because its path is
      known (read the diff, don't assume); confirm a real full-lifecycle test
      (init -> milestone-add -> milestone-confirm) proves both root files end up
      committed in the baseline commit with a clean tree afterward when
      identical/created, AND a second real full-lifecycle test proves a
      pre-existing, already-committed, different-content AGENTS.md is left
      completely untouched and never appears in the baseline commit's file list;
      confirm milestone-confirm.test.ts's own expected-file-list fixtures were
      updated accordingly and that no existing test in that file or
      self-hosting-readiness.test.ts was left asserting an exact file/commit
      list that silently excludes the root files.
  - id: CT009
    criterion: AC005
    type: manual
    instruction: Confirm listSafeManagedDirtyPaths (src/state/managed-init-paths.ts)
      composes AC002's classifyClaudeAssets and AC004's
      classifyRootInstructionFiles directly -- no hardcoded/duplicated path list
      of its own beyond unconditionally unioning the two literal paths
      '.pitway/config.yaml' and '.pitway/state.yaml' (matching
      src/git/baseline.ts's own hardcoded treatment of the identical two paths),
      no re-implementation of either classifier's byte-comparison logic; confirm
      it excludes every 'conflict' entry from both classifiers and includes
      every 'absent'/'identical' entry from both, plus the two .pitway/* paths
      unconditionally; confirm quick-change/create.ts's assertCleanWorkingTree
      is rewritten to use this shared function as its allowance set, mirroring
      the existing assertNoUnexpectedDirtyPaths shape already duplicated
      identically in confirm.ts and complete.ts (confirm this small, established
      duplication pattern was followed, not a new shared abstraction invented);
      confirm quick-change/commit.ts's assertDirtySubset call and its
      commitOrResume expectedPaths argument are both extended to
      [...current.scope, ...listSafeManagedDirtyPaths(root)], not left at
      current.scope alone -- verify by reading the diff that a
      create-then-commit sequence in the fresh-init window does not re-trap at
      commit; confirm a real test proves a fresh init (with and without
      --no-claude) immediately followed by quick-change
      create/approve/run/commit succeeds end-to-end with no other changes
      present, and that the resulting commit's file list includes both the
      change's own scope and the swept .pitway/*+.claude/* managed paths;
      confirm a real test proves an arbitrary extra untracked file still refuses
      quick-change create, naming only that file; confirm a dedicated real test
      proves the mixed case -- .pitway/config.yaml and .pitway/state.yaml
      genuinely dirty from a fresh init, plus one unrelated developer/source
      file also dirty or untracked at the same time -- still refuses
      quick-change create and that the refusal names exactly and only the
      unrelated file, never .pitway/config.yaml, .pitway/state.yaml, or any
      .claude/ asset; confirm the existing "refuses on a dirty working tree"
      test in quick-change.test.ts was left unmodified and still passes, as an
      explicit regression check; confirm confirm.ts's
      computeExpectedBaselinePaths call now passes
      listSafeManagedDirtyPaths(root) as its whole extraExpectedPaths argument,
      replacing the separate listClaudeAssetDestinations() call entirely;
      confirm a real milestone-confirm test proves a manually-tampered,
      conflicting .claude/ asset present at confirm time now refuses
      confirmation, naming that asset, rather than being silently staged --
      closing the pre-existing, since-M006 .claude-asset gap; confirm this AC's
      own unit test for listSafeManagedDirtyPaths exercises a real mix of
      absent/identical/conflict across both asset kinds together (not each kind
      in isolation) and asserts the two .pitway/* paths are always present in
      the result regardless of classifier state.
  - id: CT010
    criterion: AC006
    type: manual
    instruction: Confirm tests/unit/skills-structure.test.ts contains no
      writeFileSync/rmSync/renameSync (or equivalent) targeting any real path
      under src/integrations/claude/skills/ anywhere in the file -- every
      negative case must be exercised by calling the pure
      validateSkillFrontmatter-style function with synthetic string literals,
      never by mutating a real vendored file; confirm the positive-case test
      reads every real vendored SKILL.md read-only and asserts zero violations,
      plus a real duplicate-name check across the actual set; confirm
      protocol-driver.md/dispatch.md's new sections are small and targeted,
      correctly describe when to declare required_skills, document
      informal/voluntary skill loading as already-practiced guidance, correctly
      state code-quality-review never replaces the mandatory independent review
      step, and explicitly name the existing pull-context-bundle step as where
      AC003's pre-dispatch gate fires, with a driver required to treat its
      refusal as blocking.
  - id: CT011
    criterion: AC007
    type: manual
    instruction: Confirm docs/evidence/M011/skill-dogfood-evidence.md records the
      comparison rubric (bounded task text, held-constant model/config, and the
      concrete structure/thoroughness/adherence checklist). Confirm the document
      contains an explicit, clearly labeled split between artifact-verified
      facts (token costs as runtime-reported, the rubric text, the rubric-scored
      comparison, and the concrete loading evidence) and driver-attested facts
      (that the two dispatches were genuinely independent/non-chained, that each
      ran fresh-context with no cross-visibility, and the actual order the
      dispatch calls were issued in). Two of the four validity requirements are
      checkable directly from the committed document's own content -- read-only
      construction, and concrete loading evidence -- confirm both are actually
      present and concrete, not prose assertions. The other two -- the rubric
      genuinely written before either dispatch ran, and the two dispatches
      genuinely being mutually isolated with no cross-visibility, including
      dispatch ordering -- cannot be independently proven from a single
      committed markdown file; they must be stated only as driver-attested, not
      independently verified by this check. Confirm the document's own wording
      never claims independent/artifact proof for those two or for dispatch
      ordering generally -- read the actual section headings/labels, don't
      assume the split exists. Confirm both dispatches were read-only (no
      write_scope/ file mutation required by the bounded task itself); confirm
      concrete harness evidence (a quoted tool-invocation record, transcript
      excerpt, or equivalent artifact) proves the skill-loaded run actually
      loaded the skill, not merely a prose claim that it did; confirm
      runtime-reported (never estimated) total token figures for both
      dispatches, with any startup/overhead figure explicitly labeled as derived
      if used; confirm an honest report of the outcome regardless of direction;
      and confirm an explicit, correctly-worded disclosure that this comparison
      exercises the harness's own skill mechanism directly, not
      required_skills/task-status --context's pre-dispatch gate (matching the
      mapped_ac_ids M007/M008 non-bootstrap precedent).
  - id: CT012
    criterion: AC008
    type: manual
    instruction: Confirm IMPLEMENTATION_PLAN.md's Bootstrap table gains M010's row
      (M011's own correctly omitted); the Claude-asset count and
      installed-assets list are updated for the six skills plus NOTICE.md; §7's
      init description covers the corrected collision/idempotency semantics, the
      new root discovery files, and the content-aware git-safety integration
      (quick-change and baseline staging) while explicitly confirming no
      command-surface change; the Revised Roadmap's M011 entry and the Status
      line reflect actual delivery, including that the quick-change and
      .claude-conflict-at-confirm-time gaps were fixed, not merely disclosed.
  - id: CT013
    criterion: AC001
    type: command
    command: npm test
  - id: CT014
    criterion: AC006
    type: command
    command: npm test -- tests/unit/skills-structure.test.ts
---

# Contract — M011: Claude Skills

## Objective

Vendor a small, curated set of reusable Claude Code skills into PitWay's own installable
Claude Code adapter, formalizing engineering-workflow guidance (debugging, bug-fixing,
testing, code-quality review, architecture review, security auditing) that a driver or a
dispatched worker can load on demand while executing a PitWay task -- the same mechanism
this session already used live, informally, for M010's own two architecture-review
contract passes. This is the first M011 candidate to actually ship: M007/AC009 evaluated
the same reference repository in full and explicitly deferred, citing exactly two reasons
-- open design questions and, more importantly, zero real skill usage in this repository to
measure a behavioral comparison against. Both gaps are addressed here, not assumed away:
this milestone resolves the design questions concretely (installation strategy: vendored,
project-local, per the M007 candidate notes' own leaning; schema: `required_skills` on a
task, additive-optional; a pre-dispatch context gate composed from a pure Core comparison
and a State-layer read of what's actually installed, both real and tested) and this
session's own live M010 usage of `architecture-review` is exactly the
"concrete, motivating use case" M007/AC009's defer decision said was missing -- the
explicit justification the 2026-08-19/2026-08-20 developer directive cites for overriding
that decision now rather than waiting further. PitWay Core remains fully provider-agnostic
throughout: skills are text assets under `src/integrations/claude/`, installed by the
existing glob-based installer with zero Core or CLI-surface changes to command count.

This revision also corrects and extends `pitway init`'s own asset-installation behavior,
since shipping new managed assets (skills, NOTICE.md, and two new root files) is exactly
the situation that exposed real gaps: today's probe refuses on *any* partial mismatch
between what's shipped and what's installed, with no per-file detail and no way to
distinguish a harmless version-to-version gap from a genuine conflict; `init` had no
mechanism at all for making PitWay itself discoverable to an agent opening a freshly
initialized project; and two of PitWay's own other Git-safety checks (`quick-change
create`'s clean-tree gate, and `.claude/` asset eligibility at `milestone-confirm`'s
baseline-staging time) were never taught about PitWay's own managed init output at all.
Every one of these is resolved for real in this milestone, not disclosed as an accepted
limitation -- none is a new CLI command; all are corrections to `init`'s own behavior and
to how two already-existing commands (`quick-change create`, `milestone-confirm`) treat
PitWay-managed paths.

## Scope

- Vendor six skills (`debugging`, `bug-fix`, `testing`, `code-quality-review`,
  `architecture-review`, `security-audit`) verbatim from `github.com/thixpin/claude-config`
  at pinned commit `d498eae219441839f75f737643857f6c0f84df12`, plus one new attribution
  file, `src/integrations/claude/skills/NOTICE.md`. `infra-design`/`terraform-review`
  explicitly rejected (no PitWay infrastructure domain). claude-config's own `commands/`
  directory is never vendored; PitWay's own existing command assets are untouched.
- Corrected `pitway init` asset-installation semantics: a per-file, content-comparing
  classification (`classifyClaudeAssets`) replaces the existing coarse
  present/missing/invalid probe -- absent assets install, byte-identical assets are a
  true no-op, any byte-different conflict refuses the entire command atomically, naming
  every conflicting path. Applies uniformly to every managed asset (commands, skills,
  NOTICE.md) via the existing glob, with zero special-casing. `--no-claude` never
  inspects `.claude/` at all. Nothing in this milestone ever touches the developer's
  global Claude Code configuration.
- New root `AGENTS.md` (generic) and `CLAUDE.md` (Claude-specific) bootstrap files,
  installed non-destructively by `pitway init`: created when absent, left alone when
  byte-identical, preserved untouched with a warning (containing the exact snippet) when
  different/user-authored. Gated on the `.claude/` conflict preflight above running
  first, so a refused Claude-asset install never leaves a partial instruction setup. Wired
  into `milestone-confirm`'s baseline commit content-awarely: a conflicting root file is
  never staged merely because its path is known.
- A shared classification mechanism (`listSafeManagedDirtyPaths`, also unconditionally
  covering PitWay's own `.pitway/config.yaml`/`.pitway/state.yaml` init output) closes two
  further, related Git-safety gaps for real: `quick-change create` and `commit` now succeed
  end-to-end immediately after a fresh `init` when the only dirty paths are
  content-verified PitWay-managed output, while still refusing on any arbitrary extra dirt;
  and `milestone-confirm`'s own baseline staging becomes content-aware for `.claude/`
  assets too (closing a pre-existing, since-M006 gap), never silently committing a
  tampered managed asset.
- New additive-optional `tasks.yaml` field, `required_skills: string[]` (0-2 kebab-case
  names, no duplicates), validated by `taskSchema`; a pre-dispatch context gate --
  `src/state/claude-assets.ts` reads what's actually installed, a pure
  `src/core/tasks/skills.ts` compares that against a task's declared names, and
  `task-status <id> --context`'s CLI layer composes the two -- refuses visibly, naming
  every missing skill, when a declared skill is not installed at
  `.claude/skills/<name>/SKILL.md`.
- A new structural test validating every vendored `SKILL.md`'s frontmatter shape; small,
  targeted `protocol-driver.md`/`dispatch.md` additions documenting when to declare
  `required_skills` and that informal/voluntary skill loading (already practiced live this
  session) never replaces the mandatory independent diff review.
- Real comparative dogfood evidence (a standalone matched-pair dispatch, not a task from
  this milestone's own graph, disclosing the same non-bootstrap gap `mapped_ac_ids`
  disclosed in M007/M008) reported honestly regardless of outcome.
- `IMPLEMENTATION_PLAN.md` reconciliation.

**Out of scope**: claude-config's own mechanical/behavioral validation scripts
(`check-config.sh`/`eval-triggers.sh`) are not adopted or ported -- PitWay's own structural
test (AC006) and this milestone's dogfood evidence (AC007) are the comparable checks,
implemented PitWay's own way. claude-config's own slash commands are not vendored --
PitWay's existing `commands/*.md` already serve a different, unrelated purpose (see the
M007 candidate notes' own explicit non-conflation), and no new PitWay command is added by
this milestone. No change to how a driver invokes a skill (the existing `Skill` tool /
equivalent harness mechanism, entirely outside PitWay's control, unchanged). No adaptation
or rewriting of any vendored skill's content -- all six are generic enough to apply
unchanged; if a future milestone ever finds real PitWay-specific friction, that is a
separate, evidence-driven follow-up, not assumed here. No inspection or modification of
any global (`~/.claude/`) Claude Code configuration, anywhere in this milestone. No
generalized refactor of `assertNoUnexpectedDirtyPaths`'s own small, already-duplicated
filter-and-throw pattern into a new shared helper -- AC005 reuses the existing per-caller
duplication precedent rather than introducing a new abstraction unprompted.

## Change Log

(none yet)
