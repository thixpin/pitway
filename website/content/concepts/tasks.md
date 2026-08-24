---
description: "Tasks are a milestone's concrete steps, each mechanically bounded by a write_scope and moved through its own state machine."
canonical: "https://pitway.thixpin.me/concepts/tasks.html"
ogType: "article"
ogTitle: "Tasks · PitWay Docs"
ogDescription: "Tasks are a milestone's concrete steps, each mechanically bounded by a write_scope and moved through its own state machine."
ogUrl: "https://pitway.thixpin.me/concepts/tasks.html"
ogSiteName: "PitWay Docs"
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
<li><a href="../concepts/tasks.html" aria-current="page">Tasks</a></li>
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
<a href="../docs/index.html">Docs</a> <span aria-hidden="true">›</span> <span>Concepts</span> <span aria-hidden="true">›</span> <span aria-current="page">Tasks</span>
</nav>
<main id="main-content" tabindex="-1">

# Tasks

A task graph is plain YAML -- the concrete steps a confirmed contract
breaks down into:

```yaml
schema_version: 1
tasks:
  - id: T001
    name: Implement greeter
    objective: Implement the greet() function.
    status: planned
    depends_on: []
    acceptance_criteria:
      - greet() returns a friendly string
    context_files:
      - greeter.js
    write_scope:
      - greeter.js
    verification:
      strategy: command
      detail: npm test
    result: null
    usage: null
```

## write_scope is mechanically enforced

`write_scope` is a list of exact file paths -- no directory prefixes, no
globs. A task's completion commit refuses if it touches anything outside
its declared paths. This is what keeps an agent from quietly drifting
outside its intended boundary.

## States

`planned → waiting → ready → in_progress → review → completed`, plus
`in_progress → blocked → ready`, `in_progress → failed → ready`,
`review → in_progress` on evidence-blocked recovery, and
`planned|waiting|ready → cancelled`.

## Working a task

```bash
pitway task-update T001 in_progress
# ... write greeter.js ...
pitway task-verify T001          # runs the approved command, records evidence
pitway task-update T001 review
pitway task-update T001 completed --result result.yaml --message message.txt
```

`result.yaml` is `{summary: ..., evidence: ...}`; `message.txt` is the
commit message body PitWay appends `PitWay-Milestone`/`PitWay-Task`
trailers to. Completion is one atomic commit containing the code changes
and the matching `.pitway/` state update -- the working tree must be clean
except for the task's own declared `write_scope` at every transition.

## Mid-flight correction

Once a milestone is confirmed or in progress, its task graph isn't frozen:
`pitway task-add` inserts a new task discovered mid-flight, and `pitway
task-amend` amends an existing task's objective, scope, or verification --
both require a change-log reason. See [Evidence](../concepts/evidence.html)
for how a task's verification is checked and recorded, and
[Worktrees](../concepts/worktrees.html) for how independent tasks can run
concurrently.

<nav class="docs-prevnext" aria-label="Page navigation">
<a rel="prev" href="../concepts/contracts.html">← Contracts</a>
<a rel="next" href="../concepts/evidence.html">Evidence →</a>
</nav>
</main>
</div>
</div>
<footer>
<p>Built with PitWay by thixpin. 🏎️</p>
<p><a href="https://github.com/thixpin/pitway">View on GitHub</a> · MIT License</p>
</footer>
