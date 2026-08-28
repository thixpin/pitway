---
schema_version: 1
id: M040
title: Orchestrator Role Architecture
status: in_progress
requirement: null
confirmed_at: 2026-08-28T10:02:02Z
verification_approved_hash: sha256:65371849591f35e54603d572c1b891be618a8f95841ca1fb8dc06fae01f4b1ce
base_branch: main
base_revision: 60e161dc8d565822273eec88df6d0f8e18c112ae
acceptance_criteria:
  - id: AC001
    text: The requirement draft is reframed in place
      (drafts/pitway-orchestrated-worker-requirement.md) so that the
      Orchestrator is a driver-protocol ROLE shipped as a common text asset --
      never a PitWay runtime component, agent, plugin, or multi-agent framework
      -- and every statement of workflow-state access reads "via pitway
      commands, never .pitway/ directly". Sections 7-9 (usage attribution,
      milestone-level usage, cost/efficiency) are moved out into a separate
      draft, drafts/pitway-usage-attribution-requirement.md, that cites
      docs/evidence/M009/token-accounting-feasibility.md as its constraint, is
      explicitly gated on a Token Telemetry Spike, and promises only measured
      segments plus missing counts -- never exact milestone totals or percentage
      splits.
  - id: AC002
    text: An architecture decision record exists at
      docs/architecture/orchestrator-role.md recording four explicit,
      developer-approved decisions with rationale and rejected alternatives --
      (1) the Main Agent vs Orchestrator CLI responsibility partition, listing
      every pitway command by owning role (gate commands milestone-confirm,
      milestone-confirm --amend, milestone-complete, milestone-merge,
      milestone-cancel, task-amend, task-add, quick-change commit, and
      milestone-review decide stay with the Main Agent; execution commands
      task-update, task-verify, task-dispatch, task-integrate, task-discard,
      verify, usage-add, backlog add, and milestone-review start/brief/record go
      to the Orchestrator; workers call nothing); (2) Orchestrator identity --
      persistent across one milestone versus fresh per milestone -- decided with
      dispatch.md's sequential-chain context-isolation trade-off applied to the
      Orchestrator itself; (3) the four usage buckets Main / Orchestrator /
      Worker / Auxiliary, with Auxiliary defined per the M009 record's three-way
      session partition so nothing is silently folded into another bucket; (4)
      future usage-schema migration requirements -- how today's task.usage,
      usage.yaml planning/qa, and review-role usage map onto the buckets,
      additive-only, null-preserving, never estimated.
  - id: AC003
    text: The decision record contains a gate classification table that
      distinguishes protocol-enforced approval gates (instruction-pinned,
      detected in review, never prevented at runtime -- B021's honest limit)
      from runtime-enforced guarantees (state machines, write_scope,
      verification hash approval, commit trailers, git safety, worktree
      lifecycle), naming for every gate in the partition which class it is in.
      No gate is described as runtime-enforced unless Core code actually refuses
      it.
  - id: AC004
    text: The decision record states, with pointers to the existing mechanism, that
      worker context isolation (context-bundle.ts, report-format.md), durable
      state and resume/recovery (.pitway/ + journal, M016 evidence),
      parallel-worktree execution (task-dispatch/integrate/discard,
      checkParallelEligibility), and the driver-independent two-tier asset
      layout are PRESERVED unchanged -- and records that PitWay bounds only the
      supplied bundle, never a worker's or Orchestrator's total harness context.
  - id: AC005
    text: src/integrations/common/protocol-orchestrator.md ships as a common text
      asset beside protocol-driver.md and protocol-worker.md, installs to
      <driver-dir>/protocol-orchestrator.md for claude, opencode, and codex
      through the existing resolver with no change to
      src/state/driver-assets.ts, and states the Orchestrator role's rules --
      the CLI partition from AC002, "never .pitway/ directly", surfacing every
      human decision to the Main Agent rather than deciding, honoring every
      existing worker/dispatch/coordination rule verbatim by reference, and
      reporting concise structured summaries (report-format.md caps) rather than
      transcripts. protocol-driver.md gains one cross-reference paragraph naming
      the role split and pointing at protocol-orchestrator.md -- no existing
      rule in protocol-driver.md is reworded or removed, and its pinned sha256
      in tests/unit/claude-assets.test.ts is regenerated.
  - id: AC006
    text: Asset tests prove the new protocol doc ships -- present in every driver's
      resolved set and destination list, resolving to common/, and containing
      the CLI-partition and never-.pitway rules -- while every other pinned
      common/claude hash passes unmodified. pitway init on a fresh repo installs
      it for each driver; a repo initialised on 1.1.2 reports drift for exactly
      the two assets this milestone touches -- protocol-orchestrator.md (absent)
      and protocol-driver.md (conflict, from AC005's additive cross-reference
      paragraph) -- and nothing else, which init --reconfigure clears.
  - id: AC007
    text: The decision record ends with a follow-up plan naming the implementation
      milestones that come AFTER these decisions are confirmed, each with its
      prerequisite -- at minimum the Token Telemetry Spike (prerequisite for any
      usage bucket work), a usage-schema migration milestone gated on that
      spike, and a driver-dogfood milestone that runs one real milestone under
      the split roles and records evidence. This milestone implements none of
      them.
  - id: AC008
    text: No Core, CLI, State, or Git source file changes except
      tests/unit/claude-assets.test.ts's pinned-hash tuple and additive asset
      tests; no CLI output changes; full suite and typecheck pass.
verification:
  - id: CT001
    criterion: AC001
    type: review
    instruction: Read drafts/pitway-orchestrated-worker-requirement.md and
      drafts/pitway-usage-attribution-requirement.md. Confirm the Orchestrator
      is described only as a protocol role, every state-access statement routes
      through pitway commands, and the usage draft cites the M009 record, is
      gated on the Token Telemetry Spike, and contains no exact total or
      percentage promise.
  - id: CT002
    criterion: AC002
    type: review
    instruction: Read docs/architecture/orchestrator-role.md. Confirm all four
      decisions are recorded with rationale and rejected alternatives, the
      command partition lists every pitway command, and the identity decision
      references dispatch.md's context-isolation trade-off.
  - id: CT003
    criterion: AC003
    type: review
    instruction: In docs/architecture/orchestrator-role.md, confirm the gate
      classification table exists, covers every gate named in the partition, and
      classifies as runtime-enforced only what Core code actually refuses
      (spot-check three against src/core).
  - id: CT004
    criterion: AC004
    type: review
    instruction: Confirm the decision record's "preserved architecture" section
      points at the real mechanisms (context-bundle.ts, report-format.md,
      journal/resume, task-dispatch family, driver-assets two-tier layout) and
      carries the bundle-only isolation limit.
  - id: CT005
    criterion: AC005
    type: command
    command: npx vitest run tests/unit/claude-assets.test.ts
      tests/unit/codex-assets.test.ts tests/unit/opencode-assets.test.ts
  - id: CT006
    criterion: AC006
    type: command
    command: npx vitest run tests/unit/claude-assets.test.ts
      tests/unit/codex-assets.test.ts tests/unit/opencode-assets.test.ts
      tests/integration/multi-driver-assets.test.ts
      tests/integration/init.test.ts
  - id: CT007
    criterion: AC007
    type: review
    instruction: Confirm the decision record's follow-up plan names the Token
      Telemetry Spike, the usage-schema migration (gated on it), and the
      split-role dogfood milestone, each with its prerequisite, and that nothing
      in this milestone's diff implements any of them.
  - id: CT008
    criterion: AC008
    type: command
    command: npm run typecheck && npm test
    timeout_ms: 900000
---

# Contract

## Objective

Define the Orchestrator role for PitWay as architecture, before any
implementation. The reviewed requirement
(`drafts/pitway-orchestrated-worker-requirement.md`) asks for a "dedicated
Orchestrator Agent"; AGENTS.md forbids exactly that reading -- PitWay is
"not a multi-agent framework … or orchestration service", and drivers ship
as text assets only, never runtime agent code. Today `protocol-driver.md`
already fuses two roles in one: talking to the developer *and* dispatching
workers. This milestone splits that role on paper, decides the four open
architecture questions, ships the Orchestrator's protocol document as a
common text asset, and stops.

It deliberately does **not** touch usage attribution beyond deciding the
buckets and the migration requirements: the M009 token-accounting
feasibility record is the binding constraint (per-instance attribution
needs beta traces; the real partition is three-way with an Auxiliary
bucket; multi-session totals are partial accumulations, never exact), and
the requirement's `MS = Main + Orchestrator + Workers` / `12%/8%/80%`
framing is not supportable today.

## Scope

- **T001 -- Reframe the requirement.** Rewrite the draft in place around
  "Orchestrator = protocol role"; move §§7-9 into a separate, gated usage
  draft that cites the M009 record.
- **T002 -- Decision record.** `docs/architecture/orchestrator-role.md`
  with the four decisions, the gate classification table, the preserved
  architecture section, and the follow-up milestone plan. Each decision
  is presented to the developer in conversation before being recorded as
  decided.
- **T003 -- Ship the protocol.** `src/integrations/common/protocol-orchestrator.md`
  plus one cross-reference paragraph in `protocol-driver.md`; additive
  asset tests; regenerate the one pinned hash the cross-reference changes.
- **T004 -- Full gate.**

T001 and T002 are independent; T003 depends on T002 (the protocol text
restates decisions 1-2); T004 depends on T003.

## Non-Goals

- Implementing an orchestrator, a subagent runner, a scheduler, a
  session/identity registry, or any runtime code that dispatches agents
  -- Core stays agent-agnostic and never imports AI-provider code.
- Implementing usage attribution, buckets, schema changes, or telemetry.
  Decisions 3-4 record *requirements* for a later milestone gated on the
  Token Telemetry Spike; nothing here reads, stores, or displays a new
  usage figure, and no exact milestone total or percentage split is
  promised anywhere.
- Changing any existing rule in protocol-driver.md, protocol-worker.md,
  dispatch.md, coordination.md, or report-format.md; changing any CLI
  output; changing the driver-asset resolver or install layout.
- Changing which commands exist or how they behave. The partition assigns
  existing commands to roles as protocol; it does not add role checks to
  Core (that would be a runtime-enforced gate and is a candidate for a
  follow-up milestone, recorded as such).
- Any quick-change, and any refactoring outside the files named above.

## Change Log

- 2026-08-28: Draft created from the architecture review of
  drafts/pitway-orchestrated-worker-requirement.md.
- 2026-08-28: AC006 amended during T003 -- AC005's required cross-reference
  paragraph changes protocol-driver.md's bytes, so a 1.1.2-initialised repo
  necessarily drifts on two assets (protocol-orchestrator.md absent,
  protocol-driver.md conflict), not one; wording corrected to name exactly
  those two. Verified: init --reconfigure clears both. No scope change.
