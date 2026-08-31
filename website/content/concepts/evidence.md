---
title: "Evidence · PitWay Docs"
description: "Every task and milestone check is verified against an approved command and its result recorded as formal evidence, never estimated."
canonical: "https://pitway.thixpin.me/concepts/evidence.html"
ogType: "article"
ogTitle: "Evidence · PitWay Docs"
ogDescription: "Every task and milestone check is verified against an approved command and its result recorded as formal evidence, never estimated."
ogUrl: "https://pitway.thixpin.me/concepts/evidence.html"
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
<li><a href="../concepts/milestones.html">Milestones</a></li>
<li><a href="../concepts/contracts.html">Contracts</a></li>
<li><a href="../concepts/tasks.html">Tasks</a></li>
<li><a href="../concepts/evidence.html" aria-current="page">Evidence</a></li>
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
<a href="../docs/index.html">Docs</a> <span aria-hidden="true">›</span> <span>Concepts</span> <span aria-hidden="true">›</span> <span aria-current="page">Evidence</span>
</nav>
<main id="main-content" tabindex="-1">

# Evidence

PitWay checks work against declared verification, not vibes.

## Three check types

Every acceptance criterion in a contract maps to one verification check of
one of three types, defined in the contract's frontmatter:

- `command` -- an actual shell command PitWay runs and records the result
  of.
- `manual` -- a human-performed check, recorded by the developer.
- `review` -- a review finding, recorded through
  [milestone review](../workflow/review.html).

## Approval before execution

Command-type checks are hash-approved at `milestone-confirm` time via
`verification_approved_hash`. PitWay never executes an unapproved,
agent-authored command -- if the approved commands change, `verify`
refuses on a hash mismatch until the contract is re-confirmed.

## Recording evidence

```bash
pitway task-verify T001    # runs T001's own approved command
pitway verify M001         # runs every approved command-type check
```

Verification *results* live in their own `verification-results.yaml`,
kept separate from the contract itself -- one authoritative source per
fact, with no derived Git data (like commit SHAs) persisted; those are
resolved from commit trailers instead.

## Token usage: the same honesty

Usage is recorded only from what the runtime actually reports, never
estimated -- `usage: null` renders as `N/A` rather than a guessed number.
Usage accumulates across retries, and planning/QA usage is tracked
separately from task usage, so nothing is double-counted. Milestone
progress follows the same rule: no per-task percentages, only `completed
required tasks / total required tasks`.

<nav class="docs-prevnext" aria-label="Page navigation">
<a rel="prev" href="../concepts/tasks.html">← Tasks</a>
<a rel="next" href="../concepts/backlog.html">Backlog →</a>
</nav>
</main>
</div>
</div>
<footer>
<p>Built with PitWay by thixpin. 🏎️</p>
<p><a href="https://github.com/thixpin/pitway">View on GitHub</a> · MIT License</p>
</footer>
