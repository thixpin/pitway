---
description: "milestone-complete is the final mandatory approval gate -- it refuses until every task is done and every verification check is passing."
canonical: "https://pitway.thixpin.me/workflow/completion.html"
ogType: "article"
ogTitle: "Completion · PitWay Docs"
ogDescription: "milestone-complete is the final mandatory approval gate -- it refuses until every task is done and every verification check is passing."
ogUrl: "https://pitway.thixpin.me/workflow/completion.html"
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
<li><a href="../workflow/completion.html" aria-current="page">Completion</a></li>
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
<a href="../docs-index.html">Docs</a> <span aria-hidden="true">›</span> <span>Workflow</span> <span aria-hidden="true">›</span> <span aria-current="page">Completion</span>
</nav>
<main id="main-content">

# Completion

```bash
pitway milestone-complete M001
```

`milestone-complete` requires every task done *and* every check passing --
it refuses until everything is actually green. This is the second of
PitWay's two mandatory human approval gates (the first is
[milestone-confirm](../concepts/contracts.html)), and it's what the workflow
lifecycle calls **Final Full Test**: if the full suite fails, work loops
back into a milestone revision rather than completing.

## What happens on completion

- Every required task must already be `completed`.
- Every approved `command`-type verification check (see
  [Verification](../workflow/verification.html)) must be passing.
- Progress is reported honestly: `completed required tasks / total
  required tasks`, never a per-task percentage.

## After completion

Completion doesn't merge the milestone's branch automatically -- that's a
deliberate, separate step. See [Merge](../workflow/merge.html) for `pitway
milestone-merge`.

<nav class="docs-prevnext" aria-label="Page navigation">
<a rel="prev" href="../workflow/verification.html">← Verification</a>
<a rel="next" href="../workflow/merge.html">Merge →</a>
</nav>
</main>
</div>
</div>
