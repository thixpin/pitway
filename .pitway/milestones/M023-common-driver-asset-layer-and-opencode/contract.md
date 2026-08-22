---
schema_version: 1
id: M023
title: Common Driver Asset Layer and OpenCode Integration
status: completed
requirement: null
confirmed_at: 2026-08-22T03:54:04Z
verification_approved_hash: sha256:bf89db057119cf7de651f394f3df3221dd24cdd2255d28c150ac8384a4191453
base_branch: main
base_revision: 1fe95cae884e5c8db52a51146d8c208d58297cc0
acceptance_criteria:
  - id: AC001
    text: "A new src/integrations/common/ directory holds every text asset whose
      content is genuinely driver-agnostic: the 6 vendored skills
      (skills/*/SKILL.md, Agent Skills open standard -- M022 comparison.md
      Finding 1 confirms Claude Code and OpenCode implement the same spec),
      skills/NOTICE.md, and the 7 protocol docs (protocol-driver.md,
      protocol-worker.md, dispatch.md, coordination.md, report-format.md,
      lsp-guidance.md, interactive-ux.md -- pure PitWay-workflow prose, not
      Claude-specific). Content moves verbatim, byte-for-byte, from
      src/integrations/claude/ -- never rewritten in the move.
      src/integrations/claude/ retains only its own genuinely driver-specific
      content: exactly 24 canonical command docs (Claude Code's own
      description/argument-hint frontmatter convention) plus the 8 ms-*.md
      aliases -- 32 command files total; no automated check hardcodes these
      counts, deriving the expected set from glob discovery of claude/commands/
      instead."
  - id: AC002
    text: "A resolution function in a new module, src/state/driver-assets.ts (named
      explicitly per the pre-confirm architect review; claude-assets.ts's
      existing exports delegate to it with unchanged signatures), resolves each
      logical asset name (e.g. skills/debugging, protocol-driver,
      commands/milestone-status) to a source file for a given driver: check
      src/integrations/<driver>/ for a matching file first; if absent, fall back
      to src/integrations/common/. This is a flat, static, two-tier lookup over
      a hardcoded two-driver list (claude, opencode) -- no dynamic driver
      discovery/registration, no manifest file, no template engine, no
      translation/compile step, no general plugin or adapter framework.
      Recursive glob discovery within each of the three source directories
      (common/claude/opencode) is retained exactly as today's listMarkdownAssets
      already works -- only the fallback step is new."
  - id: AC003
    text: "Claude Code's installed output is byte-for-byte identical to what shipped
      before this milestone, proven by two distinct tests with declared
      lifecycles (per the pre-confirm architect review): (a) a ONE-TIME
      MIGRATION CHECK -- an inline sha256 hash manifest inside
      tests/unit/claude-assets.test.ts (no separate fixture file) pinning every
      pre-refactor asset path+content; its declared lifecycle is that it exists
      to prove THIS milestone's move was lossless, and a later milestone that
      legitimately edits a common/ asset regenerates or retires it with that
      edit, never treats it as frozen forever; and (b) the DURABLE INVARIANT --
      a resolution-equivalence test asserting the claude-driver overrides union
      common fallbacks (driver wins on any collision) exactly equals the
      installed set, which outlives the migration check and never pins
      historical content. Existing Claude Code users see zero behavior change."
  - id: AC004
    text: "CLAUDE.md's MVP-boundary sentence ('No other adapters, no plugin system
      in MVP') is amended to: 'Additional drivers may ship as text-asset
      integrations only, under src/integrations/<driver>/, sharing common assets
      from src/integrations/common/ via a static, hardcoded common-to-override
      lookup -- never a runtime-loaded plugin system, never dynamic driver
      registration, never a Core code change, never AI-provider code inside
      Core.' Core's own provider-agnostic constraint sentence is unchanged. This
      wording is taken verbatim from the approved Stage 4 architecture decision
      recorded in this contract's Background."
  - id: AC005
    text: "OpenCode-specific command docs ship under
      src/integrations/opencode/commands/, in OpenCode's own documented
      convention (per docs/evidence/M022/opencode.md: one markdown file per
      command under .opencode/commands/, filename becomes the command name) --
      content mirrors each Claude Code command doc's own description and
      pitway-invocation instruction, re-wrapped for OpenCode's frontmatter
      shape. Skills and protocol docs are NOT overridden for OpenCode; they
      resolve to common/ entirely, unless a real, disclosed incompatibility is
      found during drafting (in which case the specific override and its reason
      are named in completion evidence, not silently added)."
  - id: AC006
    text: "pitway init gains an opt-in OpenCode installation path (a new flag,
      additive alongside the existing default-on Claude installation and its
      --no-claude opt-out), installing the resolved OpenCode asset set into
      .opencode/ with every destination explicitly specified (the
      developer-approved recommended option from the pre-confirm architect
      review): skills at .opencode/skills/<name>/SKILL.md, commands at
      .opencode/commands/<name>.md (both per docs/evidence/M022/opencode.md,
      rechecked against live upstream at T002 start), and the 7 protocol docs at
      .opencode/<name>.md -- root-level, mirroring .claude/'s own protocol-doc
      layout -- so AC008's every-logical-asset resolution test has a complete
      destination spec for both drivers."
  - id: AC007
    text: The content-aware 'managed dirty path' recognition used by
      milestone-confirm's baseline staging and quick-change's clean-tree check
      (src/git/baseline.ts, currently .claude/-only via
      listClaudeAssetDestinations) is extended to also recognize installed
      .opencode/ managed paths -- so a repo with pitway init --opencode already
      run doesn't refuse milestone-confirm/quick-change create on its own
      freshly-installed, byte-identical OpenCode assets, exactly as already true
      for Claude Code today.
  - id: AC008
    text: "Structural verification only, honestly scoped to what this environment
      can actually do: an automated test proves every logical asset resolves to
      the correct source and destination path for both drivers, that installing
      both drivers into the same repo produces no destination-path collision,
      and -- the stray-override guard from the pre-confirm architect review --
      that every file in a driver directory either shadows an existing common/
      relative path or belongs to that driver's declared driver-specific class
      (commands/*.md including ms-*.md): anything else (e.g. a typo'd override
      filename that would silently install as a NEW asset instead of shadowing
      its common counterpart) fails the test by name, with the expected set
      derived from glob discovery, never a hardcoded count. Real, end-to-end
      OpenCode-driven dogfood (an actual OpenCode session executing a real
      PitWay milestone) is explicitly recorded as a manual, developer-run
      follow-up outside this milestone's own execution -- no OpenCode CLI is
      available in this environment to invoke, and this milestone never claims
      that dogfood was performed."
  - id: AC009
    text: "The required_skills pre-dispatch gate (src/core/tasks/skills.ts,
      currently reads .claude/skills/ only) is explicitly left unchanged by this
      milestone -- a disclosed limitation, not a silent decision: PitWay has no
      state tracking which driver is currently driving a session, so there is no
      principled way to choose which directory the gate should check yet.
      Recorded as a candidate backlog item at completion, not fixed here."
  - id: AC010
    text: The full test suite and tsc --noEmit stay green throughout.
  - id: AC011
    text: "B008 (developer-reported 2026-08-22, inserted mid-milestone by explicit
      developer decision; append-behavior extension added by a second developer
      directive the same day): pitway init's root instruction files are
      restructured around a delimited PitWay-managed block. (a) Dedup:
      CLAUDE.md's PitWay content becomes a thin pointer using Claude Code's own
      documented AGENTS.md bridge -- the @AGENTS.md import
      (docs/evidence/M022/claude-code.md section 4) -- plus the
      .claude/protocol-driver.md pointer; the 5 SHARED_BULLETS live only in
      AGENTS.md's content. (b) Managed block: each file's PitWay content is
      wrapped in explicit HTML-comment markers (<!-- pitway:managed:start --> /
      <!-- pitway:managed:end -->, invisible in rendered markdown) -- the marked
      block is the one and only region PitWay ever owns in these files, the
      forward-looking contract a future `pitway update` command (still
      explicitly out of scope) will rely on to modify ONLY PitWay's portion. (c)
      Append on existing user files: when AGENTS.md or CLAUDE.md already exists
      and was NOT made by PitWay (no managed block present, content not a known
      legacy PitWay-generated form), init APPENDS the marked block to the
      existing file -- replacing the former preserve-untouched behavior, per
      explicit developer directive. (d) Legacy migration: a file whose entire
      content byte-equals a known prior PitWay-generated form (the pre-B008
      full-content constants) is PitWay-authored and is rewritten to the new
      marked form outright -- never appended-to, which would duplicate content.
      (e) A file whose managed block exists but differs from current content is
      left unmodified by init and reported (the future update command's job, not
      init's). Tests prove each of the five cases (a)-(e)."
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npx vitest run tests/unit/skills-structure.test.ts
  - id: CT002
    criterion: AC002
    type: command
    command: npx vitest run tests/unit/claude-assets.test.ts
  - id: CT003
    criterion: AC003
    type: command
    command: npx vitest run tests/unit/claude-assets.test.ts
      tests/integration/build-bin.test.ts
  - id: CT004
    criterion: AC004
    type: manual
    instruction: Review CLAUDE.md's diff against the exact approved wording quoted
      in this contract's Background.
  - id: CT005
    criterion: AC005
    type: manual
    instruction: Review src/integrations/opencode/commands/ against
      docs/evidence/M022/opencode.md's documented convention and each source
      Claude Code command doc's own content.
  - id: CT006
    criterion: AC006
    type: command
    command: npx vitest run tests/integration/init.test.ts
  - id: CT007
    criterion: AC007
    type: command
    command: npx vitest run tests/unit/managed-init-paths.test.ts
  - id: CT008
    criterion: AC008
    type: command
    command: npx vitest run tests/integration/multi-driver-assets.test.ts
  - id: CT009
    criterion: AC009
    type: manual
    instruction: Confirm src/core/tasks/skills.ts is unchanged (git diff empty for
      that file) and that the limitation is recorded in completion evidence and
      the backlog.
  - id: CT010
    criterion: AC010
    type: command
    command: npm run build && npm test && npx tsc --noEmit
  - id: CT011
    criterion: AC011
    type: command
    command: npx vitest run tests/unit/root-instructions.test.ts
      tests/integration/init.test.ts
---

# M023: Common Driver Asset Layer and OpenCode Integration

## Background

This is Stage 4 of the developer's original multi-stage plan (see M020 and
M022's own Background sections). M022 (Agent Driver Format Research)
produced sourced, evidence-backed findings across 7 agent coding tools.
Based on those findings, the following architecture decision was proposed
and reviewed in conversation:

**Decision: a narrow hybrid, not a canonical format, not MCP-primary, not
an unchanged boundary.** Reuse existing open standards verbatim (Agent
Skills for skills, `AGENTS.md` for rules -- both already near-zero-cost per
M022's findings); extend PitWay's existing text-asset pattern (M011's own
precedent) to one additional driver (OpenCode); do not invent a
PitWay-native format or a general adapter/plugin framework; evaluate MCP
separately, later, as a possible *additional* surface, not a replacement.

**Revision during design review**: rather than fully duplicating every
integration file per driver (the original proposal), assets are organized
as a common layer with per-driver overrides, resolved by a simple static
fallback rule -- driver-specific asset, else common. This is not a
template engine or translation layer: it is a two-tier file lookup over a
fixed, hardcoded manifest, applied only to `src/integrations/`, entirely
outside Core.

**MVP-boundary amendment, exact approved wording** (see AC004):

> Additional drivers may ship as text-asset integrations only, under
> `src/integrations/<driver>/`, sharing common assets from
> `src/integrations/common/` via a static, hardcoded common-to-override
> lookup -- never a runtime-loaded plugin system, never dynamic driver
> registration, never a Core code change, never AI-provider code inside
> Core.

Core's own provider-agnostic constraint is untouched by this milestone in
every respect.

## Design Decisions

- **OpenCode is the second driver**, per the original spec and M022's own
  finding that it is "deliberately spec-faithful," single schema-validated
  config, with documented Claude Code compatibility fallbacks already --
  the lowest-friction second driver of the six candidates surveyed.
- **Byte-parity for Claude Code is the load-bearing safety check.** The
  common-layer refactor changes internal sourcing, not shipped behavior;
  AC003's regression test is what makes that provable, not just asserted.
- **No dogfood theater.** This environment cannot run OpenCode. AC008
  states plainly what was and wasn't verified, rather than implying an
  end-to-end run happened when it didn't.
- **Two known limitations disclosed, not silently absorbed**: the
  `required_skills` gate stays `.claude/`-only (AC009) since PitWay has no
  "current driver" state to resolve against yet; and any real
  skill/protocol-doc incompatibility discovered for OpenCode during
  drafting becomes a disclosed override, never silently forced into
  `common/` to keep the directory tidy.
- **Explicitly out of scope**: `pitway update`, a canonical PitWay-native
  format, MCP exposure, any third driver, and **the Stage 4 decision's
  AGENTS.md half** -- PitWay already ships root-level `AGENTS.md` +
  `CLAUDE.md` verbatim since M011, which per M022's findings OpenCode
  reads natively (`AGENTS.md` is its native instructions file); no new
  per-driver rules-file work is needed or performed here, and any future
  rules-file change is a separate decision. Each is a separate future
  decision.

## Change Log

- 2026-08-22: Initial draft.
- 2026-08-22: Revision per milestone-review (session rev-4d6be75ae702,
  architect, revision_requested, all 8 findings accepted): skills.ts
  removed from T001's objective/write_scope (reads the installed
  destination, not the moved source tree -- AC009/CT009 authoritative);
  AC003 respecified as a one-time inline hash-manifest migration check
  with a declared lifecycle plus a durable resolution-equivalence
  invariant; AC006 names explicit .opencode/ destinations for all asset
  classes including the 7 protocol docs at .opencode/<name>.md
  (developer-approved recommended option); command counts reconciled (24
  canonical + 8 aliases = 32, glob-derived in tests, never hardcoded);
  T002 now mandates a live-upstream OpenCode layout recheck before any
  asset is written; the resolution module is named
  src/state/driver-assets.ts in both T001 and T002 write_scopes; AC008
  gains the stray-override guard; AGENTS.md explicitly added to the
  out-of-scope list with its deferral reasoning.
- 2026-08-22: Mid-execution insertion by explicit developer decision
  (B008, developer-reported): AC011/CT011 added -- init-generated
  CLAUDE.md duplicates AGENTS.md's shared bullets verbatim and even
  points at AGENTS.md for the content it just restated; fixed by making
  CLAUDE_MD_CONTENT a thin @AGENTS.md-import pointer per Claude Code's
  own documented bridge (M022 evidence). Inserted as T004 via task-add,
  depending on T001 (both touch the root-instruction install surface;
  sequencing avoids a write-scope-adjacent collision with the in-flight
  refactor). The AGENTS.md out-of-scope deferral note above is narrowed,
  not reversed: no per-driver rules-file work is added -- this is a dedup
  fix to content PitWay already generates.
- 2026-08-22: AC011 extended by a second explicit developer directive:
  root instruction files gain a delimited PitWay-managed block
  (HTML-comment markers); init now APPENDS the marked block to a
  pre-existing user-authored AGENTS.md/CLAUDE.md (replacing the former
  preserve-untouched behavior for these two files), rewrites known legacy
  PitWay-generated content to the marked form outright, and leaves a
  present-but-differing managed block for the future `pitway update`
  command (still out of scope) whose only-modify-the-managed-block
  contract this block structure establishes. T004 amended accordingly
  (task-amend, same day).
