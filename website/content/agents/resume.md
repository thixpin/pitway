---
description: "pitway resume reconstructs workflow state from .pitway/ and recommends the next action -- the authoritative way to pick a session back up."
canonical: "https://pitway.thixpin.me/agents/resume.html"
ogType: "article"
ogTitle: "Resume · PitWay Docs"
ogDescription: "pitway resume reconstructs workflow state from .pitway/ and recommends the next action -- the authoritative way to pick a session back up."
ogUrl: "https://pitway.thixpin.me/agents/resume.html"
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
<li><a href="../agents/codex.html">Codex</a></li>
<li><a href="../agents/resume.html" aria-current="page">Resume</a></li>
</ul>
</nav>
<div class="docs-main">
<nav class="docs-breadcrumbs" aria-label="Breadcrumb">
<a href="../docs-index.html">Docs</a> <span aria-hidden="true">›</span> <span>Agents</span> <span aria-hidden="true">›</span> <span aria-current="page">Resume</span>
</nav>
<main id="main-content">

# Resume

```bash
pitway resume
```

`resume` is PitWay's orientation command: what's going on in this
repository, and what's next. It reconstructs workflow state entirely from
the committed contents of `.pitway/` -- never from AI conversation memory
-- which is what makes it safe to run from a brand-new session, a
different machine, or a different coding agent entirely and still land on
the same answer.

## Not a first-run command

On a freshly initialized repository with no milestone yet, `resume` has
nothing to reconstruct: it reports that there's no active milestone and
points at `milestone-add`. The real first-run flow is
[`npm install -g pitway` then `pitway init`](../getting-started/index.html)
-- `resume` becomes useful once there's actual workflow state to pick
back up.

## Recovery, including mid-flight quick-change

Beyond routine orientation, `resume` is the authoritative recovery view
if a quick-change is left mid-flight, or after any interrupted session --
since PitWay's state lives in committed files rather than a conversation,
there is no separate "resume this AI chat" step; resuming the workflow *is*
resuming the work.

<nav class="docs-prevnext" aria-label="Page navigation">
<a rel="prev" href="../agents/codex.html">← Codex</a>
<span class="docs-prevnext-empty"></span>
</nav>
</main>
</div>
</div>
