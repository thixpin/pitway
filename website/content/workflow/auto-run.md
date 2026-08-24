<meta name="description" content="auto-run manages the authorization that lets task execution continue automatically without stopping for confirmation at every step.">
<link rel="canonical" href="https://pitway.thixpin.me/workflow/auto-run.html">
<meta property="og:type" content="article">
<meta property="og:title" content="Auto Run · PitWay Docs">
<meta property="og:description" content="auto-run manages the authorization that lets task execution continue automatically without stopping for confirmation at every step.">
<meta property="og:url" content="https://pitway.thixpin.me/workflow/auto-run.html">
<meta property="og:site_name" content="PitWay Docs">
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
<li><a href="../workflow/auto-run.html" aria-current="page">Auto Run</a></li>
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
<a href="../docs-index.html">Docs</a> <span aria-hidden="true">›</span> <span>Workflow</span> <span aria-hidden="true">›</span> <span aria-current="page">Auto Run</span>
</nav>
<main id="main-content">

# Auto Run

`pitway auto-run` manages auto-run authorization for automatic task
continuation -- it's how a driver session is allowed to keep moving
through a task graph without pausing for a manual go-ahead at every single
task boundary.

## What it doesn't change

Auto-run authorization only affects routine task-to-task continuation. It
never bypasses PitWay's actual mandatory gates -- `milestone-confirm` and
`milestone-complete` always wait for an explicit developer approval in
conversation regardless of auto-run state, and `write_scope` /
verification-hash enforcement stay mechanically in force either way.

## Where it lives

Auto-run is a housekeeping-category command alongside `usage-add` and
`milestone-cancel` -- see [Verification](../workflow/verification.html) and
[Completion](../workflow/completion.html) for the checks that stay in force
no matter what auto-run is set to.

<nav class="docs-prevnext" aria-label="Page navigation">
<a rel="prev" href="../workflow/review.html">← Review</a>
<a rel="next" href="../workflow/verification.html">Verification →</a>
</nav>
</main>
</div>
</div>
