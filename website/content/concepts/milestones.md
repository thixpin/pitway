---
title: "Milestones · PitWay Docs"
description: "A milestone is one unit of planned work -- a contract plus a task graph -- moving through PitWay's draft-to-completed state machine."
canonical: "https://pitway.thixpin.me/concepts/milestones.html"
ogType: "article"
ogTitle: "Milestones · PitWay Docs"
ogDescription: "A milestone is one unit of planned work -- a contract plus a task graph -- moving through PitWay's draft-to-completed state machine."
ogUrl: "https://pitway.thixpin.me/concepts/milestones.html"
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
<p class="docs-sidebar-title"><a href="../docs/index.html">PitWay Docs</a></p>
<p class="docs-sidebar-section">Getting Started</p>
<ul>
<li><a href="../getting-started/index.html">Getting Started</a></li>
</ul>
<p class="docs-sidebar-section">Concepts</p>
<ul>
<li><a href="../concepts/milestones.html" aria-current="page">Milestones</a></li>
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
<a href="../docs/index.html">Docs</a> <span aria-hidden="true">›</span> <span>Concepts</span> <span aria-hidden="true">›</span> <span aria-current="page">Milestones</span>
</nav>
<main id="main-content" tabindex="-1">

# Milestones

A milestone is one unit of planned work with a **contract** (objective,
acceptance criteria, verification checks) and a **task graph** (the
concrete steps). Nothing gets implemented until a human confirms the
contract -- that confirmation is the one mandatory approval gate in the
whole lifecycle.

## Lifecycle

`Requirement` → `Milestone` (`Contract` ⇄ `Milestone Review`) →
`Human Approval` → `Task Graph` → [`TDD` ⇄ `Task Verification` →
`Task Commit`]* → `Final Full Test` → `Milestone Complete` →
`Milestone Merge`.

## States

- `draft` -- drafted, contract and task graph not yet confirmed.
- `confirmed` -- the contract is frozen, verification commands
  hash-approved, baseline commit created. Ready (dependency-free) tasks
  promote automatically.
- `in_progress` -- tasks are being worked.
- `review` -- milestone verification is running or has been run.
- `completed` -- every task done and every check passing.

`review → in_progress` on failed verification; `draft|confirmed →
cancelled` for a milestone abandoned before real work starts.

## Working with milestones

```bash
pitway milestone-add --contract contract.md --tasks tasks.yaml   # draft
pitway milestone-confirm M001                                    # confirm
pitway milestone-status M001                                     # status
pitway milestone-complete M001                                   # complete
pitway milestone-merge M001                                      # merge
```

See [Contracts](../concepts/contracts.html) and [Tasks](../concepts/tasks.html)
for the two things every milestone is built from, and
[Completion](../workflow/completion.html) /
[Merge](../workflow/merge.html) for how one finishes.

<nav class="docs-prevnext" aria-label="Page navigation">
<a rel="prev" href="../getting-started/index.html">← Getting Started</a>
<a rel="next" href="../concepts/contracts.html">Contracts →</a>
</nav>
</main>
</div>
</div>
<footer>
<p>Built with PitWay by thixpin. 🏎️</p>
<p><a href="https://github.com/thixpin/pitway">View on GitHub</a> · MIT License</p>
</footer>
