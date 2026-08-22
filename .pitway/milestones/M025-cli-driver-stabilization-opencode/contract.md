---
schema_version: 1
id: M025
title: CLI & Driver Stabilization + OpenCode Dogfooding
status: completed
requirement: null
confirmed_at: 2026-08-22T15:09:43Z
verification_approved_hash: sha256:00aace861273229995a53690c704df0d0905636de031211a18e69422563af377
base_branch: main
base_revision: 6d9b8b769b61cb9fd4144bcd9b86cd6121ecb5ed
acceptance_criteria:
  - id: AC001
    text: The one-line racing progress footer (M013's computeRacingFooter) appears
      on every human-render CLI surface that reports milestone progress,
      including task-update's completion output (B016). An audit of all such
      surfaces against protocol-driver.md's Progress reporting rule is recorded
      in the owning task's evidence; every surface found missing is wired and
      pinned with a focused test; surfaces already correct stay byte-stable.
  - id: AC002
    text: A reusable terminal table renderer exists (consistent column alignment,
      wrapping-aware, Unicode-safe) with its own unit tests, and
      milestone-status's tables render through it (B012). Existing rendered
      output shape is preserved byte-for-byte unless a change is deliberate and
      covered by updated tests; no other command's output changes.
  - id: AC003
    text: Every installed PitWay command instruction (claude and opencode command
      sets) shows the normal invocation and its common options directly, so an
      agent can act without a --help lookup; --help is referenced only where
      flags or behavior genuinely vary (B014). Structure tests assert presence
      of the usage block per command doc.
  - id: AC004
    text: "The installed protocol text (protocol-driver.md, plus the
      milestone-status/ms-status command instructions) explicitly requires: when
      relaying milestone-status/resume output, reproduce the rendered table and
      racing footer as-is (annotations around them, never prose summaries), and
      end routine progress updates with the footer once a milestone is confirmed
      (B011). Docs-only; no runtime behavior change."
  - id: AC005
    text: "OpenCode driver fidelity for milestone-status: the /milestone-status and
      /ms-status instructions pass the --report argument through correctly
      (B013) and instruct reproducing the racing footer and table structure in
      the chat relay (B015). Covered by adapter/template tests over the shipped
      opencode assets."
  - id: AC006
    text: "The pre-dispatch required_skills gate resolves against every installed
      driver's skills directory (.claude/skills and .opencode/skills), not only
      .claude/skills/ (B009): a required skill installed under either existing
      driver directory satisfies the gate. Real behavioral tests include an
      .opencode-style install."
  - id: AC007
    text: A real OpenCode dogfooding run executes this milestone's own workflow
      end-to-end through the installed OpenCode driver -- command discovery,
      contract handling, task execution, verification, completion -- with the
      actual transcript-level evidence captured in
      docs/evidence/M025/opencode-dogfood.md. OpenCode-specific findings
      discovered during the run are reported there with explicit dispositions;
      backlog capture happens through the existing PitWay workflow/host
      mechanism -- findings are never silently absorbed into scope and .pitway/
      state is never hand-edited.
  - id: AC008
    text: "Strictly stabilization: no new architecture, no scope expansion beyond
      B009-B016 consolidation, the dogfood run, and the three developer-directed
      backlog/workflow improvements (AC010-AC012). The full test suite and tsc
      --noEmit stay green throughout; production diffs are limited to the
      surfaces this contract names."
  - id: AC009
    text: "Governance, binding for this milestone: any amendment to this contract
      must be proposed by the agent and then stop for explicit developer
      approval before the contract is mutated or execution continues; approval
      is recorded before the amending command runs (developer directive
      2026-08-22, backlog B017)."
  - id: AC010
    text: "Backlog list supports efficient review filtering: --status (already
      shipped) plus --milestone <id> and --task <id> filters over each item's
      recorded source, combinable with each other and with --json. Unknown
      filter values refuse by name; list stays read-only."
  - id: AC011
    text: "Backlog review gets a clean human renderer: structured backlog.yaml data
      is never restructured for display purposes; tabular listings render
      through the shared CLI table renderer (T002's), and rich item descriptions
      render as readable terminal/Markdown-formatted text in show/list output.
      --json output is unchanged."
  - id: AC012
    text: The installed protocol text instructs agents to surface unrelated,
      non-blocking issues discovered mid-task immediately -- naming the
      discovering task -- so they are captured as backlog items through the
      existing PitWay workflow/host mechanism; agents never edit .pitway/ state
      directly and are never required to invoke pitway CLI commands themselves.
      Blocking or task-related issues keep following the normal escalation/scope
      rules. Docs-only protocol change, pinned by asset structure tests.
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npx vitest run tests/unit/footer.test.ts
      tests/integration/racing-footer-surfaces.test.ts
      tests/integration/task-update.test.ts
  - id: CT002
    criterion: AC002
    type: command
    command: npx vitest run tests/unit/table-renderer.test.ts
      tests/integration/milestone-status.test.ts
  - id: CT003
    criterion: AC003
    type: command
    command: npx vitest run tests/unit/claude-assets.test.ts
      tests/unit/opencode-assets.test.ts
  - id: CT004
    criterion: AC004
    type: command
    command: npx vitest run tests/unit/claude-assets.test.ts
      tests/unit/opencode-assets.test.ts
  - id: CT005
    criterion: AC005
    type: command
    command: npx vitest run tests/unit/opencode-assets.test.ts
  - id: CT006
    criterion: AC006
    type: command
    command: npx vitest run tests/unit/skills.test.ts
      tests/unit/claude-assets.test.ts tests/integration/task-status.test.ts
  - id: CT007
    criterion: AC007
    type: manual
    instruction: Review docs/evidence/M025/opencode-dogfood.md against the real run
      it documents -- every workflow stage (discovery, contract handling, task
      execution, verification, completion) evidenced, findings dispositioned.
  - id: CT008
    criterion: AC008
    type: command
    command: npm run build && npm test && npx tsc --noEmit
    timeout_ms: 900000
  - id: CT009
    criterion: AC009
    type: manual
    instruction: Confirm every amendment applied to this contract carries recorded
      explicit developer approval made before the amending command ran.
  - id: CT010
    criterion: AC010
    type: command
    command: npx vitest run tests/integration/backlog.test.ts
      tests/unit/backlog-state.test.ts
  - id: CT011
    criterion: AC011
    type: command
    command: npx vitest run tests/integration/backlog.test.ts
      tests/unit/table-renderer.test.ts tests/unit/backlog-render.test.ts
      tests/unit/backlog-state.test.ts
  - id: CT012
    criterion: AC012
    type: command
    command: npx vitest run tests/unit/claude-assets.test.ts
      tests/unit/opencode-assets.test.ts
---

# M025: CLI & Driver Stabilization + OpenCode Dogfooding

## Background

M024's dogfooding surfaced a cluster of CLI-output, reporting-consistency,
command-usability, and driver-fidelity items (backlog B009-B016) plus a
standing desire to validate the OpenCode driver on a real run rather than a
synthetic one. This milestone consolidates those items into focused,
independently executable stabilization tasks and then uses the milestone
itself as the OpenCode dogfooding vehicle: the workflow is driven end-to-end
through the installed OpenCode driver and the experience is captured as
evidence.

## Objective

Stabilize what ships: consistent racing-footer reporting across CLI surfaces,
one shared table renderer, self-sufficient command instructions, explicit
driver relay rules, correct OpenCode argument/footer handling, a
multi-driver required_skills gate, efficient filterable human-readable
backlog review, and an installed automatic-capture rule for unrelated
non-blocking findings -- then prove it all on a real OpenCode dogfooding
pass. No new architecture.

## Design Decisions

- **Consolidation, not redesign**: every task traces to a specific backlog
  item (B009, B011-B016) or one of the three developer-directed additions;
  B010 stays archived (its enforceable half is B011, its CLI audit residue
  folds into AC001).
- **Renderer before relay**: the table renderer (B012) lands so the relay rule
  (B011) and the backlog review rendering reference a stable, reproducible
  rendering worth preserving verbatim.
- **Single-writer serialization over prose promises**: shared files are
  protected by explicit dependency edges, not prose. backlog.ts has one
  writer at a time via T001 -> T008 -> T009. The asset-test/doc writers
  serialize through fan-in points: T003 depends on both T006 and T008;
  T010 depends on T003; T004 depends on T003 and T010; T005 depends on
  T004 -- giving the total order T006/T008 -> T003 -> T010 -> T004 -> T005
  for every shared test file. T003's write_scope enumerates its files
  explicitly rather than claiming a directory while excluding children in
  prose.
- **Dogfood as the gate**: the final task runs the milestone's own workflow
  through the installed OpenCode driver; findings become backlog items or
  evidence, never silent scope growth (AC007).
- **Governance is contractual**: amendment approval (B017) is an acceptance
  criterion with its own manual check (AC009/CT009), not just session memory.

## Change Log

- 2026-08-22: Second post-review revision (developer ruling on session
  rev-9147febe9492, revision_requested): T003's write_scope re-indented so
  all 62 entries are exact-match paths (the malformed final entry merging
  three paths is gone); T010 now declares depends_on [T003] so the shared
  asset-test writer chain is enforced by the graph, not prose; T004 and T005
  each explicitly own the AC003 usage-block additions for the status docs
  they carry (claude and opencode respectively); CT011 now runs
  tests/unit/backlog-render.test.ts; Design Decisions graph description
  corrected to the actual dependency graph (fan-in at T003, no linear
  T006->T008 edge). Scope otherwise unchanged.

- 2026-08-22: Post-review revision (developer ruling on session
  rev-de2b2d1a8892, revision_requested): all five majors and the recurring
  ownership/parallelism minors addressed -- T007 no longer names
  .pitway/backlog.yaml in write_scope (agents report findings in evidence;
  backlog capture happens through the existing PitWay workflow/host
  mechanism, with no direct .pitway/ edits and no mandatory agent pitway
  invocations); AC012/T010 reworded to the same reporting discipline; T005's
  fix path aligned with its scope (markdown-first; suspected mechanics
  defects referred for capture, never fixed out of scope); single-writer
  dependency chains added for every shared file (backlog.ts: T001->T008->T009;
  asset tests/docs: T006/T008 -> T003 -> T010 -> T004 -> T005); T003's
  write_scope now enumerates its 60 command-doc files explicitly instead of
  claiming directories; AC010 made deterministic (malformed values refuse by
  name; well-formed but nonexistent ids yield a clean empty result with
  active filters echoed); backlog.md must document the new filters after
  T008 lands. Intent unchanged; stabilization-only.
- 2026-08-22: Initial draft. Consolidates backlog B009, B011-B016 (B010
  remains archived; its CLI-audit residue is folded into AC001) plus the
  developer-directed OpenCode dogfooding run and the B017 governance rule.
- 2026-08-22: Developer-directed addition while still draft: three
  backlog/workflow improvements folded into the same stabilization scope --
  backlog list filters (--status exists; add --milestone/--task), a clean
  human renderer for backlog review on top of the shared table renderer, and
  an installed automatic-capture rule for unrelated non-blocking issues found
  mid-task (AC010-AC012, T008-T010). Blocking/task-related issues keep the
  normal escalation path. No other scope change.
