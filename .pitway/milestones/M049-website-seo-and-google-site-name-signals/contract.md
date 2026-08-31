---
schema_version: 1
id: M049
title: Website SEO and Google Site-Name Signals
status: in_progress
requirement: null
confirmed_at: 2026-08-31T05:36:47Z
verification_approved_hash: sha256:fb4cbcfb67f4a5840bea73ec3cee3c5792cd4077fb69d236f57e82d1295ba176
base_branch: main
base_revision: 3b47e7a242f1e69279d30d224484523d6571c06e
acceptance_criteria:
  - id: AC001
    text: 'Site identity is one constant: SITE_NAME = "PitWay" lives beside
      DEFAULT_SITE_URL in website/scripts/sitemap.mjs, and build.mjs emits <meta
      property="og:site_name" content="PitWay"> on every built page from it. The
      per-page ogSiteName front-matter key is no longer honoured (a page that
      still declares it does not change the emitted tag) and no content file
      declares it. The homepage emits two JSON-LD blocks: a WebSite {name
      PitWay, url https://pitway.thixpin.me/, description} and a
      SoftwareSourceCode {name PitWay, url, description, codeRepository,
      programmingLanguage TypeScript, runtimePlatform Node.js, license, author
      Person} whose repository, author name/url, license, and homepage values
      are read from the repo root package.json at build time -- never
      hand-typed, never an Organization, never offers/ratings. JSON-LD is
      serialized with JSON.stringify with every < escaped as \u003c, and is
      never passed through the HTML attribute escaper.'
  - id: AC002
    text: "build.mjs honours a title: front-matter key as the page <title> (fallback
      unchanged: the first ATX h1, then the file basename). Every docs page and
      manual-checks set title: to the exact value of their existing ogTitle
      (e.g. \"Tasks · PitWay Docs\"); 404.md sets title: \"404 — Page Not Found
      | PitWay\"; the homepage <title> stays \"PitWay — The Pit Crew for Agentic
      Coding\". Every built page's <title> therefore contains \"PitWay\"."
  - id: AC003
    text: Every built page emits <meta name="twitter:card" content="summary"> from
      build.mjs (Twitter/X falls back to og:title / og:description). No og:image
      or twitter:image is fabricated -- the site ships no raster social image
      and none is invented.
  - id: AC004
    text: 'build.mjs honours a robots: front-matter key, emitting <meta
      name="robots" content="<value>">. 404.md and manual-checks.md declare
      robots: "noindex"; 404.md drops its canonical and ogUrl keys (an error
      page is not a canonical destination). sitemap.mjs excludes every built
      page whose <head> carries a robots meta containing noindex, in addition to
      its existing 404.html exclusion. robots.txt is unchanged (Allow: / plus
      the Sitemap line). No indexable page gains a noindex.'
  - id: AC005
    text: "Every indexable page other than the homepage emits a JSON-LD
      BreadcrumbList mirroring the linked part of its visible breadcrumb trail:
      PitWay (https://pitway.thixpin.me/) > Docs
      (https://pitway.thixpin.me/docs/index.html) > <page h1> (the page's
      canonical); the docs index itself emits PitWay > Docs. The un-linked
      section label (e.g. Concepts) is not a ListItem because it has no URL.
      Noindex pages and the homepage emit no BreadcrumbList."
  - id: AC006
    text: 'website/scripts/check-seo.mjs enforces the new invariants against the
      built output and fails CI on regression: og:site_name equals PitWay on
      every page; twitter:card present on every page; for indexable pages (no
      robots noindex) the <title> contains PitWay, canonical is present, and the
      set of sitemap <loc> URLs equals the set of indexable canonical URLs;
      noindex pages are exempt from the canonical/OG requirements and must not
      appear in sitemap.xml; every <script type="application/ld+json"> block
      parses as JSON with @context https://schema.org and an @type; the homepage
      carries a WebSite whose name is PitWay; every indexable non-home page
      carries a BreadcrumbList. Existing
      title/description/heading/sitemap/robots checks remain.'
  - id: AC007
    text: "The reference files whose comments declare they must mirror the built
      pages are brought back in sync: website/templates/homepage.html's
      canonical and og:url become https://pitway.thixpin.me/ and it gains
      og:site_name PitWay, twitter:card summary, and a comment naming the
      build-emitted JSON-LD; website/templates/docs.html's og:site_name becomes
      PitWay and its per-page head block shows the title: key;
      website/data/docs-nav.yaml's site.index_page becomes /docs/index.html. No
      other content or design changes."
  - id: AC008
    text: "Gate: npm run typecheck && npm test (root) and the website pipeline --
      build, check:seo, check:a11y, and node website/scripts/build.test.mjs --
      all pass from a clean tree. The built output under website/dist is
      byte-for-byte what the source produces; dist stays gitignored."
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: node website/scripts/build.test.mjs
  - id: CT002
    criterion: AC002
    type: command
    command: node website/scripts/build.test.mjs
  - id: CT003
    criterion: AC003
    type: command
    command: node website/scripts/build.test.mjs
  - id: CT004
    criterion: AC004
    type: command
    command: node website/scripts/build.test.mjs
  - id: CT005
    criterion: AC005
    type: command
    command: node website/scripts/build.test.mjs
  - id: CT006
    criterion: AC006
    type: command
    command: npm --prefix website run build && npm --prefix website run check:seo &&
      npm --prefix website run check:a11y
  - id: CT007
    criterion: AC007
    type: command
    command: "grep -q 'rel=\"canonical\" href=\"https://pitway.thixpin.me/\"'
      website/templates/homepage.html && grep -q 'og:site_name\"
      content=\"PitWay\"' website/templates/homepage.html && grep -q
      'og:site_name\" content=\"PitWay\"' website/templates/docs.html && grep -q
      'index_page: /docs/index.html' website/data/docs-nav.yaml"
  - id: CT008
    criterion: AC008
    type: command
    command: npm run typecheck && npm test && npm --prefix website run build && npm
      --prefix website run check:seo && npm --prefix website run check:a11y &&
      node website/scripts/build.test.mjs
    timeout_ms: 900000
---

# Contract

## Objective

Give https://pitway.thixpin.me the site-identity signals Google documents
for choosing a displayed site name, and close the rest of the SEO gaps an
audit of the built site found. Today Google shows the site as "Soe Thura":
the parent domain thixpin.me publishes `<title>Soe Thura | Site Reliability
Engineer</title>` and a matching og:site_name, while the PitWay homepage
emits no og:site_name and no WebSite structured data -- so Google resolved
the subdomain's name from the domain level. The brand is unambiguous from
the project itself (package name `pitway`, README `# PitWay`, homepage h1
and title, docs sidebar), yet the site's own signals are inconsistent:
docs pages say "PitWay Docs", the homepage says nothing, bare docs titles
("Tasks", "Merge") carry no brand, there is no Twitter card, no JSON-LD, the
404 page advertises a canonical, and an orphan internal checklist page is
in the sitemap. This milestone fixes those in the build pipeline and
content, and extends the existing check-seo audit so CI holds the line.

## Scope / tasks

- T001 Build pipeline identity: SITE_NAME constant, global og:site_name and
  twitter:card, `title:` and `robots:` front-matter keys, noindex-aware
  sitemap (AC001 part, AC002, AC003, AC004). TDD in build.test.mjs.
- T002 JSON-LD emission: WebSite + SoftwareSourceCode on the homepage from
  package.json facts; BreadcrumbList on indexable non-home pages (AC001,
  AC005). TDD in build.test.mjs.
- T003 Content front matter: `title:` on every docs page, remove every
  ogSiteName, noindex 404 + manual-checks, drop 404's canonical/ogUrl
  (AC002, AC004).
- T004 check-seo.mjs enforcement of the new invariants (AC006).
- T005 Reference templates and nav data back in sync (AC007).
- T006 Full gate (AC008).

T001 first; T002 depends on T001; T003 on T002; T004 on T003; T005 on T004;
T006 on T005.

## Dependencies

- M032's website build pipeline (build.mjs front-matter head injection,
  sitemap.mjs, check-seo.mjs, check-a11y.mjs) is the fixed starting point.
- Root package.json (`homepage`, `repository`, `author`, `license`) is the
  single source for the SoftwareSourceCode facts.
- Deployment is out of scope: the site deploys only on a push to the
  `website` branch (website-deploy.yml); merging this milestone into main
  changes nothing in production until the developer updates that branch.

## Non-Goals

- Changing page copy, design, CSS, navigation, or URL structure (`.html`
  paths and `/` for the homepage stay; canonical forms unchanged).
- Fabricating an og:image / social image, an Organization, reviews,
  ratings, or any structured-data fact not present in the repo.
- Replacing the SVG emoji favicon or adding raster icons (reported as a
  risk, left as a design decision).
- Sitemap lastmod/priority, hreflang, or a second locale.
- Search Console submission, recrawl requests, or any promise about when or
  whether Google changes the displayed site name.
- Updating the `website` deploy branch.

## Change Log

- 2026-08-31: Drafted from the SEO audit of website/ (built output, live
  site, and the parent domain's identity signals).
