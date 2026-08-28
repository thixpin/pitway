---
description: PitWay: Reconstruct workflow state from .pitway/ and recommend the next task
---

# resume

**Role:** either (read-only)

```sh
pitway resume [--json]
```

Run this first in any session where you're not already certain what
PitWay's state is — a fresh conversation, after a context reset, after
picking the project back up. It reconstructs workflow state from
`.pitway/` and recommends the next task, so you never have to guess or
reconstruct that by reading `.pitway/` files yourself (which you must
never do — see `../protocol-driver.md`).

**Configuration drift.** `resume` also reports, for each driver already
installed in the project (its destination directory exists), whether any
of its managed assets differ from the version PitWay currently ships
(`classifyDriverAssets` — the same comparison `init` itself uses). When
at least one installed driver has drifted, `resume` shows the affected
driver(s) and exactly one command to run: `pitway init --reconfigure`,
with `--no-claude` appended only when `.claude/` isn't present (so the
suggested command can't silently install Claude into a project that
opted out). This is advisory only — `resume` never runs `init` itself
and never blocks. A drifted asset may be a deliberate local edit or
simply a stale shipped version; PitWay has no way to tell which, so it
reports *that* the asset differs, never *why*.

See `../protocol-driver.md`.
