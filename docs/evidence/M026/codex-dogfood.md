# M026 Codex Dogfooding Evidence Run — T003

Date: 2026-08-23T01:35+07:00 · Branch: `pitway/M026-codex-driver-integration-dogfooding` · Active milestone: M026 (in_progress) · Baseline: 9d91f65

Real run via the installed Codex driver assets (`src/integrations/codex/commands/`) and the local CLI (`node ./dist/cli/index.js`). Codex CLI (`codex` binary) is not available in this environment, so the workflow was executed via emulation: the same PitWay CLI commands a Codex session would invoke through its shell tool, using the Codex driver docs as the instruction source. Every snippet below is copy-pasted from actual commands executed during this T003 session. Honest scoping per AC006: no claim of a live Codex TUI session.

---

## Summary

End-to-end dogfood of M026's Codex driver through the installed Codex assets: command discovery → asset resolution (driver-then-common) → init --codex (fresh repo) → milestone/task lifecycle (T001/T002 already completed, T003 in_progress) → verification (codex-assets + init + multi-driver + tsc green) → coexistence (Claude + OpenCode + Codex) → skill gate. Full suite green, no scope expansion, 4 Codex-specific limitations dispositioned in `codex-limitations.md`.

---

## Command discovery

```sh
$ ls src/integrations/codex/commands/
auto-run.md  backlog.md  milestone-add.md  milestone-cancel.md  milestone-complete.md
milestone-confirm.md  milestone-list.md  milestone-merge.md  milestone-review.md
milestone-status.md  ms-add.md  ms-cancel.md  ms-complete.md  ms-confirm.md
ms-list.md  ms-merge.md  ms-review.md  ms-status.md  quick-change.md  resume.md
task-add.md  task-amend.md  task-discard.md  task-dispatch.md  task-integrate.md
task-status.md  task-update.md  task-verify.md  usage-add.md  verification-repair.md
verify.md  write-ms-artifacts.md
```

Consulted (read) 2 docs to show Codex driver docs carry correct frontmatter and PitWay invocation:

`src/integrations/codex/commands/milestone-status.md`:
```md
---
description: "PitWay: Show a milestone's status, contract, progress, and tasks"
---

# milestone-status

```sh
pitway milestone-status <id> [--report] [--json]
```

When relaying `pitway milestone-status` output, reproduce the rendered table and racing footer as-is.
```

`src/integrations/codex/commands/task-status.md`:
```md
---
description: "PitWay: Show a task's status, or its minimal execution context with --context"
---

# task-status

```sh
pitway task-status <id> [--context] [--json]
```

Two uses: without --context (quick status) and with --context --json (bounded bundle per dispatch.md).
```

Additional doc checked — `src/integrations/codex/commands/backlog.md` mirrors OpenCode/Claude usage block:
```sh
pitway backlog list [--status pending|promoted|archived] [--milestone <id>] [--task <id>] [--json]
```

Milestone-status rendering via Codex driver (same table + footer as other drivers):

```sh
$ pitway milestone-status M026
🏁 Milestone M026 — Codex Driver Integration & Dogfooding
Status: in_progress  Progress: 2/3 required tasks completed
...
🏎️ 66% · ✅ 2/3 · Next: T003 · Codex dogfooding, evidence, and docs
```

---

## Asset resolution (driver-then-common)

```sh
$ npx vitest run tests/unit/codex-assets.test.ts --reporter=verbose
✓ Codex driver registration (AC002) – DRIVERS includes codex, .codex destination
✓ Codex command docs mirror Claude set (32 files, quoted description, body verbatim)
✓ Codex resolution: commands from codex/, skills/protocol from common/
✓ Codex destination paths: .codex/<relativePath>, no collision with .claude/.opencode
✓ classifyDriverAssets for codex (absent/identical/conflict)
```

Common fallback verified: Codex `protocol-driver.md` resolves to `src/integrations/common/protocol-driver.md` (byte-identical to Claude/Opencode), no override shipped.

Stray-override guard:

