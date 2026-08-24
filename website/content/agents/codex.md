---
description: "pitway init --codex installs the same PitWay command surface for Codex, in its own file convention, from the shared common layer."
canonical: "https://pitway.thixpin.me/agents/codex.html"
ogType: "article"
ogTitle: "Codex · PitWay Docs"
ogDescription: "pitway init --codex installs the same PitWay command surface for Codex, in its own file convention, from the shared common layer."
ogUrl: "https://pitway.thixpin.me/agents/codex.html"
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
<li><a href="../agents/opencode.html">OpenCode</a></li>
<li><a href="../agents/codex.html" aria-current="page">Codex</a></li>
<li><a href="../agents/resume.html">Resume</a></li>
</ul>
</nav>
<div class="docs-main">
<nav class="docs-breadcrumbs" aria-label="Breadcrumb">
<a href="../docs-index.html">Docs</a> <span aria-hidden="true">›</span> <span>Agents</span> <span aria-hidden="true">›</span> <span aria-current="page">Codex</span>
</nav>
<main id="main-content" tabindex="-1">

# Codex

Codex is an opt-in driver integration: `pitway init --codex`.

## What gets installed

The same command surface as every other driver, in Codex's own convention
-- `.codex/commands/*.md` -- plus the shared skills and protocol
documents, resolved from PitWay's common layer rather than authored
separately for Codex.

## Same gates, same boundaries

As with [Claude Code](../agents/claude-code.html) and
[OpenCode](../agents/opencode.html), Codex answers to the same CLI and the
same human approval gates: `milestone-confirm`/`milestone-complete`
always wait for an explicit developer yes, whatever tool is driving. Core
never imports AI-provider code -- Codex-specific material is text assets
only, installed by `pitway init --codex`, never a runtime plugin or a Core
code change.

<nav class="docs-prevnext" aria-label="Page navigation">
<a rel="prev" href="../agents/opencode.html">← OpenCode</a>
<a rel="next" href="../agents/resume.html">Resume →</a>
</nav>
</main>
</div>
</div>
