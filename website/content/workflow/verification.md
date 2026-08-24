<meta name="description" content="Two-tier verification: each task is checked against its own approved command, and a mandatory full test suite gates milestone completion.">
<link rel="canonical" href="https://pitway.thixpin.me/workflow/verification.html">
<meta property="og:type" content="article">
<meta property="og:title" content="Verification · PitWay Docs">
<meta property="og:description" content="Two-tier verification: each task is checked against its own approved command, and a mandatory full test suite gates milestone completion.">
<meta property="og:url" content="https://pitway.thixpin.me/workflow/verification.html">
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
<li><a href="../workflow/verification.html" aria-current="page">Verification</a></li>
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
<a href="../docs-index.html">Docs</a> <span aria-hidden="true">›</span> <span>Workflow</span> <span aria-hidden="true">›</span> <span aria-current="page">Verification</span>
</nav>
<main id="main-content">

# Verification

PitWay runs verification in two tiers.

## Task-level

```bash
pitway task-verify T001
```

Runs the task's own approved command and records formal evidence -- see
[Evidence](../concepts/evidence.html) for the three check types (`command`,
`manual`, `review`) and how approval works.

## Milestone-level

```bash
pitway verify M001
```

Runs every approved `command`-type check for the whole milestone. This is
the mandatory full-suite gate:
[Completion](../workflow/completion.html) (`milestone-complete`) refuses to
close a milestone until every task is done *and* every check is passing.

## verification_approved_hash

Verification commands are hash-approved once, at `milestone-confirm`
time. If the approved commands drift from what's actually in the contract,
`verify` refuses on a hash mismatch rather than silently running
something that was never approved -- re-confirming the milestone
(`milestone-confirm --amend`) re-approves the plan.

## Repairing a stuck verification

If verification evidence itself needs correcting after the fact,
`verification-repair` provides a bounded, approve-before-edit correction
path -- it's not a way to bypass the checks, only to fix how their
evidence was recorded.

<nav class="docs-prevnext" aria-label="Page navigation">
<a rel="prev" href="../workflow/auto-run.html">← Auto Run</a>
<a rel="next" href="../workflow/completion.html">Completion →</a>
</nav>
</main>
</div>
</div>
