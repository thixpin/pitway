---
schema_version: 1
id: M015
title: PitWay Milestone Review
status: in_progress
requirement: null
confirmed_at: 2026-08-20T16:37:15Z
verification_approved_hash: sha256:9f7bb19d9ff518cef6aaeb02942f1275abd9b56eb438dc682f49a4e11de261e0
base_branch: null
base_revision: null
acceptance_criteria:
  - id: AC001
    text: "Review state is a committed, milestone-scoped schema-v1 file:
      `reviews.yaml` in the milestone directory, with `reviewsFileSchema` in
      `src/state/schemas.ts` and load/save in `src/state/store.ts` following
      `verification-results.yaml`'s exact precedent. An absent file loads as
      empty (no migration for M001-M014; the file is created on first write,
      never by milestone-add). Shape: `sessions[]`, each with a generated id
      (`rev-<hex>`), `status: open | decided`, `created_at`, the selected
      `roles[]`, a `content_hash` (sha256 over a canonical JSON projection of
      the contract's own CONTENT — `id`, `title`, `requirement`,
      `acceptance_criteria`, `verification` — PLUS the raw body text, PLUS a
      canonical JSON projection of every task's DEFINITION — id, name,
      objective, depends_on, acceptance_criteria,
      context_files/write_scope/relevant_files, mapped_ac_ids, required_skills,
      verification — deliberately excluding, on BOTH the contract and task
      sides, every execution/lifecycle field: `status`, `confirmed_at`,
      `verification_approved_hash`, `base_branch`, `base_revision` on the
      contract; `status`/`attempts`/`result`/`usage` on tasks: reviewers review
      the milestone's CONTENT, and execution telemetry is not a revision, so
      task transitions AND `milestone-confirm`'s own status promotion
      (draft→confirmed→in_progress, which also sets `confirmed_at` and
      `verification_approved_hash`) never stale a session while a real
      `task-amend`/`--replace`/`--amend` correctly does; the same
      canonicalize-then-hash discipline as `verification_approved_hash`, which
      hashes the canonical verification block, never raw file bytes),
      `findings[]` (append-only full per-role snapshots — newest snapshot per
      role wins, mirroring quick_change's derive-latest pattern; the
      finding-ENTRY schema is owned HERE, not by AC005: `severity: blocker |
      major | minor`, `finding` text capped at 1000 chars, optional `targets[]`,
      `recommendation` capped at 300 chars, optional `conflicts_with` role ids —
      the same capField discipline task results already use, because reviewer
      subagents are the writers and committed state stays concise, never a
      transcript), and a nullable `decision` (`outcome: accepted |
      revision_requested | rejected`, optional note capped at 300 chars,
      `decided_at`). Every review MUTATION (start/record/decide) is
      journal-backed: a new `review_recording` operation type in
      `journalOperationTypeSchema` plus a `reviews.yaml` case in
      `resolveTargetPath`, with the write materialized immediately and the
      journal entry pending until the next checkpoint commit — the exact
      usage-recording/amendment mechanics, which is what makes AC008's
      ride-along wiring nearly free. A role registry in Core
      (`src/core/reviews/roles.ts`) defines exactly nine built-in roles with
      engineering-vocabulary ids and focus texts, as data — `developer` (task
      granularity, implementation feasibility, write_scope accuracy,
      testability, implementation edge cases), `architect` (layering,
      dependencies, invariants, state/concurrency, design consistency,
      agent-agnosticism), `devops` (CI/CD, Git/branching, deployment, rollback,
      infrastructure, observability, operational safety, failure recovery,
      permissions, automation and release risk), `qa` (test strategy and tier
      coverage, verification-check quality and AC-to-check mapping,
      edge/failure/regression cases, evidence quality), `product` (requirement
      coverage, scope, acceptance criteria, product behavior — the backlog doc's
      'UX/product behavior' keeps only the product half here; its UX half
      deliberately moves to the new `ui-ux` role, disclosed), `business`
      (business value, operational impact, cost, risk and priority),
      `business-analyst` (requirement elicitation and traceability,
      acceptance-criteria completeness/testability/measurability,
      requirement-to-contract scope alignment, process fit — distinct from
      `business`, which owns value/cost/priority judgment), `ui-ux` (interface
      and interaction design of the delivered surfaces — for PitWay's CLI:
      command ergonomics, output readability and consistency, terminology,
      error-message clarity and actionability — distinct from `user`, which owns
      end-to-end workflow experience), and `user` (usability, clarity, workflow
      experience and user-facing behavior); role ids are kebab-case strings by
      schema so later registry additions need no schema change, but MVP commands
      accept only registered roles (extensible-by-code, disclosed as the
      deliberate MVP narrowing of the backlog doc's 'extensible role
      identifiers'). Unit tests cover schema round-trips, absent-file default,
      unknown-role rejection at the schema/registry boundary, and
      newest-per-role derivation."
  - id: AC002
    text: "A new top-level command `milestone-review` with subcommands
      (quick-change's registration precedent; surface 21 → 22) — a DISCLOSED
      deviation from the backlog doc's literal `pitway milestone review`
      spacing, matching every existing kebab-case command. `milestone-review
      start <id> --roles <csv>` opens a review session: validates every role
      against the registry (unknown/duplicate/empty refused, naming offenders);
      refuses when the milestone is `completed` or `cancelled` (draft AND
      confirmed/in_progress/review are all reviewable — the backlog doc's
      'before confirmation or implementation'); refuses while another session
      for the same milestone is still `open` (one open session at a time —
      decide it first); computes and stores the `content_hash`; appends the
      session. PitWay manages review STATE only — it never runs a review, spawns
      a reviewer, or claims reviewer independence: the driver dispatches
      reviewers (AC011's protocol docs own that flow). The command registers
      through `registerAllCommands`, and `tests/integration/cli.test.ts`'s
      registered-command-list assertion is updated to 22 IN THIS TASK's own
      scope (the M014 lesson: the command-adding task fixes the surface
      assertion, the milestone gate then never trips on it)."
  - id: AC003
    text: "Interactive role selection, no new runtime dependencies (the
      commander+yaml+zod constraint is binding; `interactive-ux.md`'s arrow-key
      design stays design-only): when `--roles` is omitted AND stdin is a TTY,
      `milestone-review start` presents a plain numbered multi-select prompt via
      `node:readline` (roles listed with their focus one-liners; input like
      `1,3,4`; empty/invalid input re-prompts once then refuses) — implemented
      against injectable input/output streams, with TTY detection reading the
      INJECTED input stream's own `isTTY` (never `process.stdin` directly) so
      tests drive both branches without a real terminal. When `--roles` is
      omitted and stdin is NOT a TTY, refuse with a diagnostic naming the flag.
      `--roles` remains the primary scripted/driver path and the interactive
      prompt never appears when it is supplied."
  - id: AC004
    text: "`milestone-review brief <id> --role <role>` emits one reviewer's brief,
      read-only: the role's registry focus text, the review instructions
      (findings-only mandate — reviewers never mutate or confirm anything; the
      exact findings YAML shape AC005 accepts), the milestone's contract
      (frontmatter + body) and full task list, and the session's `content_hash`
      (so the driver can hand a reviewer self-identifying material). Refuses
      when no session is open, when the role is not part of the open session,
      when the milestone is `completed`/`cancelled` (terminal milestones accept
      no review mutations or briefs — AC007's disposition), or when the current
      contract/task-definition content no longer matches the session's
      definition hash (the milestone's CONTENT moved — stale briefs are refused,
      not silently served; mere execution progress never trips this, per AC001's
      hash scope). `--json` is the machine envelope the driver forwards to a
      dispatched reviewer subagent, mirroring `task-status --context`'s
      bundle-not-duplicated discipline."
  - id: AC005
    text: "`milestone-review record <id> --role <role> --file <yaml>` records one
      role's findings: the input file is validated against a thin wrapper
      reusing AC001's finding-entry schema (no second schema — AC001 owns the
      entry shape and its caps), then appended as a full per-role snapshot
      (append-only; re-recording a role appends a newer snapshot that wins
      derivation, never mutating the prior one), with the mutation
      journal-recorded per AC001. `targets[]` entries are normalized for
      grouping (trimmed, case-folded); an ACnnn/Tnnn-shaped target that names no
      existing criterion/task is ACCEPTED at record time and flagged by the
      report (warn-in-report, never a refusal — disclosed choice: reviewers may
      legitimately target things a revision will rename). Refuses: no open
      session; role not in the session; terminal milestone (AC007's
      disposition); and — the staleness gate — when the current
      contract/task-definition hash no longer matches the session's
      `content_hash`, with a diagnostic saying the milestone's content was
      revised mid-review, a fresh session is needed, and `decide --outcome
      rejected` is the abandonment path for the stale one. An empty findings
      list is valid (a clean review is a result)."
  - id: AC006
    text: "`milestone-review report <id>` renders the collected findings, read-only,
      in both human and `--json` forms — Core builds the report VIEW
      (`src/core/reviews/report.ts`, honesty text included as view data); the
      human renderer lives in the CLI command module, matching the codebase's
      zero-rendering-in-Core convention — distinguishing exactly what the
      backlog doc's Review Output section requires: reviewer role; finding;
      severity (ordered blocker > major > minor); affected targets when given;
      recommendation; and unresolved conflicts/disagreements — derived
      mechanically as (a) any reviewer-declared `conflicts_with` pair and (b)
      any target named by more than one role, listed side by side per target
      (grouping uses AC005's normalized targets; unknown ACnnn/Tnnn-shaped
      targets carry a warning marker). The report renders each role's DERIVED
      (newest) snapshot only, noting a superseded-snapshot count when a role
      re-recorded; superseded history stays in the file, never rendered. Core
      NEVER semantically reconciles: the report's own rendered text states that
      reconciliation is the developer/driver's, and that a reviewer finding is
      opinion-evidence, never proof of facts requiring implementation or runtime
      evidence (the doc's evidence-orientation clause, verbatim honesty). Roles
      selected but not yet recorded are listed as pending, never omitted.
      Discovery: `pitway resume` lists an open review session (milestone,
      session id, roles, recorded/pending counts) — the same
      authoritative-recovery-view discipline as pending quick-changes, additive
      `--json` key, sequential/no-session output byte-identical."
  - id: AC007
    text: "`milestone-review decide <id> --outcome accepted | revision_requested |
      rejected [--note <text>]` closes the open session: `accepted` and
      `revision_requested` refuse while any selected role has no recorded
      findings snapshot (naming the pending roles — deciding over an unfinished
      review must be explicit, so `rejected` alone is permitted with pending
      roles, for abandoning a review); the decision (outcome, optional note,
      timestamp) is persisted on the session and its status becomes `decided`;
      the human output for `revision_requested` names the two sanctioned
      revision paths (`milestone-add --replace` for a draft, `milestone-confirm
      --amend` for a confirmed milestone) — the backlog doc's
      Accept/Revise/Reject with PitWay's own vocabulary, and reviewers/decisions
      never mutate the milestone itself (design principles 4-5, mechanical: no
      review command writes contract.md/tasks.yaml). `milestone-confirm` is
      deliberately NOT coupled to review sessions in MVP (no open-session check
      at confirm) — the existing human gate already owns that judgment;
      disclosed as a decision."
  - id: AC008
    text: "The `reviews.yaml` lifecycle can never deadlock or dangle: because every
      review mutation is journal-backed (AC001's `review_recording` operation
      type + `resolveTargetPath` case), the four task-flow dirty-tree checks
      that already merge journal-pending target paths — `task-update`'s
      in_progress check and completion expectedPaths, `task-verify`'s
      unrelated-dirty check, `task-integrate`'s clean-main-tree check, and
      `milestone-complete`'s own dirty check — expect a
      materialized-but-uncommitted `reviews.yaml` with ZERO call-site changes
      (proven by tests, not edits). Exactly two enumerated allowlists need a
      `reviews.yaml` row, because they are per-file lists that refuse everything
      else even inside the milestone directory: `computeExpectedBaselinePaths`
      (`src/git/baseline.ts` — a reviewed draft must confirm cleanly, its
      reviews.yaml riding the baseline commit) and `milestone-complete`'s
      `completionPaths` (`src/core/milestones/complete.ts` — a review recorded
      after the last task completes rides the completion commit); subset
      semantics keep both rows harmless when the file is absent. Combined with
      AC007's terminal-refusal disposition, every write is guaranteed a future
      checkpoint. Disclosed, acceptable edges: `quick-change`'s and
      `verification-repair`'s clean-tree checks do NOT learn the new path and
      simply refuse while a review write is pending (complete the checkpoint
      first — same as any pending amendment today). Tests prove the full matrix:
      draft-session write rides the baseline commit at confirm; on a CONFIRMED
      milestone, record findings then task-update in_progress succeeds,
      task-verify succeeds, and the completion commit carries reviews.yaml; a
      record after the final task completes rides the milestone-complete commit;
      and a control proving genuinely unrelated dirt still refuses everywhere."
  - id: AC009
    text: "Worktree-guard coverage: `milestone-review` is NOT added to the
      fail-closed guard's read-only allowlist — every subcommand, including
      read-only `brief`/`report`, refuses inside a task worktree (workers have
      no review role; M014/AC005's default-deny covers the new command
      structurally with zero guard changes, and this AC pins that with a test
      rather than assuming it). One integration test proves `milestone-review
      report` refuses inside a real task worktree and works at the main root."
  - id: AC010
    text: "One end-to-end workflow test
      (`tests/integration/milestone-review-lifecycle.test.ts`) proves the full
      review lifecycle against real temp repos: (draft path) start with two
      roles → brief both → record one (findings with a shared target) →
      `milestone-add --replace` revises the draft WHILE the session is open →
      the second role's `record` and any further `brief` refuse on the
      definition-hash gate (`--replace` survives the session; sessions are never
      CLI-addressable by id, so the gate is only exercisable on a still-open
      session) → decide `rejected` (the abandonment path the stale diagnostic
      names) → a NEW session on the revised draft records both roles cleanly →
      report shows severity ordering, the overlap side by side, and the honesty
      text → decide `revision_requested` names the two revision paths;
      (confirmed path) start → record one role → a REAL `task-update` transition
      runs → record the second role SUCCEEDS (execution telemetry never stales
      the definition hash — the interleaving is genuine, not ordered around) →
      decide `accepted`, with AC008's ride-along assertions; plus the
      one-open-session refusal and terminal-milestone refusals."
  - id: AC011
    text: "The installed Claude assets expose the workflow as the driver surface the
      backlog doc names: a new `commands/milestone-review.md` command doc (the
      `/milestone-review` slash surface — the existing per-command doc
      convention is exactly how PitWay commands become Claude slash commands)
      documenting the driver flow: select roles WITH the developer (multi-select
      is the developer's choice, with the doc's three example combinations
      quoted as examples-not-presets); dispatch one reviewer subagent per
      selected role, each receiving ONLY its `brief --json` envelope (bounded
      reviewer context, mirroring task-dispatch's bundle discipline); reviewers
      return findings which the driver records verbatim via `record` (findings
      normalization allowed, invention refused); present `report` to the
      developer; the developer decides. `protocol-driver.md` gains a 'Milestone
      review' section with the same flow plus the disclosures, in §8's
      advisory-honesty register: no REVIEW COMMAND can mutate milestone state
      (AC007's byte-check proves exactly that); a reviewer subagent itself runs
      unconfined outside any worktree guard, so PitWay DETECTS an unsanctioned
      contract/task-definition edit at the next brief/record via the hash gate —
      detection, never prevention — and edits outside hashed content are outside
      PitWay's visibility; PitWay never runs reviews, cannot verify reviewer
      independence or how many subagents actually ran; a recorded finding is
      reviewer opinion, never implementation evidence; and the documented
      practice is decide-before-complete (AC007's terminal disposition). Asset
      discovery stays dynamic (34 → 35); `tests/unit/claude-assets.test.ts` +
      `tests/integration/init.test.ts` gain shipped-and-installed assertions for
      the new doc. Every documented claim must match delivered behavior — no
      aspirational text."
  - id: AC012
    text: "`IMPLEMENTATION_PLAN.md` is reconciled: this milestone is inserted as
      **M015 — PitWay Milestone Review** and the previously planned M015
      (Extended dogfood validation + release increment) is renumbered **M016**
      throughout, including every cross-reference (the third use of the
      M009/M012 renumbering mechanics); §7's command list/count moves to 22 with
      a `milestone-review` table row; §9's asset count moves to 35 with an
      M015-additions bullet; the Bootstrap delivery table adds M014's row
      (M015's own row left for the next reconciliation, per the self-referential
      discipline); the Revised Roadmap gains M015's actual-delivery entry naming
      every disclosed deviation/decision (command-shape spacing,
      known-roles-only MVP, readline-not-arrow-keys, confirm/review uncoupling,
      and the bootstrap disclosure that M015's own pre-confirmation review
      necessarily used the informal M014-style two-reviewer flow — the backlog
      doc's own Scope Notes sanction it as dogfood evidence — so the first real
      `milestone-review` run belongs to M016); the Status paragraph is updated;
      the revision header gains a dated entry."
  - id: AC014
    text: "`README.md` is reconciled with everything actually delivered since its
      last real content update (M008-era, polished later): preserving its
      existing discipline — high-level, count-free, deferring the authoritative
      command surface to `pitway --help`, and never claiming more than
      fresh-clone evidence supports — it gains: (1) the milestone-review stage
      in the How-It-Works lifecycle (prose and the mermaid diagram: an optional
      role-based review loop between Contract and Human Approval, findings-only
      reviewers, developer decision); (2) a short 'Opt-in policies' section
      documenting the two committed repository policies and their byte-identical
      defaults — `git.branch_strategy: main | milestone` (M012) and
      `execution.strategy: sequential | parallel_worktrees` (M014, one-paragraph
      shape: eligibility-gated per-task worktrees, diff-apply integration,
      history indistinguishable from sequential); (3) a one-line mention of the
      permanent progress footer and `milestone-status --report` (M013); (4) the
      Engineering Boundaries table extended with the review boundary (reviewers
      produce findings only; PitWay never runs reviews or verifies reviewer
      independence — the same honesty register as the existing rows, and §8's
      README-states-it-identically discipline for `context_files` is preserved
      untouched). No feature invented, no count hardcoded, no claim beyond
      committed evidence."
  - id: AC013
    text: "The full existing test suite and typecheck pass with the complete
      milestone integrated: `npm test` (all tiers) and `npx tsc --noEmit` both
      clean, run as milestone-level gates exactly once at verification time per
      the verification-granularity discipline — sequential task workflow,
      parallel worktrees, quick-change, and every prior surface unaffected."
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npm test -- tests/unit/review-state.test.ts
  - id: CT002
    criterion: AC002
    type: command
    command: npm test -- tests/integration/milestone-review-start.test.ts
      tests/integration/cli.test.ts
  - id: CT003
    criterion: AC003
    type: command
    command: npm test -- tests/integration/milestone-review-interactive.test.ts
  - id: CT004
    criterion: AC004
    type: command
    command: npm test -- tests/integration/milestone-review-brief.test.ts
  - id: CT005
    criterion: AC005
    type: command
    command: npm test -- tests/integration/milestone-review-record.test.ts
  - id: CT006
    criterion: AC006
    type: command
    command: npm test -- tests/integration/milestone-review-report.test.ts
  - id: CT007
    criterion: AC007
    type: command
    command: npm test -- tests/integration/milestone-review-decide.test.ts
  - id: CT008
    criterion: AC008
    type: command
    command: npm test -- tests/integration/review-state-lifecycle.test.ts
  - id: CT009
    criterion: AC009
    type: command
    command: npm test -- tests/integration/worktree-state-guard.test.ts
  - id: CT010
    criterion: AC010
    type: command
    command: npm test -- tests/integration/milestone-review-lifecycle.test.ts
    timeout_ms: 300000
  - id: CT011
    criterion: AC011
    type: command
    command: npm test -- tests/unit/claude-assets.test.ts tests/integration/init.test.ts
  - id: CT012
    criterion: AC013
    type: command
    command: npm test
    timeout_ms: 600000
  - id: CT013
    criterion: AC013
    type: command
    command: npx tsc --noEmit
    timeout_ms: 300000
  - id: CT014
    criterion: AC011
    type: review
    instruction: Read the delivered commands/milestone-review.md and
      protocol-driver.md 'Milestone review' section against AC011's required
      content and against actual command behavior — confirm the driver flow
      (role selection with the developer, one bounded brief-envelope subagent
      per role, verbatim recording, report, human decision), the three example
      combinations quoted as examples-not-presets, and every disclosure (PitWay
      never runs reviews, cannot verify reviewer independence/concurrency,
      findings are opinion-evidence) are present and match tested reality.
  - id: CT015
    criterion: AC012
    type: review
    instruction: Read the reconciled IMPLEMENTATION_PLAN.md against AC012's list —
      confirm the M015 insertion and complete M016 renumbering — grep EVERY
      'M015' occurrence and classify each as this-milestone vs must-become-M016
      (the known stale lines — the 'renumbered M014–M015' sequencing sentence,
      the Token-Telemetry 'never shifts the M013/M014/M015 renumbering' note,
      and the M014 roadmap entry's 'M015's validation pass' first-real-dispatch
      pointer, which must become M016), command surface 22 and asset count 35
      against the delivered code, the Bootstrap M014 row, the roadmap entry's
      named deviations/decisions including the bootstrap-review disclosure, the
      Status update, and that no M001-M014 history was rewritten beyond the
      sanctioned reconciliation points.
  - id: CT016
    criterion: AC014
    type: review
    instruction: Read the reconciled README.md against AC014's checklist — confirm
      the milestone-review stage appears in both the lifecycle prose and the
      mermaid diagram (an optional role-based review loop between Contract and
      Human Approval, findings-only reviewers, developer decision); the new
      'Opt-in policies' section documents git.branch_strategy (M012) and
      execution.strategy (M014) with their correct byte-identical defaults and a
      one-paragraph parallel-worktrees shape; a one-line mention of the
      permanent progress footer and milestone-status --report (M013) is present;
      the Engineering Boundaries table gained the review-honesty row (findings
      only, PitWay never runs reviews or verifies reviewer independence) while
      the existing context_files row's statement is untouched; and the README's
      existing register — high-level, count-free, defers the command surface to
      pitway --help, claims bounded by fresh-clone evidence — is preserved
      throughout, with no feature invented and no count hardcoded.
---

# M015 — PitWay Milestone Review

## Objective

Deliver the backlog item at `drafts/M015-milestone-review-backlog.md`: a
first-class, role-based milestone review workflow — structured review
sessions with multiple independent reviewer perspectives producing findings
for developer reconciliation, where reviewers never mutate or confirm
anything. PitWay owns the review *state* (sessions, briefs, findings,
decisions); the driver dispatches the actual reviewers.

## Design decisions (binding for this milestone)

1. **PitWay manages review state; the driver runs reviews.** Exactly the
   task-dispatch division: `start`/`brief`/`record`/`report`/`decide` are
   state and validation; dispatching one reviewer subagent per role with a
   bounded brief envelope is the driver's job (AC011's protocol docs).
   PitWay never claims reviewer independence it cannot observe.
2. **Findings are opinion-evidence, never proof.** The report says so in
   its own rendered text; nothing a reviewer records upgrades to
   implementation or runtime evidence (the backlog doc's own
   evidence-orientation clause).
3. **No review command can mutate the milestone — and that is the whole
   mechanical claim.** Revision flows through the existing sanctioned
   paths (`milestone-add --replace`, `milestone-confirm --amend`). A
   driver-dispatched reviewer subagent runs unconfined (no worktree, no
   guard): an unsanctioned contract/task-definition edit is DETECTED by
   the hash gate at the next brief/record, never prevented — §8's
   advisory-honesty register, stated in the docs verbatim. Confirmation
   and completion stay uncoupled from review sessions in MVP — the human
   gate already owns that judgment.
4. **Hash-gated staleness over CONTENT, not execution.** A session pins a
   hash of a canonical contract-CONTENT projection (id/title/requirement/
   acceptance_criteria/verification + body — execution/lifecycle fields
   status/confirmed_at/verification_approved_hash/base_branch/base_revision
   excluded) + a canonical task-DEFINITION projection
   (status/attempts/result/usage excluded) at start; `brief`/`record`
   refuse on mismatch. Real revisions (`task-amend`, `--replace`,
   `--amend`) invalidate; task transitions and confirm's own status
   promotion never do — confirmed-milestone review stays genuinely usable
   mid-execution. Stale findings are refused, never silently attached;
   `decide --outcome rejected` abandons a stale session.
5. **`reviews.yaml` is committed state, journal-backed like amendments**
   (AC001/AC008): every mutation appends a `review_recording` journal
   entry and materializes immediately; the existing journal-pending
   classification makes all four task-flow dirty checks expect it with
   zero call-site edits, and exactly two enumerated allowlists (baseline,
   completion) gain a row. AC007's terminal-refusal disposition
   guarantees every write a future checkpoint — no dangling state,
   ever.
6. **Command shape**: one top-level `milestone-review` with subcommands
   (quick-change precedent; kebab-case like every existing command —
   disclosed deviation from the backlog doc's literal `milestone review`
   spacing). Surface 21 → 22.
7. **Known roles only in MVP**, nine built-ins as registry data with
   schema-level extensible ids — additions are code changes, not schema
   changes (disclosed narrowing of 'extensible role identifiers'). The
   backlog doc's six roles plus three developer-requested additions (`qa`,
   `ui-ux`, `business-analyst`), each with a focus deliberately
   disjoint from its nearest neighbor (`qa` vs `developer` testability;
   `ui-ux` vs `user`; `business-analyst` vs `business`/`product`) so
   multi-role selections stay independent perspectives, not duplicates.
8. **No new runtime dependencies**: interactive selection is a plain
   numbered `node:readline` multi-select with injectable streams;
   `interactive-ux.md`'s arrow-key design remains design-only.
9. **Bootstrap disclosure**: M015's own pre-confirmation review uses the
   informal M014-style two-reviewer flow (the backlog doc's Scope Notes
   sanction exactly that as dogfooding evidence); the first real
   `milestone-review` run belongs to M016's drafting.

## Scope boundaries

- No reviewer execution, scheduling, or independence verification — driver
  territory (decision 1).
- No semantic reconciliation in Core — grouping and side-by-side conflict
  listing only; reconciliation is the developer/driver's.
- No confirm-time coupling to review sessions (decision 3).
- No role-definition files/plugins — registry is code (decision 7).
- No changes to task execution, dispatch, quick-change, or verification
  beyond AC008's expected-path wiring.
- The backlog doc's example role combinations are documentation examples,
  never enforced presets.
- README reconciliation (AC014) is catch-up documentation of already-
  delivered behavior plus this milestone's — never a place where new
  behavior is specified.

## Change Log

- 2026-08-20 — Initial draft from
  `drafts/M015-milestone-review-backlog.md`, displacing Extended dogfood
  validation to M016 per that document's own Timing section.
- 2026-08-20 — Developer-requested role additions before confirmation:
  `qa`, `ui-ux`, and `business-analyst` join the built-in registry (6 →
  9), each with a focus disjoint from its nearest existing neighbor.
- 2026-08-20 — Developer-requested README reconciliation added before
  confirmation (AC014/T012): README catches up on M012-M014's delivered
  opt-in policies and gains this milestone's review workflow, keeping its
  count-free, evidence-bounded register.
- 2026-08-20 — Draft revised before confirmation, folding in two
  independent pre-confirmation reviews (Senior SWE + Senior Solution
  Architect): reviews.yaml lifecycle redesigned journal-backed
  (review_recording operation type; only the baseline/completion
  allowlists gain rows — both reviewers proved the drafted wiring missed
  milestone-confirm and milestone-complete's per-file allowlists); the
  content hash rescoped from raw tasks.yaml bytes to a canonical
  task-DEFINITION projection so confirmed-milestone review survives real
  task execution; AC010's draft-path narrative reordered around the
  revise-while-open flow (sessions are not CLI-addressable); the
  'mechanically guarantees reviewers never mutate' claim rewritten to
  detection-not-prevention honesty; terminal-milestone refusals unify
  brief/record/decide with the abandoned-by-refusal disclosure; report
  view/render split per the zero-rendering-in-Core convention; resume
  gains open-session discovery; missing T004 dependency edges, findings
  caps, target normalization, parseAsync switch, and injected-stream TTY
  detection all pinned at drafting.
- 2026-08-21 — Gate-caught defect fix (T008's real-lifecycle test, the
  M012/T005-M013/T008-M014/T011 widening precedent): `content_hash`'s
  contract-side component was implemented as literal raw `contract.md`
  file bytes, so `milestone-confirm`'s own status/confirmed_at/
  verification_approved_hash rewrite staled every session opened before
  confirm — directly contradicting decision 4 ("confirm's own status
  promotion never [stales a session]") and AC001's own "never raw file
  bytes" precedent-match to `verification_approved_hash`. Corrected to a
  canonical content-only projection of the contract's frontmatter
  (id/title/requirement/acceptance_criteria/verification) + body,
  excluding the same class of execution/lifecycle fields the task-side
  projection already excluded. AC001's text and decision 4 both corrected
  to match; `computeReviewContentHash`'s signature changed from raw text
  to the parsed contract (`src/core/reviews/roles.ts`,
  `src/core/reviews/session.ts`, `tests/unit/review-state.test.ts` —
  T008's write_scope widened to cover the fix and its existing unit
  tests, since it was T008's own real-lifecycle test that caught this).
- 2026-08-21 — Drafting-gap fix, caught at T012's own start: T012's task
  text already named "CT016" as its review-type verification check, but
  no CT016 was ever actually drafted into this contract's `verification:`
  array (AC014 was added late, before confirmation, and its check was
  missed). Added CT016 (type: review, criterion: AC014), mirroring
  CT014/CT015's own instruction style, so T012's own verification
  strategy (`manual`, "Reviewed against AC014's checklist (CT016)") names
  a check that actually exists.
