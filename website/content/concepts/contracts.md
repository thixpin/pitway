---
description: "A milestone's contract is a Markdown file with machine-authoritative YAML frontmatter -- the execution boundary a milestone never silently expands beyond."
canonical: "https://pitway.thixpin.me/concepts/contracts.html"
ogType: "article"
ogTitle: "Contracts · PitWay Docs"
ogDescription: "A milestone's contract is a Markdown file with machine-authoritative YAML frontmatter -- the execution boundary a milestone never silently expands beyond."
ogUrl: "https://pitway.thixpin.me/concepts/contracts.html"
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
<li><a href="../concepts/contracts.html" aria-current="page">Contracts</a></li>
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
<a href="../docs-index.html">Docs</a> <span aria-hidden="true">›</span> <span>Concepts</span> <span aria-hidden="true">›</span> <span aria-current="page">Contracts</span>
</nav>
<main id="main-content">

# Contracts

A contract is plain Markdown with YAML frontmatter -- PitWay validates it,
it doesn't generate its content:

```markdown
---
schema_version: 1
id: M999
title: Greeter module
status: draft
requirement: null
confirmed_at: null
verification_approved_hash: null
acceptance_criteria:
  - id: AC001
    text: greet() returns a friendly string.
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npm test
---

# Contract

## Objective

Add a small greeter module.

## Change Log

- Initial milestone contract.
```

The `id` you write is a placeholder -- `milestone-add` assigns the real
next sequential id (e.g. `M001`).

## Machine-authoritative vs. prose

The YAML frontmatter (acceptance criteria, verification checks, status,
`verification_approved_hash`) is machine-authoritative. The Markdown body
holds prose and an append-only **Change Log** -- every amendment is a new
entry, never an edit to a prior one.

## The execution boundary

A contract is never silently expanded. A discovered conflict during task
work stops work, proposes a contract change as a new Change Log entry, and
waits for developer approval -- `pitway milestone-confirm --amend`
re-approves an amended contract and its verification plan.

## Confirmation

`pitway milestone-confirm <id>` freezes the contract, hash-approves its
verification commands (see [Verification](../workflow/verification.html)),
and creates the milestone's baseline Git commit. It only ever runs after
explicit developer sign-off in conversation.

<nav class="docs-prevnext" aria-label="Page navigation">
<a rel="prev" href="../concepts/milestones.html">← Milestones</a>
<a rel="next" href="../concepts/tasks.html">Tasks →</a>
</nav>
</main>
</div>
</div>
