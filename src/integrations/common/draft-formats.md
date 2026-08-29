# Draft Artifact Formats

Minimal, validated input formats for PitWay commands that accept draft
files. Every example here is pinned by `tests/unit/draft-formats.test.ts`
against the real production parsers — if the CLI changes what it accepts,
these examples change with it. Copy one, fill in your content, keep the
required shape. All commands also accept `--json` output; these files are
inputs, not outputs.

## Draft contract

Input to `pitway milestone-add --contract <path>` (and the starting point
for drafting with the developer). Frontmatter is machine-authoritative; the
body carries prose plus the append-only `## Change Log` section.

```markdown
---
schema_version: 1
id: M029
title: Short milestone title
status: draft
requirement: null
confirmed_at: null
verification_approved_hash: null
acceptance_criteria:
  - id: AC001
    text: Something observable is true when the milestone ships.
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npm test
---

# Contract

## Objective

One paragraph: why this milestone exists.

## Scope

- In-bounds work.

## Non-Goals

- Explicitly out of bounds.

## Change Log

- 2026-08-23: Draft created.
```

## Draft tasks

Input to `pitway milestone-add --tasks <path>`. Ids are sequential `Tnnn`;
each task declares either `relevant_files` (legacy read+write scope) or the
`context_files` + `write_scope` pair (reads + enforced write boundary) —
never both styles mixed within one task. Every scope entry must be a file
path -- directories are refused at `milestone-add`/`task-add` (M045).

```yaml
schema_version: 1
tasks:
  - id: T001
    name: Land the feature
    objective: Implement the thing end to end.
    status: planned
    depends_on: []
    acceptance_criteria:
      - The thing works and is tested.
    relevant_files:
      - src/thing.ts
      - tests/thing.test.ts
    verification:
      strategy: command
      detail: npx vitest run tests/thing.test.ts
      timeout_ms: 600000   # optional (1..3600000): task-verify budget when --timeout is omitted
    result: null
    usage: null
  - id: T002
    name: Document it
    objective: Update docs for the thing.
    status: planned
    depends_on:
      - T001
    acceptance_criteria:
      - Docs match behavior.
    context_files:
      - README.md
      - src/thing.ts
    write_scope:
      - README.md
    verification:
      strategy: manual
      detail: Read the diff against README.md.
    result: null
    usage: null
```

## Amended contract

Input to `pitway milestone-confirm <id> --amend --file <path>`: the FULL
desired contract (same shape as a draft, but `status` is the milestone's
current non-draft status and `confirmed_at` stays as recorded), with the
change appended to `## Change Log`. The Change Log entry is mandatory — an
amendment without one refuses.

```markdown
---
schema_version: 1
id: M029
title: Short milestone title
status: in_progress
requirement: null
confirmed_at: 2026-08-23T00:00:00Z
verification_approved_hash: sha256:0000000000000000000000000000000000000000000000000000000000000000
acceptance_criteria:
  - id: AC001
    text: Something observable is true when the milestone ships.
  - id: AC002
    text: The discovered addition, added by amendment.
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npm test
---

# Contract

## Objective

One paragraph.

## Change Log

- 2026-08-23: Draft created.
- 2026-08-24: Added AC002/CT002 for the discovered work (developer-approved).
```

## task-add task file

Input to `pitway task-add <milestone-id> --file <path> --change-log "<text>"`.
Omit `id`, `status`, `result`, `usage` — the CLI assigns the next sequential
id and injects the execution fields. `name` is required. Same field rules as
the tasks draft above.

```yaml
name: Ripple fix for the exporter
objective: Fix the exporter regression discovered mid-flight.
acceptance_criteria:
  - Exporter output matches the fixture again.
depends_on: []
relevant_files:
  - src/exporter.ts
  - tests/exporter.test.ts
verification:
  strategy: command
  detail: npx vitest run tests/exporter.test.ts
```

## task-amend partial object

Input to `pitway task-amend <task-id> --file <path> --change-log "<text>"`.
Only these keys are allowed: `objective`, `acceptance_criteria`,
`relevant_files`, `context_files`, `write_scope`, `verification`. Provided
fields replace the task's current ones wholesale; everything else is left
untouched.

```yaml
objective: Updated objective after the developer-approved scope correction.
acceptance_criteria:
  - The corrected behavior holds.
relevant_files:
  - src/exporter.ts
  - src/extra.ts
  - tests/exporter.test.ts
```

## milestone-review findings

Input to `pitway milestone-review record <id> --role <role> --file <path>`
— normally produced by the dispatched reviewer subagent from its brief.
Severity is `blocker | major | minor`; `targets` and `conflicts_with` are
optional; `recommendation` caps at 300 chars, `finding` at 1000.

```yaml
findings:
  - severity: major
    finding: The recovery path assumes HEAD is the baseline commit, which breaks after a merge.
    targets:
      - AC002
    recommendation: Resolve the baseline via the trailer lookup instead of HEAD.
  - severity: minor
    finding: Error message names the wrong flag.
    recommendation: Reword to --target branch.
```
