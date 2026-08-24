---
description: "Install the pitway CLI, run pitway init from your Git repo root, and take your verified first steps with PitWay."
canonical: "https://pitway.thixpin.me/getting-started/index.html"
ogType: "article"
ogTitle: "Getting Started · PitWay Docs"
ogDescription: "Install the pitway CLI, run pitway init from your Git repo root, and take your verified first steps with PitWay."
ogUrl: "https://pitway.thixpin.me/getting-started/index.html"
ogSiteName: "PitWay Docs"
---
<a class="skip-link" href="#main-content">Skip to content</a>
<div class="docs-layout">
<nav class="docs-sidebar" aria-label="Documentation sections">
<p class="docs-sidebar-title"><a href="../docs-index.html">PitWay Docs</a></p>
<p class="docs-sidebar-section">Getting Started</p>
<ul>
<li><a href="../getting-started/index.html" aria-current="page">Getting Started</a></li>
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
<li><a href="../agents/resume.html">Resume</a></li>
</ul>
</nav>
<div class="docs-main">
<nav class="docs-breadcrumbs" aria-label="Breadcrumb">
<a href="../docs-index.html">Docs</a> <span aria-hidden="true">›</span> <span aria-current="page">Getting Started</span>
</nav>
<main id="main-content" tabindex="-1">

# Getting Started

## Prerequisites

Node.js ≥ 20 and a Git repository (`git init` first if you don't have
one yet -- PitWay refuses to run outside a Git work tree).

## Install

```bash
npm install -g pitway
```

## Initialize

Run once from the root of a Git repository:

```bash
pitway init
```

`pitway init`:

- Creates `.pitway/` -- a `config.yaml` and `state.yaml`, both empty of
  milestones until you add one.
- Installs the Claude Code integration into `.claude/` by default (opt out
  with `--no-claude`).
- Add `--opencode` and/or `--codex` to also install the OpenCode
  (`.opencode/`) and Codex (`.codex/`) integrations -- commands, skills,
  and driver protocol documents, resolved from one shared common layer. See
  [Claude Code](../agents/claude-code.html), [OpenCode](../agents/opencode.html),
  and [Codex](../agents/codex.html) for details on each.
- Creates root `AGENTS.md`/`CLAUDE.md` instruction files inside an
  explicit `<!-- pitway:managed:start/end -->` block, so it's safe to run
  against a repo that already has its own.
- Is safe to re-run: byte-identical files are left alone, and a genuine
  conflict with something you've hand-edited refuses loudly rather than
  overwriting it.

## Explore the command surface

```bash
pitway --help
```

That's the full, authoritative CLI command surface and available flags.

## What's next

A freshly initialized repository has no active milestone yet -- there's
nothing for `pitway resume` to reconstruct until you've drafted and
confirmed one (`resume` reports "No active milestone" on a fresh repo).
The next step is drafting your first [milestone](../concepts/milestones.html)
contract and [task graph](../concepts/tasks.html).

<nav class="docs-prevnext" aria-label="Page navigation">
<span class="docs-prevnext-empty"></span>
<a rel="next" href="../concepts/milestones.html">Milestones →</a>
</nav>
</main>
</div>
</div>