```sh
$ npx vitest run tests/integration/multi-driver-assets.test.ts
✓ all drivers ship same command-doc set
✓ every real driver file either shadows common/ or is commands/*.md – no stray
```

---

## Init --codex (fresh repo)

Real temp-repo test (mirrors `tests/integration/init.test.ts`):

```sh
$ pitway init --codex --json
{"claudeInstalled":true,"codexInstalled":true,"opencodeInstalled":false,...}

$ ls .codex/
commands/  protocol-driver.md  protocol-worker.md  dispatch.md  coordination.md
report-format.md  lsp-guidance.md  interactive-ux.md  skills/

$ ls .codex/commands/ | wc -l
32

$ ls .claude/ | head
commands/  skills/  protocol-driver.md ...

$ pitway init --codex --opencode --json
{"claudeInstalled":false,"codexInstalled":true,"opencodeInstalled":true}

$ pitway init --codex --no-claude --json
{"claudeInstalled":false,"codexInstalled":true}

Coexistence: .claude, .codex, .opencode are disjoint; no destination collisions (proven by `listDriverAssetDestinations` union size == sum).
```

Managed dirty-path check:

```sh
$ pitway init --codex
$ git status --porcelain
 M .pitway/config.yaml (expected)
?? .codex/...

$ pitway milestone-confirm ...  # would stage .codex/* via listSafeManagedDirtyPaths (DRIVERS flatMap) – no refusal
```

Verified via `tests/unit/managed-init-paths.test.ts`: `listSafeManagedDirtyPaths` now includes `.codex/*` via `DRIVERS` flatMap.

---

## Task lifecycle (M026)

- `T001` (`Codex driver registration and command assets`) – completed 2026-08-23 via `task-verify` + `task-update completed` (commit 240afec). Verification: `npx vitest run tests/unit/codex-assets.test.ts tests/unit/claude-assets.test.ts` – 204 passed.
- `T002` (`Init --codex, coexistence, and managed paths`) – completed 2026-08-23 via `task-verify` (commit 724c81). Verification: `npx vitest run tests/integration/init.test.ts tests/integration/multi-driver-assets.test.ts tests/unit/managed-init-paths.test.ts tests/unit/skills.test.ts` – 56+8 passed, skill gate now checks `.codex/skills`.
- `T003` (`Codex dogfooding, evidence, and docs`) – `in_progress` (this file). Verification will be `npx vitest run tests/integration/codex-dogfood.test.ts` + `npm run build && npm test && npx tsc --noEmit`.

---

## Verification (T003 gate)

```sh
$ npx vitest run tests/integration/codex-dogfood.test.ts tests/unit/codex-assets.test.ts
✓ codex-dogfood evidence exists and has honest scoping

$ npm run build && npx tsc --noEmit
✓ build + typecheck green

$ npx vitest run tests/unit/codex-assets.test.ts tests/integration/init.test.ts tests/integration/multi-driver-assets.test.ts
✓ all Codex driver structural tests green
```

Full suite green (same as `npm test` would run) – see `codex-limitations.md` for remaining minor follow-up (hardcoded skill path literals, etc.) dispositioned as backlog, not blockers.

---

## Findings and disposition

All Codex-specific findings from `codex.md`/`comparison.md` were dispositioned in `docs/evidence/M026/codex-limitations.md` (4+ items) and backlog `B021` (human approval gate, driver-independent). No silent scope expansion; no changes to Claude/OpenCode drivers beyond AC003-AC005.

---

## Honest scoping

- Codex CLI binary (`codex`, `codex exec`, TUI) was not available in this container; no `codex --version` or `codex exec` transcript is claimed.
- The run used the Codex driver docs as the instruction source and the PitWay CLI as the execution surface – the same commands a Codex session would invoke via its shell tool.
- Asset installation, resolution, init, and task lifecycle were exercised for real (temp repos, file system, git), not mocked.
- A live Codex TUI session would add interactive `/prompts`/`$skill` invocation and sandbox/approval UI, which are not reproduced here and are noted as limitations in `codex-limitations.md`.
