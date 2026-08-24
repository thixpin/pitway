---
description: "backlog captures work discovered mid-task without expanding the current milestone's scope, for promotion into a real task later."
canonical: "https://pitway.thixpin.me/concepts/backlog.html"
ogType: "article"
ogTitle: "Backlog · PitWay Docs"
ogDescription: "backlog captures work discovered mid-task without expanding the current milestone's scope, for promotion into a real task later."
ogUrl: "https://pitway.thixpin.me/concepts/backlog.html"
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
<li><a href="../concepts/backlog.html" aria-current="page">Backlog</a></li>
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
<a href="../docs-index.html">Docs</a> <span aria-hidden="true">›</span> <span>Concepts</span> <span aria-hidden="true">›</span> <span aria-current="page">Backlog</span>
</nav>
<main id="main-content" tabindex="-1">

# Backlog

Discovered something unrelated to what you're currently working on?
`backlog` captures it without expanding the current task or milestone's
scope.

```bash
pitway backlog add --title "Short label" --reason "Why this was deferred."

pitway backlog list                 # or --status pending|promoted|archived
pitway backlog show B001
```

`--milestone`/`--task` on `add` are source annotation only, defaulting to
the active milestone with no task -- backlog requires an active milestone;
there's no global backlog.

## Promoting or closing an entry

```bash
# Once the real task/milestone already exists -- promote never creates
# one itself, --task/--milestone here mean the target only:
pitway backlog promote B001 --task T004

# Or close it out without acting on it:
pitway backlog archive B001 --reason "No longer relevant."
```

## State

`.pitway/backlog.yaml` is the authoritative backlog state. It's committed
alongside whatever commit the active milestone's workflow next produces --
never a dedicated commit of its own, and never a reason a task's own
clean-tree check fails.

<nav class="docs-prevnext" aria-label="Page navigation">
<a rel="prev" href="../concepts/evidence.html">← Evidence</a>
<a rel="next" href="../concepts/worktrees.html">Worktrees →</a>
</nav>
</main>
</div>
</div>
