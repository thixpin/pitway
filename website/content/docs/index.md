---
description: "The full PitWay documentation: Getting Started, Concepts, Workflow, and Agents -- everything needed to run PitWay's controlled workflow around AI coding agents."
canonical: "https://pitway.thixpin.me/docs/index.html"
ogType: "article"
ogTitle: "PitWay Documentation · PitWay Docs"
ogDescription: "The full PitWay documentation: Getting Started, Concepts, Workflow, and Agents -- everything needed to run PitWay's controlled workflow around AI coding agents."
ogUrl: "https://pitway.thixpin.me/docs/index.html"
ogSiteName: "PitWay Docs"
---
<a class="skip-link" href="#main-content">Skip to content</a>
<header>
<nav aria-label="Primary">
<ul>
<li><a href="/">PitWay</a></li>
<li><a href="/docs/index.html">Docs</a></li>
<li><a href="https://github.com/thixpin/pitway">GitHub</a></li>
<li><a href="https://www.npmjs.com/package/pitway">npm</a></li>
</ul>
</nav>
</header>
<div class="docs-layout">
<nav class="docs-sidebar" aria-label="Documentation sections">
<p class="docs-sidebar-title"><a href="index.html">PitWay Docs</a></p>
<p class="docs-sidebar-section">Getting Started</p>
<ul>
<li><a href="../getting-started/index.html">Getting Started</a></li>
</ul>
<p class="docs-sidebar-section">Concepts</p>
<ul>
<li><a href="../concepts/milestones.html">Milestones</a></li>
<li><a href="../concepts/contracts.html">Contracts</a></li>
<li><a href="../concepts/tasks.html">Tasks</a></li>
<li><a href="../concepts/evidence.html">Evidence</a></li>
<li><a href="../concepts/backlog.html">Backlog</a></li>
<li><a href="../concepts/worktrees.html">Worktrees</a></li>
</ul>
<p class="docs-sidebar-section">Workflow</p>
<ul>
<li><a href="../workflow/review.html">Review</a></li>
<li><a href="../workflow/auto-run.html">Auto Run</a></li>
<li><a href="../workflow/verification.html">Verification</a></li>
<li><a href="../workflow/completion.html">Completion</a></li>
<li><a href="../workflow/merge.html">Merge</a></li>
</ul>
<p class="docs-sidebar-section">Agents</p>
<ul>
<li><a href="../agents/claude-code.html">Claude Code</a></li>
<li><a href="../agents/opencode.html">OpenCode</a></li>
<li><a href="../agents/codex.html">Codex</a></li>
<li><a href="../agents/resume.html">Resume</a></li>
</ul>
</nav>
<div class="docs-main">
<nav class="docs-breadcrumbs" aria-label="Breadcrumb">
<span aria-current="page">Docs</span>
</nav>
<main id="main-content" tabindex="-1">

# PitWay Documentation

PitWay's full documentation, grouped by section. Start with
[Getting Started](getting-started/index.html)
if this is your first time running PitWay.

## Getting Started

- [Getting Started](getting-started/index.html) -- Install the pitway CLI, run pitway init from your Git repo root, and take your verified first steps with PitWay.

## Concepts

- [Milestones](concepts/milestones.html) -- A milestone is one unit of planned work -- a contract plus a task graph -- moving through PitWay's draft-to-completed state machine.
- [Contracts](concepts/contracts.html) -- A milestone's contract is a Markdown file with machine-authoritative YAML frontmatter -- the execution boundary a milestone never silently expands beyond.
- [Tasks](concepts/tasks.html) -- Tasks are a milestone's concrete steps, each mechanically bounded by a write_scope and moved through its own state machine.
- [Evidence](concepts/evidence.html) -- Every task and milestone check is verified against an approved command and its result recorded as formal evidence, never estimated.
- [Backlog](concepts/backlog.html) -- backlog captures work discovered mid-task without expanding the current milestone's scope, for promotion into a real task later.
- [Worktrees](concepts/worktrees.html) -- Independent, dependency-free tasks with disjoint write_scope can dispatch concurrently into temporary Git worktrees under parallel_worktrees.

## Workflow

- [Review](workflow/review.html) -- milestone-review runs a role-based review workflow -- reviewers produce findings only; PitWay doesn't run reviews or verify reviewer independence.
- [Auto Run](workflow/auto-run.html) -- auto-run manages the authorization that lets task execution continue automatically without stopping for confirmation at every step.
- [Verification](workflow/verification.html) -- Two-tier verification: each task is checked against its own approved command, and a mandatory full test suite gates milestone completion.
- [Completion](workflow/completion.html) -- milestone-complete is the final mandatory approval gate -- it refuses until every task is done and every verification check is passing.
- [Merge](workflow/merge.html) -- milestone-merge lands a completed milestone's dedicated branch into its base branch, idempotently, with full git-safety checks.

## Agents

- [Claude Code](agents/claude-code.html) -- pitway init installs Claude Code slash commands and driver protocol documents by default -- the primary way Claude Code drives PitWay's workflow.
- [OpenCode](agents/opencode.html) -- pitway init --opencode installs the same PitWay command surface for OpenCode, in its own file convention, from the shared common layer.
- [Codex](agents/codex.html) -- pitway init --codex installs the same PitWay command surface for Codex, in its own file convention, from the shared common layer.
- [Resume](agents/resume.html) -- pitway resume reconstructs workflow state from .pitway/ and recommends the next action -- the authoritative way to pick a session back up.
</main>
</div>
</div>
<footer>
<p>Built with PitWay by thixpin. 🏎️</p>
<p><a href="https://github.com/thixpin/pitway">View on GitHub</a> · MIT License</p>
</footer>
