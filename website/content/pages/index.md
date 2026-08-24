<!--
  Homepage source. Rendered by website/scripts/build.mjs's fixed pipeline:
  the wrapper emits <meta charset>, <meta viewport>, and a <title> derived
  from the FIRST ATX h1 below -- it does not otherwise read <head> content
  from Markdown. build.mjs cannot be modified by this task, so the meta
  description / canonical / Open Graph tags below are raw HTML embedded at
  the top of this file's body content (marked passes raw HTML blocks
  through unchanged). They land inside the rendered <body>, not the
  wrapper's real <head> -- a known limitation of the current pipeline,
  documented in full in website/templates/homepage.html and
  website/data/homepage.yaml, both of which hold the same values as the
  target contract for whenever a template-aware build step is wired in.
-->

<meta name="description" content="PitWay is an npm-distributed CLI that controls the engineering process around AI coding agents -- contracts, mechanically enforced task boundaries, verification, and durable Git traceability. It is not itself an agent.">
<link rel="canonical" href="https://pitway.thixpin.me/pages/index.html">
<meta property="og:type" content="website">
<meta property="og:title" content="PitWay — The Pit Crew for Agentic Coding">
<meta property="og:description" content="PitWay is an npm-distributed CLI that controls the engineering process around AI coding agents -- contracts, mechanically enforced task boundaries, verification, and durable Git traceability.">
<meta property="og:url" content="https://pitway.thixpin.me/pages/index.html">

[Skip to main content](#main-content)

<header>

<nav aria-label="Primary">

- [Problem](#problem)
- [How It Works](#how-it-works)
- [Contract Scope](#contract-scope)
- [Task Execution](#task-execution)
- [Human + Agent](#human-agent)
- [Resume](#resume-across-agents)
- [Traceability](#durable-traceability)
- [GitHub](https://github.com/thixpin/pitway)
- [npm](https://www.npmjs.com/package/pitway)

</nav>

</header>

<main id="main-content">

<section id="hero">

# PitWay — The Pit Crew for Agentic Coding

A controlled workflow for agentic software development.

PitWay is an npm-distributed CLI that controls the engineering process around AI coding agents. It is not itself an agent: agents drive the interaction, PitWay controls workflow state, engineering boundaries, verification, and traceability.

[Get Started](https://github.com/thixpin/pitway#quickstart) [View on GitHub](https://github.com/thixpin/pitway)

</section>

<section id="problem">

## The Problem

AI coding agents move fast -- and that's exactly the problem. Left unstructured, an agent can drift from what was asked, skip verification, or quietly touch files outside its intended scope, with no durable record of what actually happened or why.

</section>

<section id="how-it-works">

## How PitWay Works

A lightweight summary of the real workflow stages (see `docs/assets/workflow.mmd` for the full canonical diagram):

1. **Backlog** -- a requirement or backlog item starts the cycle.
2. **Contract ⇄ Milestone Review** -- a milestone contract (objective, acceptance criteria, verification checks) is drafted and reviewed.
3. **Human Approval** -- the developer explicitly confirms the contract before any implementation begins. The one mandatory approval gate.
4. **Task Graph** -- the contract is broken into a right-sized set of tasks.
5. **TDD ⇄ Task Verification → Task Commit** -- each task is built RED→GREEN, verified against its own declared check, and committed atomically with `PitWay-Milestone`/`PitWay-Task` trailers. Repeats per task.
6. **Final Full Test** -- a mandatory full test suite gates milestone completion; failure loops back through a milestone revision.
7. **Milestone Complete** -- every task and check has passed.
8. **Milestone Merge** -- the milestone's branch lands into its base branch.

A separate Quick Change lane (TDD → Verify → Commit) handles small bounded fixes against an already-completed milestone, outside full milestone planning.

</section>

<section id="contract-scope">

## Contract-Based Scope Control

Every milestone starts as a contract -- objective, acceptance criteria, verification checks -- reviewed and approved by a human before any implementation begins. `write_scope` mechanically limits what a task may touch. A discovered conflict stops work and proposes a contract change rather than silently expanding scope.

</section>

<section id="task-execution">

## Task Execution

Every task is built test-first (RED→GREEN→REFACTOR) and checked against its own declared verification command before it's considered done, with a mandatory full test suite gating milestone completion. One atomic commit per verified task, carrying `PitWay-Milestone`/`PitWay-Task` trailers.

</section>

<section id="human-agent">

## Human + Agent

Agents drive the interaction; PitWay controls workflow state, engineering boundaries, verification, and traceability. State machines, `write_scope` boundaries, verification gates, commit trailers, and git-safety checks are mechanically enforced -- no driver can bypass them through the CLI. Stopping for human approval gates and bounded worker reports are mandated by the installed protocol documents every driver loads.

</section>

<section id="resume-across-agents">

## Resume Across Coding Agents

Claude Code, OpenCode, and Codex driver integrations all answer to the same CLI, the same state in `.pitway/`, and the same human approval gates. Run `pitway resume` at any time to reconstruct exactly what's going on in the repo and what's next -- from the same driver or a different supported one.

PitWay is not a multi-agent framework; only one driver acts at a time, and what carries over is the persisted workflow state on disk, not an AI session's memory.

</section>

<section id="durable-traceability">

## Durable Traceability

Git commits carry traceable `PitWay-Milestone`/`PitWay-Task` trailers, and workflow state lives in `.pitway/` -- both survive after the AI session that produced them is gone. PitWay creates traceable Git checkpoints without relying on transient AI conversation memory; it does not auto-generate project documentation.

</section>

</main>

<footer>

Built with PitWay by thixpin. 🏎️

[View on GitHub](https://github.com/thixpin/pitway) · MIT License

</footer>
