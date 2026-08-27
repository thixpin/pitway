---
schema_version: 1
id: M035
title: Configuration Drift Detection in pitway resume
status: in_progress
requirement: null
confirmed_at: 2026-08-27T03:29:25Z
verification_approved_hash: sha256:77053ad3035585652edcdfd30be63f0511511be2a23fc3909557fac9e4e7463c
base_branch: main
base_revision: 229be9c3d31dd9313593faa538dc3eac5c91bd6a
acceptance_criteria:
  - id: AC001
    text: "pitway resume detects drift: for each driver whose destination directory
      (.claude/.opencode/.codex) exists, whether classifyDriverAssets(root,
      driver) reports any asset with status other than identical."
  - id: AC002
    text: "When at least one installed driver has drift, pitway resume (human and
      --json output) surfaces an advisory naming the affected driver(s) and
      exactly one ready-to-run command: pitway init --reconfigure, with
      --no-claude appended if and only if .claude/ is not present."
  - id: AC003
    text: When no installed driver has drift, resume's output is unchanged from
      current behavior -- no new field or notice appears, and every existing
      resume test continues to pass unmodified.
  - id: AC004
    text: resume never runs pitway init itself and never blocks or refuses to resume
      because of drift -- detection is advisory only.
  - id: AC005
    text: All three drivers' resume.md command docs document the new advisory
      accurately, including that a non-identical asset may be a deliberate local
      edit or a stale shipped version -- PitWay cannot distinguish the two,
      matching init.ts's own existing honesty caveat.
  - id: AC006
    text: The full test suite continues to pass with the new detection wired in.
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npx vitest run tests/integration/resume.test.ts
  - id: CT002
    criterion: AC002
    type: command
    command: npx vitest run tests/integration/resume.test.ts
  - id: CT003
    criterion: AC003
    type: command
    command: npx vitest run tests/integration/resume.test.ts
  - id: CT004
    criterion: AC004
    type: command
    command: npx vitest run tests/integration/resume.test.ts
  - id: CT005
    criterion: AC005
    type: manual
    instruction: Read the resume.md diff across all three drivers
      (claude/codex/opencode) and confirm it accurately describes the shipped
      detection/advisory behavior, including the
      deliberate-edit-vs-stale-version honesty caveat.
  - id: CT006
    criterion: AC006
    type: command
    command: npm test
---

# Contract

## Objective

`pitway resume` gains configuration-drift detection: for each driver
already installed in the project (`.claude`/`.opencode`/`.codex` exists),
detect whether any of its managed assets differ from the version PitWay
currently ships, reusing the existing `classifyDriverAssets` primitive
(`src/state/driver-assets.ts`) rather than inventing a new detection
mechanism. When drift is found, `resume` surfaces one advisory notice
naming the affected driver(s) and exactly one ready-to-run command. It
never auto-reconfigures and never blocks resume.

The originally proposed example command (`pitway init --reconfigure
--claude --codex`) does not reflect how `--reconfigure` actually works:
`--claude` is not a real flag (only `--no-claude` exists, defaulting
Claude installation ON), and `--codex`/`--opencode` are auto-detected
from directory presence under `--reconfigure` with no flag needed. The
real gap is the opposite direction: a project that opted out with
`--no-claude` would have Claude silently reinstalled by a bare
`--reconfigure`, since `installClaude` has no memory of that opt-out.
The suggested command is therefore always `pitway init --reconfigure`,
with `--no-claude` appended only when `.claude/` is absent.

## Scope

- Detect, for each of the three drivers, whether it is installed and
  whether any of its managed assets have drifted from the shipped
  version.
- Surface a single advisory block in `resume`'s human and `--json`
  output when drift exists, naming the affected driver(s) and the one
  correct command to run.
- Never surface anything when no installed driver has drifted --
  existing `resume` output and tests are unaffected.
- Document the new behavior in all three drivers' `resume.md`.

## Non-Goals

- Auto-running `init --reconfigure` on the developer's behalf.
- Blocking or refusing `resume` because of detected drift.
- Distinguishing *why* an asset differs (deliberate local edit vs. a
  stale shipped version) -- the codebase has no signal for this
  (`init.ts`'s own classification comment says so directly); the
  feature reports *that* it differs, never *why*.
- Any change to `classifyDriverAssets`, `init`, or the driver-asset
  schema itself -- this milestone only consumes the existing primitive.

## Change Log

- 2026-08-27: Draft created.
