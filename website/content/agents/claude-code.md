<meta name="description" content="pitway init installs Claude Code slash commands and driver protocol documents by default -- the primary way Claude Code drives PitWay's workflow.">
<link rel="canonical" href="https://pitway.thixpin.me/agents/claude-code.html">
<meta property="og:type" content="article">
<meta property="og:title" content="Claude Code · PitWay Docs">
<meta property="og:description" content="pitway init installs Claude Code slash commands and driver protocol documents by default -- the primary way Claude Code drives PitWay's workflow.">
<meta property="og:url" content="https://pitway.thixpin.me/agents/claude-code.html">
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
<li><a href="../workflow/merge.html">Merge</a></li>
</ul>
<p class="docs-sidebar-section">Agents</p>
<ul>
<li><a href="../agents/claude-code.html" aria-current="page">Claude Code</a></li>
<li><a href="../agents/opencode.html">OpenCode</a></li>
<li><a href="../agents/codex.html">Codex</a></li>
<li><a href="../agents/resume.html">Resume</a></li>
</ul>
</nav>
<div class="docs-main">
<nav class="docs-breadcrumbs" aria-label="Breadcrumb">
<a href="../docs-index.html">Docs</a> <span aria-hidden="true">›</span> <span>Agents</span> <span aria-hidden="true">›</span> <span aria-current="page">Claude Code</span>
</nav>
<main id="main-content">

# Claude Code

Claude Code is PitWay's default driver integration -- installed
automatically by `pitway init` (opt out with `--no-claude`).

## What gets installed

`pitway init` installs PitWay's commands as real Claude Code slash
commands under `.claude/commands/*.md`, each carrying
`description`/`argument-hint` frontmatter so they show up properly in
Claude Code's `/` picker (e.g. `/task-add`, `/milestone-status`).
Alongside them, `.claude/protocol-driver.md` and its companion documents
are what actually teach the driver session how and when to call each
command -- the slash-command files themselves are thin pointers into that
protocol, not a second copy of it.

## The driver never touches state directly

Whichever command Claude Code runs, every state read and mutation goes
through the `pitway` CLI -- the driver never edits `.pitway/` directly,
and PitWay's Core validates every transition. This is the same rule every
other driver integration follows, and it's what keeps Core
provider-agnostic.

## Shared content, not a fork

Skills and protocol documents come from PitWay's common layer, defined
once and resolved per driver -- Claude Code's copy isn't a separately
maintained fork of what [OpenCode](../agents/opencode.html) or
[Codex](../agents/codex.html) install.

<nav class="docs-prevnext" aria-label="Page navigation">
<a rel="prev" href="../workflow/merge.html">← Merge</a>
<a rel="next" href="../agents/opencode.html">OpenCode →</a>
</nav>
</main>
</div>
</div>
