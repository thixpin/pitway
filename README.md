# PitWay

A controlled workflow for agentic software development.

PitWay is an npm-distributed CLI that controls the engineering *process* around AI coding
agents — it is not itself an agent. Its core philosophy: **Claude drives the interaction; PitWay
controls the workflow state and engineering boundaries.**

PitWay turns a requirement into a milestone, a milestone into a developer-approved contract, a
contract into a right-sized task graph, and each task into TDD-verified, atomically committed
work — with a human confirmation gate before any implementation begins, and every state
transition validated by PitWay's own Core, never hand-edited.

## Quickstart

```sh
npx pitway init
```

Run this once, from the root of a git repository. `init` refuses outside a git work tree with a
clear message (create one with `git init` first); it writes the `.pitway/` state skeleton and
installs the Claude Code integration assets by default (opt out with `--no-claude`).

From there, PitWay's own workflow drives the rest: a milestone is drafted and confirmed only
after you've explicitly approved its contract in conversation, its task graph is dispatched one
task at a time, and every commit PitWay creates carries `PitWay-Milestone`/`PitWay-Task` trailers
tracing it back to exactly the work it was approved for.

## Commands

`pitway --help` is the source of truth for the full command surface — this README does not
duplicate it, since a copy here would drift the moment a command's flags change. Once installed,
the Claude Code integration assets (`.claude/protocol-driver.md`, `.claude/commands/*.md`) are
the source of truth for how a driver session actually uses each command.

## Worker read-boundary enforcement

`context_files` controls what PitWay supplies in a task-context bundle; **it does not restrict
what a dispatched worker may independently read.** `write_scope` remains the one boundary PitWay
mechanically enforces — checked before dispatch and again at completion, refusing to commit any
write outside it. PitWay makes no technical read-isolation claim, because it does not own the
agent runtime, the shell, tool permissions, or any OS-level sandbox — none of the layers where a
real read-enforcement boundary would actually have to live. This is a permanent-until-revisited
design position, not an oversight: revisiting it would require PitWay to adopt an execution
harness with a genuinely enforceable permission boundary, a decision this project has not made.

## Status

PitWay is developed using its own workflow (dogfooding) — every milestone through this one has
been built, verified, and committed through PitWay's own commands. Every claim in this README is
bounded by what this repository's own committed Git history, `.pitway/` state, and test suite
actually demonstrate — never by anything that doesn't survive a fresh clone.

## License

MIT — see [LICENSE](./LICENSE).
