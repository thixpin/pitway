---
description: "milestone-review runs a role-based review workflow -- reviewers produce findings only; PitWay doesn't run reviews or verify reviewer independence."
canonical: "https://pitway.thixpin.me/workflow/review.html"
ogType: "article"
ogTitle: "Review · PitWay Docs"
ogDescription: "milestone-review runs a role-based review workflow -- reviewers produce findings only; PitWay doesn't run reviews or verify reviewer independence."
ogUrl: "https://pitway.thixpin.me/workflow/review.html"
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
<li><a href="../workflow/review.html" aria-current="page">Review</a></li>
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
<a href="../docs-index.html">Docs</a> <span aria-hidden="true">›</span> <span>Workflow</span> <span aria-hidden="true">›</span> <span aria-current="page">Review</span>
</nav>
<main id="main-content" tabindex="-1">

# Review

![PitWay workflow: BRS/Backlog into Milestone (Contract ⇄ Milestone Review) through the Human Approval gate to the Task Graph, TDD → Task Verification → Task Commit repeating with a Backlog exit, then Final Full Test (failure loops through milestone revision), Milestone Complete, and an opt-in Quick Change lane for small bounded fixes against a completed milestone, ending at Milestone Merge](../assets/workflow.svg)

The diagram above is PitWay's full canonical workflow, from requirement
through milestone merge -- this Workflow section covers the stages after
a contract is confirmed: Review, [Auto Run](../workflow/auto-run.html),
[Verification](../workflow/verification.html),
[Completion](../workflow/completion.html), and
[Merge](../workflow/merge.html).

`pitway milestone-review` drives a role-based milestone review workflow
with four stages: start, brief, record, report, decide.

## What PitWay does and doesn't do here

PitWay's Engineering Boundaries are explicit about this one: reviewers
produce **findings only**. PitWay does not run reviews itself, and it does
not verify reviewer independence -- the review process is structured and
recorded, but the judgment is a human's (or a driver acting on a human's
behalf).

## Where review fits

Review happens alongside a milestone's contract, before and during
confirmation (`Contract ⇄ Milestone Review` in the workflow lifecycle),
and can recur if a milestone's verification later fails and needs revision
(`review → in_progress`). It's distinct from
[Verification](../workflow/verification.html), which checks concrete
acceptance criteria against approved commands -- review is where a human
(or driver) judges quality, scope, and risk more broadly, and its findings
are recorded as evidence, not silently absorbed into the milestone's
history.

<nav class="docs-prevnext" aria-label="Page navigation">
<a rel="prev" href="../concepts/worktrees.html">← Worktrees</a>
<a rel="next" href="../workflow/auto-run.html">Auto Run →</a>
</nav>
</main>
</div>
</div>
