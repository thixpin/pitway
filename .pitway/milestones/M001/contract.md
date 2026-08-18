---
schema_version: 1
id: M001
title: Project scaffold and state layer
status: completed
requirement: null
confirmed_at: 2026-08-18T08:12:50Z
verification_approved_hash: sha256:5cc6287924bc2ccede8f231c627f8018ec6a9b4560b85ac16852821fa6720013
acceptance_criteria:
  - id: AC001
    text: >-
      The repository contains a TypeScript strict-mode ESM project scaffold
      (package name "pitway", MIT license, Node >= 20) where npm install,
      npm run typecheck, and npm test (vitest) all succeed.
  - id: AC002
    text: >-
      Zod schemas and exported TypeScript types exist for every schema v1
      .pitway/ artifact (config.yaml, state.yaml, contract.md frontmatter,
      tasks.yaml, verification-results.yaml, usage.yaml); valid fixtures parse
      and invalid fixtures are rejected with errors naming the offending field.
  - id: AC003
    text: >-
      The state store loads and saves every schema v1 artifact from/to a
      .pitway/ directory with lossless round-trips, enforces schema_version 1,
      rejects unknown schema versions, and reports a clear error for a missing
      or malformed milestone directory.
  - id: AC004
    text: >-
      The contract.md reader/writer splits frontmatter from body, validates the
      frontmatter, and preserves the markdown body byte-for-byte across a
      load/save round-trip.
  - id: AC005
    text: >-
      The task state machine permits exactly the approved transitions
      (planned->waiting->ready->in_progress->review->completed;
      in_progress->blocked->ready; in_progress->failed->ready;
      planned|waiting|ready->cancelled) and rejects every other transition with
      an error naming the allowed target states.
  - id: AC006
    text: >-
      The milestone state machine permits exactly the approved transitions
      (draft->confirmed->in_progress->review->completed;
      review->in_progress; draft|confirmed->cancelled) and rejects every other
      transition with an error naming the allowed target states.
  - id: AC007
    text: >-
      Dependency resolution promotes a waiting task to ready only when all of
      its depends_on tasks are completed, detects dependency cycles, and
      reports unknown dependency references with explicit errors.
  - id: AC008
    text: >-
      All milestone logic is pure: filesystem access is confined to the state
      store module, no module performs git or network I/O, and the unit test
      suite exercises every legal and illegal state transition.
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npm run typecheck
  - id: CT002
    criterion: AC002
    type: command
    command: npm test -- tests/unit/schemas.test.ts
  - id: CT003
    criterion: AC003
    type: command
    command: npm test -- tests/unit/state-store.test.ts
  - id: CT004
    criterion: AC004
    type: command
    command: npm test -- tests/unit/contract-file.test.ts
  - id: CT005
    criterion: AC005
    type: command
    command: npm test -- tests/unit/task-state.test.ts
  - id: CT006
    criterion: AC006
    type: command
    command: npm test -- tests/unit/milestone-state.test.ts
  - id: CT007
    criterion: AC007
    type: command
    command: npm test -- tests/unit/dependencies.test.ts
  - id: CT008
    criterion: AC008
    type: review
    instruction: >-
      Review src/ to confirm core logic is pure (state machines and dependency
      resolution take data in, return data out), filesystem I/O is confined to
      the state store, nothing touches git or the network, and package.json /
      LICENSE match the approved metadata (name pitway, MIT, ESM, Node >= 20).
---

# Contract — M001: Project scaffold and state layer

## Objective

Establish the PitWay project scaffold and implement the foundational state
layer: schema v1 domain types with validation, lossless load/save of all
`.pitway/` artifacts, and the task and milestone state machines with
dependency resolution — as pure, fully unit-tested core logic.

## Scope

- Project scaffold: `package.json` (name `pitway`, ESM, MIT, Node >= 20 engines,
  `typecheck` and `test` scripts), strict `tsconfig.json`, vitest config,
  `LICENSE` (MIT), `.gitignore`, source/test directory skeleton per
  IMPLEMENTATION_PLAN.md §2.
- `src/state/`: zod schemas + TS types for all six schema v1 artifacts;
  state store (load/save/validate, `schema_version` enforcement);
  `contract.md` frontmatter/body reader-writer.
- `src/core/`: task state machine, milestone state machine, dependency
  resolution (ready promotion, cycle and unknown-reference detection).
- Unit tests for all of the above.

## Non-Goals

- No CLI commands (M002/M003).
- No git module or any git operations in code (M002).
- No verification execution, usage recording, or aggregation logic (M004).
- No Claude integration assets, README, or npm packaging (M005).
- No dependency beyond commander/yaml/zod (commander unused until M002).

## References

- IMPLEMENTATION_PLAN.md §§2–6 (structure, domain model, state schema,
  state machines) — the authoritative design for this milestone.

## Change Log
