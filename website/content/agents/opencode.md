---
description: "pitway init --opencode installs the same PitWay command surface for OpenCode, in its own file convention, from the shared common layer."
canonical: "https://pitway.thixpin.me/agents/opencode.html"
ogType: "article"
ogTitle: "OpenCode · PitWay Docs"
ogDescription: "pitway init --opencode installs the same PitWay command surface for OpenCode, in its own file convention, from the shared common layer."
ogUrl: "https://pitway.thixpin.me/agents/opencode.html"
ogSiteName: "PitWay Docs"
---
<a class="skip-link" href="#main-content">Skip to content</a>
<div class="docs-layout">
<nav class="docs-sidebar" aria-label="Documentation sections">
<p class="docs-sidebar-title"><a href="../docs-index.html">PitWay Docs</a></p>
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
<li><a href="../agents/opencode.html" aria-current="page">OpenCode</a></li>
<li><a href="../agents/codex.html">Codex</a></li>
<li><a href="../agents/resume.html">Resume</a></li>
</ul>
</nav>
<div class="docs-main">
<nav class="docs-breadcrumbs" aria-label="Breadcrumb">
<a href="../docs-index.html">Docs</a> <span aria-hidden="true">›</span> <span>Agents</span> <span aria-hidden="true">›</span> <span aria-current="page">OpenCode</span>
</nav>
<main id="main-content" tabindex="-1">

# OpenCode

OpenCode is an opt-in driver integration: `pitway init --opencode`.

## What gets installed

The same command surface as every other driver, in OpenCode's own
convention -- `.opencode/commands/*.md` -- plus the shared skills and
protocol documents. Skills and protocol content come from PitWay's common
layer, defined once and never forked per driver, so OpenCode's behavior
around PitWay's workflow gates matches Claude Code's and Codex's exactly.

## Same gates, same boundaries

Whichever driver is running, `milestone-confirm` and `milestone-complete`
always wait for an explicit developer yes, `write_scope` is mechanically
enforced the same way, and the driver never touches `.pitway/` directly --
every state change goes through the `pitway` CLI. OpenCode doesn't get a
looser or stricter version of the workflow; it gets the same one,
addressed for its own tooling conventions.

<nav class="docs-prevnext" aria-label="Page navigation">
<a rel="prev" href="../agents/claude-code.html">← Claude Code</a>
<a rel="next" href="../agents/codex.html">Codex →</a>
</nav>
</main>
</div>
</div>
