---
schema_version: 1
id: M032
title: PitWay Official Website
status: in_progress
requirement: null
confirmed_at: 2026-08-24T08:47:32Z
verification_approved_hash: sha256:bb67aa93208bc9bb065c123baf2a15e02e2de5bdc223e6da12ddac48c876829e
base_branch: main
base_revision: 1398581a77e7e4ffe7ab277fa58cf6d4f7af5c6a
acceptance_criteria:
  - id: AC001
    text: "Website scaffold & build pipeline (T001): website/ is an independent npm
      project isolated under website/ with its own package.json (pre-declaring
      build, check:seo, and check:a11y npm scripts up front, written exactly
      once and never touched by another task) and .gitignore -- not an npm
      workspace member (root package.json has no workspaces field and stays
      untouched by this task). A build script converts Markdown to HTML at build
      time (never in the browser) and renders docs/assets/workflow.mmd -- the
      one existing canonical Mermaid source, read directly from its existing
      location, never copied or duplicated into website/ -- to SVG at build time
      via a Mermaid CLI/renderer (never a browser-side Mermaid library, never a
      CDN), transparent background, colors readable both on #111629 and on
      #FFFFFF. `npm run build` unconditionally generates sitemap.xml and
      robots.txt from whatever pages exist -- this is a core part of the
      production build path from T001 onward, not a separate, manually-invoked
      step (this is the fix for the T004->T006 SEO artifact wiring gap the
      architect review found). All generated output is a build-time artifact
      only -- website/.gitignore excludes the build output directory, and no
      committed file under website/ is machine-generated. The website builds and
      installs independently of the root project; root `npm test`/`npm run
      build`/`tsc --noEmit` remain unaffected."
  - id: AC002
    text: "Homepage & core messaging (T002): the homepage (Hero, Problem, How PitWay
      Works -- a lightweight textual/visual step summary reusing the canonical
      diagram's own stage names, not the full dense diagram -- Contract-Based
      Scope Control, Task Execution, Human + Agent, 'Resume Across Coding
      Agents', 'Durable Traceability', Brand Footer 'Built with PitWay by
      thixpin. 🏎️') is present as a self-contained template with its own real
      title/meta description/ canonical URL/Open Graph tags, single h1, no
      skipped heading levels, and every CTA/nav link as a real
      keyboard-focusable element -- this task owns its own semantic HTML and
      implementation-level accessibility, not a later retrofit. 'Multi-Agent' is
      never used in a way implying simultaneous/ orchestrated multi-agent
      operation -- PitWay is not positioned as a multi-agent framework; 'Resume
      Across Coding Agents' describes resuming the same workflow state across a
      different supported coding agent, matching the real `pitway resume`
      capability. 'Durable Traceability' describes git-trailer-based commit
      traceability and `.pitway/` state persistence, never implying PitWay
      auto-generates arbitrary project documentation. Every factual/behavioral
      claim traces to verified repository content -- the real milestone/task
      state machine values from CLAUDE.md, the real CLI command surface from
      `pitway --help`, and README.md/ USAGE.md content -- never invented
      terminology or unsupported claims about AI context/token retention beyond
      what PitWay actually persists and resumes. Builds to valid HTML via T001's
      pipeline."
  - id: AC003
    text: "Documentation section (T003): Getting Started documents the real,
      verified first-run flow -- `npm install -g pitway` then `pitway init` --
      and does not document `pitway resume` as a standalone first-run command
      (confirmed via a live `pitway init` + `pitway resume` run: a fresh repo
      has no active milestone, so `resume` is not yet a meaningful first
      command). Concepts (6 pages: Milestones, Contracts, Tasks, Evidence,
      Backlog, Worktrees), Workflow (5 pages: Review, Auto Run, Verification,
      Completion, Merge -- featuring the full canonical workflow.mmd SVG where
      audience context is established), and Agents (4 pages: Claude Code,
      OpenCode, Codex, Resume -- matching the actual set of supported driver
      integrations) pages exist as a self-contained template with its own real
      title/meta description/canonical URL/ Open Graph tags per page and valid
      heading hierarchy, reusing README.md/USAGE.md content rather than
      re-authoring a second source of truth. A persistent, static section
      navigation (all 4 sections/16 pages visible without leaving the current
      page -- e.g. an always-visible sidebar tree) exists in addition to
      breadcrumbs and previous/next navigation, so moving between non-adjacent
      pages never requires returning to a single index page first; still no
      full-text search. All navigation is real, keyboard-focusable elements --
      this task owns its own implementation-level accessibility, not a later
      retrofit. No page exists for a feature the repository doesn't actually
      support."
  - id: AC004
    text: "SEO & accessibility audit tooling (T004): check-seo.mjs validates --
      never generates -- that every built page has a title, meta description,
      canonical URL, Open Graph metadata, and valid heading hierarchy, and that
      sitemap.xml/robots.txt (generated unconditionally by T001's build, per
      AC001) exist and are well-formed. check-a11y.mjs validates automatable
      accessibility signals (e.g. image alt text, presence of T005's
      focus-visible/ reduced-motion CSS) from the built output. Both scripts are
      pure audits over already-built HTML -- neither this task nor either script
      generates content or ever opens or edits a template, style, or content
      file owned by T001, T002, T003, or T005. A documented manual-check list
      exists for keyboard navigation, reduced-motion behavior, and video
      captions (if any video ships) -- the things automated tooling in this task
      cannot itself verify. No UI framework, animation library, third-party
      script, backend, API, or analytics/tracking infrastructure is introduced
      anywhere in this milestone."
  - id: AC005
    text: "Visual design & responsive styling (T005): the site uses a dark-first
      design -- deep navy (~#111629) background, cyan/electric accent
      (~#64B8F7), off-white primary text, muted blue-gray secondary text --
      distinct from thixpin.me rather than a copy of it, with a
      developer-tool/terminal aesthetic, strong typography, and generous
      spacing. This task runs only after T002 and T003 exist, so its selectors
      target the real DOM/class structure those tasks actually produced
      (including T003's persistent section navigation), never a placeholder
      guess -- this is the fix for the review-identified risk of T005 styling
      only fixture markup under this repository's live `parallel_worktrees`
      execution. Layout is responsive with no horizontal overflow at defined
      breakpoints (mobile/tablet/desktop). Every focusable element has a visible
      focus style, and a prefers-reduced-motion media query exists wherever
      motion/animation exists -- this task owns the styling-layer implementation
      of those accessibility requirements, not a later retrofit. Existing PitWay
      icon/brand assets are reused where any exist (the repository has none
      beyond docs/assets/workflow.svg, confirmed by inspection); no second,
      unrelated icon system is introduced without cause."
  - id: AC006
    text: "Hosting pipeline, deploy-ready not deployed (T006): a GitHub Actions
      workflow runs website/'s full production path -- build, then
      check:seo/check:a11y as a pre-deploy quality gate -- and is written to
      deploy that exact static output (which always contains
      sitemap.xml/robots.txt, since T001's build produces them unconditionally)
      to S3 fronted by CloudFront via AWS OIDC (no long-lived AWS credential
      committed or required in this repository), matching this repository's
      existing workflow conventions (actions/checkout, actions/setup-node with
      an explicit Node version, minimal least-privilege `permissions:`,
      explanatory header comments) as established in test.yml/publish.yml. No
      backend, database, authentication, or CMS is introduced. This task
      delivers a deploy-ready, workflow-validated pipeline -- it does NOT
      perform, claim, or verify a real production deployment: no AWS OIDC trust
      relationship, S3 bucket, CloudFront distribution, or DNS for the target
      domain (pitway.thixpin.me) exists yet anywhere for this repository. The
      workflow's build-validate-audit steps run and are verifiable in CI
      regardless; each external, one-time prerequisite the developer must
      complete before the deploy step can run for real is documented plainly in
      the workflow's own comments."
  - id: AC007
    text: "Governance: any amendment must be proposed by the agent and stop for
      explicit developer approval before the contract is mutated or execution
      continues. Every task's write_scope is a list of exact file paths -- no
      directory prefixes, no globs -- verified against PitWay's actual
      write_scope enforcement (src/core/tasks/update.ts's assertDirtySubset does
      exact Set membership between declared write_scope entries and individual
      git-reported dirty file paths; confirmed a directory-style entry can never
      match). Every task's write_scope is disjoint from every other task's --
      verified path-by-path across all six tasks, no shared path, no hidden
      overlap (website/package.json is written exactly once, by T001; T004's
      audit scripts read already-built output and never declare write_scope on
      any file owned by another task). The dependency graph reflects both
      filesystem and semantic dependencies -- in particular T005 (styling)
      depends on T002 and T003 (the tasks that define the real DOM/class
      contract it styles), not merely on T001, even though their write_scopes
      never overlap."
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: cd website && npm ci && npm run build && cd .. && npm run build && npm
      test && npx tsc --noEmit
    timeout_ms: 900000
  - id: CT002
    criterion: AC002
    type: review
    instruction: Review the built homepage HTML against README.md, USAGE.md, and
      CLAUDE.md's Architecture Constraints/state-machine section -- confirm
      every claim and every piece of terminology traces to verified repository
      content (in particular that 'Resume Across Coding Agents' and 'Durable
      Traceability' read accurately and 'Multi-Agent' never implies orchestrated
      multi-agent operation), and confirm semantic HTML/keyboard-accessible
      structure.
  - id: CT003
    criterion: AC003
    type: review
    instruction: Review the built documentation pages against USAGE.md and a live
      `pitway init` + `pitway resume` run on a fresh repo -- confirm the
      documented first-run flow is exactly what the CLI actually does, confirm
      Concepts/Workflow/Agents content matches real repository behavior, and
      confirm the persistent section navigation, breadcrumbs, and prev/next are
      present, keyboard-accessible, and internal links resolve.
  - id: CT004
    criterion: AC004
    type: command
    command: cd website && npm run build && npm run check:seo && npm run check:a11y
    timeout_ms: 900000
  - id: CT005
    criterion: AC004
    type: manual
    instruction: Manually verify keyboard navigation reaches every interactive
      element with a visible focus state, that motion/ animation respects
      prefers-reduced-motion, and that any shipped video has captions.
  - id: CT006
    criterion: AC005
    type: manual
    instruction: Manually review the built site at mobile, tablet, and desktop
      breakpoints for the specified dark-first visual identity, responsive
      layout (including the docs section navigation) with no horizontal
      overflow, visible focus states, reduced-motion behavior, and Mermaid SVG
      readability in context.
  - id: CT007
    criterion: AC006
    type: command
    command: cd website && npm run build && npm run check:seo && npm run check:a11y
    timeout_ms: 900000
  - id: CT008
    criterion: AC007
    type: manual
    instruction: Confirm every amendment applied to this contract carries recorded
      explicit developer approval made before the amending command ran;
      re-confirm every write_scope entry across all six tasks is an exact file
      path (no directories/globs) and that write_scope stays disjoint with no
      hidden overlap.
---

# Contract

## Objective

Build the official PitWay website -- a production-ready static marketing
and documentation site under `website/` -- that explains what PitWay is,
why it exists, and how to get started, using PitWay's own real behavior
and terminology as the sole source of truth. The website also serves as a
real-world example of PitWay's own development workflow.

## Background

Per `.pitway/requirements/R004.md` ("PitWay Official Website" -- its
internal `# M031` heading is a stale id reference from before this
milestone's numbering was finalized; the requirement doc itself is not
duplicated or re-minted for this milestone, see below).

**Requirement linking, deliberately not duplicated**: `milestone-add`'s
`--requirement <path>` flag always mints a *new* numbered requirement
document from whatever file it's given -- it has no way to link to an
already-existing one. Per explicit developer direction, this milestone
leaves `requirement: null` and references `.pitway/requirements/R004.md`
by path in this Background section instead, exactly as M018 references
R002.md by prose without machine linkage. (Confirmed again, explicitly,
after the developer asked whether the machine field could point at R004:
there is no third option in the CLI beyond mint-a-duplicate or leave-null.)

**Investigation performed before the first draft** (per the requirement's
own "Planning Constraint" section): `website/` is completely empty; the
repository has exactly one existing canonical Mermaid source
(`docs/assets/workflow.mmd`, already rendered once to `workflow.svg` for
the README); no brand/icon assets exist beyond that diagram; no markdown/
Mermaid/static-site tooling is installed anywhere in the repo today; no
AWS/S3/CloudFront/OIDC setup and no DNS for `pitway.thixpin.me` exists
anywhere for this repository; a live `pitway init` + `pitway resume` run
confirmed `resume` is not a meaningful first-run command on a fresh repo;
CLAUDE.md's state-machine terminology was re-checked and is undrifted.

**Second reconciliation pass, developer-directed (2026-08-24)**, after an
independent `milestone-review` (`ui-ux`, `architect` roles) surfaced one
blocker and five other findings:

- **Blocker, fixed**: T003's write_scope used directory-style entries
  (`website/content/concepts/`, etc.). Verified directly against
  `src/core/tasks/update.ts`'s `assertDirtySubset` (exact `Set.has(path)`
  membership against individual git-reported dirty file paths -- a
  directory string can never match) that this would make T003
  uncompletable. T003's write_scope is now 19 exact file paths, one per
  real content/data/template file it creates.
- **Fixed**: T004's sitemap/robots generation moved into T001's
  `build.mjs` (`website/scripts/sitemap.mjs`), so `npm run build` -- the
  same command T006's deploy workflow runs -- unconditionally produces
  `sitemap.xml`/`robots.txt`. T004's `check-seo.mjs` is now pure
  validation (never generation), and T006's own verification/workflow now
  also runs `check:seo`/`check:a11y` as a pre-deploy gate rather than
  building only.
- **Fixed**: T005 now depends on T002 and T003 (not just T001), so its
  selectors target the real markup those tasks produce rather than only
  T001's fixture, addressing the same structural risk both reviewers
  independently raised (architect: live `parallel_worktrees` risk;
  ui-ux: no task reconciling cross-template design-system coherence).
  T004 (audit) still depends on T002, T003, *and* T005, so it audits the
  fully-built, fully-styled site.
- **Fixed**: "Multi-Agent Resume" renamed to "Resume Across Coding
  Agents" (T002/AC002) -- the underlying capability (`pitway resume`
  continuing state across a different supported driver) is real; the
  "Multi-Agent" framing risked implying simultaneous multi-agent
  orchestration, which CLAUDE.md's own Non-goals section explicitly
  disclaims.
- **Fixed**: "Automatic Documentation" renamed to "Durable Traceability"
  (T002/AC002) -- no README/USAGE/CLAUDE.md basis was found for an
  auto-generated-documentation claim; the real, grounded capability is
  git-trailer traceability and `.pitway/` state persistence.
- **Fixed**: T003 now requires a persistent, static section navigation
  (all 4 sections/16 pages, e.g. an always-visible sidebar) in addition
  to breadcrumbs/prev-next, addressing the no-search-plus-hub-and-spoke
  friction risk at that page count -- still no full-text search.
- **Fixed**: the homepage's "How PitWay Works" now uses a lightweight
  textual/visual step summary (the canonical diagram's own stage names),
  not the full dense `workflow.mmd` diagram, which now appears in full in
  T003's Workflow section where audience context is established. No
  second `.mmd` source is created either way -- the canonical source
  stays the one read by T001's pipeline.
- Write_scope re-verified as exact-file-path-only and disjoint,
  path-by-path, across all six tasks; the dependency graph (T001 ->
  {T002, T003} -> T005 -> T004 -> T006, with T006 also depending on
  T001-T005 directly) re-checked acyclic and semantically consistent --
  every pair of siblings (T002/T003 only) confirmed to share no file and
  no content dependency on each other, so they remain the only genuinely
  parallel-safe pair.

## Change Log

- **2026-08-24**: Developer visually inspected the actual rendered
  `website/dist/assets/workflow.svg` after T001 completed and requested
  node shapes render with a fully transparent fill (text directly on the
  page background) instead of T001's original opaque `#E8EEF7` chip
  design. `website/scripts/build.mjs` (where this must change) is owned
  solely by T001, already `completed` -- confirmed no remaining task
  (T002-T006) has write_scope over it, so this cannot be contained in any
  planned task. Adding T007, a narrowly-scoped follow-on task
  (`website/scripts/build.mjs`, `website/scripts/build.test.mjs` only)
  via `task-add`, depending on T001. Node stroke/text colors and the
  already-correct subgraph/root-canvas transparency are unchanged.
- **2026-08-24**: T002 and T003 both independently hit and documented the
  same real defect: `build.mjs`'s HTML wrapper only emits charset/
  viewport/title into `<head>`, so meta description/canonical/OG tags had
  to be embedded as raw HTML in `<body>` instead -- functionally inert for
  real search engines/social crawlers, so AC002/AC003's SEO requirement
  was met textually but not functionally. Developer approved fixing this
  now rather than deferring. Adding T008, depending on T002 and T003:
  extends `build.mjs` with real front-matter -> `<head>` injection (TDD),
  then migrates the homepage and all 17 documentation pages off the
  raw-HTML-in-body workaround. Since T007 also touches `build.mjs`, the
  driver sequences T007 before T008 rather than running them concurrently
  (PitWay's own dependency graph doesn't need to express this: `depends_on`
  is not amendable after creation, and both tasks target the same file
  regardless of declared dependencies, so this is enforced by the driver's
  own dispatch order, not a graph edge).
