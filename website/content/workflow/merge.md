<meta name="description" content="milestone-merge lands a completed milestone's dedicated branch into its base branch, idempotently, with full git-safety checks.">
<link rel="canonical" href="https://pitway.thixpin.me/workflow/merge.html">
<meta property="og:type" content="article">
<meta property="og:title" content="Merge · PitWay Docs">
<meta property="og:description" content="milestone-merge lands a completed milestone's dedicated branch into its base branch, idempotently, with full git-safety checks.">
<meta property="og:url" content="https://pitway.thixpin.me/workflow/merge.html">
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
<li><a href="../workflow/auto-run.html">Auto Run</a></li>
<li><a href="../workflow/verification.html">Verification</a></li>
<li><a href="../workflow/completion.html">Completion</a></li>
<li><a href="../workflow/merge.html" aria-current="page">Merge</a></li>
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
<a href="../docs-index.html">Docs</a> <span aria-hidden="true">›</span> <span>Workflow</span> <span aria-hidden="true">›</span> <span aria-current="page">Merge</span>
</nav>
<main id="main-content">

# Merge

Under `git.branch_strategy: milestone` (the generated default), each
milestone works on its own dedicated branch for its full lifecycle. Once a
milestone is `completed`:

```bash
pitway milestone-merge M001                   # merges into base_branch
pitway milestone-merge M001 --target release  # or an explicit target
```

`--target` defaults to the milestone's own `base_branch`. Re-running
`milestone-merge` is a safe, idempotent no-op once the merge has already
landed.

## Not automatic

`milestone-complete` does not run this for you -- merging is invoked
explicitly, when you're actually ready to integrate the branch. This keeps
"the milestone's work is verified and done" and "the milestone's branch is
now part of your mainline" as two separate, deliberate decisions.

## The other branch strategy

Setting `git.branch_strategy: main` instead commits milestones directly
to the current branch, skipping the dedicated-branch-and-merge step
entirely -- there's nothing for `milestone-merge` to do under that
strategy.

<nav class="docs-prevnext" aria-label="Page navigation">
<a rel="prev" href="../workflow/completion.html">← Completion</a>
<a rel="next" href="../agents/claude-code.html">Claude Code →</a>
</nav>
</main>
</div>
</div>
