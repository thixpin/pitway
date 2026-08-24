// Plain Node assertion script (node:test + node:assert, no extra test
// runner dependency) that exercises the real build pipeline against a
// fixture, proving Markdown -> HTML, Mermaid -> SVG, and sitemap/robots
// generation all work -- without writing anything into website/content/,
// which doesn't exist yet and isn't owned by this task.
//
// Not wired into an npm script (package.json pre-declares only build,
// check:seo, check:a11y for this milestone); run directly with:
//   node scripts/build.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  renderMarkdownToHtml,
  titleFromMarkdown,
  renderWorkflowDiagram,
  parseFrontMatter,
  buildContentPages,
  copyStylesheets,
  WORKFLOW_MMD,
  STYLESHEET_FILES,
} from "./build.mjs";
import { generateSitemapAndRobots, findHtmlFiles } from "./sitemap.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_MD = path.join(__dirname, "__fixtures__", "sample.md");

// Inline (not a fixture file) -- __fixtures__/ is outside this task's
// write_scope, so a page with front matter is defined here as a string and
// only ever written under a temp dir, never into the repo.
const FRONTMATTER_FIXTURE_MD = `---
description: "A fixture page for testing front-matter driven <head> metadata."
canonical: "https://example.com/fixture.html"
ogType: "article"
ogTitle: "Fixture OG Title"
ogDescription: "Fixture OG description text."
ogUrl: "https://example.com/fixture.html"
ogSiteName: "Fixture Docs"
---

# Fixture Page

Body content after front matter.
`;

test("renders the Markdown fixture to HTML at build time", async () => {
  const source = await fs.readFile(FIXTURE_MD, "utf8");
  const title = titleFromMarkdown(source, "fallback");
  assert.equal(title, "Sample Page");

  const html = renderMarkdownToHtml(source, { title });
  assert.match(html, /<title>Sample Page<\/title>/);
  assert.match(html, /<h1>Sample Page<\/h1>/);
  assert.match(html, /<li>item one<\/li>/);
  assert.match(html, /<a href="https:\/\/example\.com">a link<\/a>/);
});

test("renderMarkdownToHtml falls back to a bare <head> (title only) when no front-matter metadata is given", async () => {
  const source = await fs.readFile(FIXTURE_MD, "utf8");
  const title = titleFromMarkdown(source, "fallback");
  const html = renderMarkdownToHtml(source, { title });

  const head = html.match(/<head>([\s\S]*?)<\/head>/)[1];
  assert.match(head, /<title>Sample Page<\/title>/);
  assert.doesNotMatch(head, /meta name="description"/);
  assert.doesNotMatch(head, /link rel="canonical"/);
  assert.doesNotMatch(head, /property="og:/);
});

test("parseFrontMatter extracts a leading --- YAML block and strips it from the content", () => {
  const { data, content } = parseFrontMatter(FRONTMATTER_FIXTURE_MD);

  assert.deepEqual(data, {
    description: "A fixture page for testing front-matter driven <head> metadata.",
    canonical: "https://example.com/fixture.html",
    ogType: "article",
    ogTitle: "Fixture OG Title",
    ogDescription: "Fixture OG description text.",
    ogUrl: "https://example.com/fixture.html",
    ogSiteName: "Fixture Docs",
  });
  assert.doesNotMatch(content, /^---/);
  assert.match(content, /^\s*# Fixture Page/);
});

test("parseFrontMatter returns empty data and the source unchanged when there is no front-matter block", async () => {
  const source = await fs.readFile(FIXTURE_MD, "utf8");
  const { data, content } = parseFrontMatter(source);

  assert.deepEqual(data, {});
  assert.equal(content, source);
});

test("front-matter metadata is injected into a real <head>, not left in <body>", () => {
  const { data, content } = parseFrontMatter(FRONTMATTER_FIXTURE_MD);
  const title = titleFromMarkdown(content, "fallback");
  const html = renderMarkdownToHtml(content, { title, ...data });

  const head = html.match(/<head>([\s\S]*?)<\/head>/)[1];
  const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];

  assert.match(head, /<title>Fixture Page<\/title>/);
  assert.match(
    head,
    /<meta name="description" content="A fixture page for testing front-matter driven &lt;head&gt; metadata\.">/,
  );
  assert.match(head, /<link rel="canonical" href="https:\/\/example\.com\/fixture\.html">/);
  assert.match(head, /<meta property="og:type" content="article">/);
  assert.match(head, /<meta property="og:title" content="Fixture OG Title">/);
  assert.match(head, /<meta property="og:description" content="Fixture OG description text\.">/);
  assert.match(head, /<meta property="og:url" content="https:\/\/example\.com\/fixture\.html">/);
  assert.match(head, /<meta property="og:site_name" content="Fixture Docs">/);

  // None of the injected tags leak into <body> -- this is the actual defect
  // fix: previously these landed in <body> as raw HTML, which crawlers
  // largely ignore.
  assert.doesNotMatch(body, /meta name="description"/);
  assert.doesNotMatch(body, /link rel="canonical"/);
  assert.doesNotMatch(body, /property="og:/);
  assert.match(body, /<h1>Fixture Page<\/h1>/);
});

test("renderMarkdownToHtml emits a stylesheet <link> for every STYLESHEET_FILES entry, in cascade order", () => {
  const html = renderMarkdownToHtml("# Page", { title: "Page" });
  const head = html.match(/<head>([\s\S]*?)<\/head>/)[1];

  const hrefs = [...head.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, STYLESHEET_FILES.map((file) => `/styles/${file}`));
});

test("copyStylesheets copies the three CSS files into <outDir>/styles unmodified", async () => {
  const tmpOutDir = await fs.mkdtemp(path.join(os.tmpdir(), "pitway-website-out-"));
  try {
    await copyStylesheets(tmpOutDir);
    for (const file of STYLESHEET_FILES) {
      const copied = await fs.readFile(path.join(tmpOutDir, "styles", file), "utf8");
      const source = await fs.readFile(path.join(__dirname, "..", "styles", file), "utf8");
      assert.equal(copied, source);
    }
  } finally {
    await fs.rm(tmpOutDir, { recursive: true, force: true });
  }
});

test("buildContentPages parses front matter end-to-end and writes it into the built page's <head>", async () => {
  const tmpContentDir = await fs.mkdtemp(path.join(os.tmpdir(), "pitway-website-content-"));
  const tmpOutDir = await fs.mkdtemp(path.join(os.tmpdir(), "pitway-website-out-"));
  try {
    await fs.writeFile(path.join(tmpContentDir, "fixture.md"), FRONTMATTER_FIXTURE_MD, "utf8");

    await buildContentPages(tmpContentDir, tmpOutDir);

    const html = await fs.readFile(path.join(tmpOutDir, "fixture.html"), "utf8");
    const head = html.match(/<head>([\s\S]*?)<\/head>/)[1];
    const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];

    assert.match(head, /<title>Fixture Page<\/title>/);
    assert.match(head, /<meta name="description"/);
    assert.match(head, /<link rel="canonical"/);
    assert.match(head, /<meta property="og:site_name" content="Fixture Docs">/);
    assert.doesNotMatch(body, /meta name="description"/);
    assert.doesNotMatch(body, /property="og:/);
  } finally {
    await fs.rm(tmpContentDir, { recursive: true, force: true });
    await fs.rm(tmpOutDir, { recursive: true, force: true });
  }
});

test("renders docs/assets/workflow.mmd to a transparent, dual-readable SVG", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pitway-website-"));
  try {
    const svgPath = await renderWorkflowDiagram(WORKFLOW_MMD, tmpDir);
    const svg = await fs.readFile(svgPath, "utf8");

    assert.match(svg, /<svg/);
    // The .mmd source's own inline `stroke:#333` (near-invisible on a dark
    // navy page) must have been re-pointed to the dual-readable accent.
    assert.doesNotMatch(svg, /stroke:#333/);
    assert.match(svg, /#3D8BD9/);

    // Node shapes (rect/circle/ellipse/polygon/path) render with a fully
    // transparent fill -- no opaque backing chip -- while stroke and text
    // colors stay exactly as before. Mermaid groups all five node shapes
    // into one comma-separated CSS rule ending in ".node path{fill:...}".
    const nodeRuleMatch = svg.match(/\.node path\{fill:([^;]+);stroke:([^;]+);/);
    assert.ok(nodeRuleMatch, "expected a .node path CSS rule in the SVG style block");
    assert.equal(nodeRuleMatch[1], "transparent");
    assert.equal(nodeRuleMatch[2], "#3D8BD9");
    assert.doesNotMatch(svg, /\.node (rect|circle|ellipse|polygon|path)\{fill:#E8EEF7/);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("edge-label backgrounds render transparent, not an opaque near-white chip", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pitway-website-"));
  try {
    const svgPath = await renderWorkflowDiagram(WORKFLOW_MMD, tmpDir);
    const svg = await fs.readFile(svgPath, "utf8");

    // Mermaid's base theme puts the themeVariables.edgeLabelBackground value
    // (#E8EEF7, a light color meant for node fills) into four CSS rules on
    // the 🔄 loop-icon retry-arrow labels. None should still carry it.
    assert.doesNotMatch(svg, /\.edgeLabel\{background-color:#E8EEF7/);
    assert.doesNotMatch(svg, /\.edgeLabel p\{background-color:#E8EEF7/);
    assert.doesNotMatch(svg, /\.edgeLabel rect\{[^}]*background-color:#E8EEF7/);
    assert.doesNotMatch(svg, /\.edgeLabel rect\{[^}]*fill:#E8EEF7/);
    assert.doesNotMatch(svg, /\.labelBkg\{background-color:rgba\(232, 238, 247/);

    assert.match(svg, /\.edgeLabel\{background-color:transparent/);
    assert.match(svg, /\.edgeLabel p\{background-color:transparent/);
    assert.match(svg, /\.edgeLabel rect\{[^}]*background-color:transparent[^}]*fill:transparent/);
    assert.match(svg, /\.labelBkg\{background-color:transparent/);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("docs/assets/workflow.mmd itself is never copied into the build tree", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pitway-website-"));
  try {
    await renderWorkflowDiagram(WORKFLOW_MMD, tmpDir);
    const entries = await fs.readdir(tmpDir);
    assert.ok(!entries.includes("workflow.mmd"));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("generates sitemap.xml and robots.txt from whatever HTML pages exist", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pitway-website-"));
  try {
    await fs.writeFile(path.join(tmpDir, "index.html"), "<html></html>", "utf8");
    await fs.mkdir(path.join(tmpDir, "docs"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "docs", "getting-started.html"),
      "<html></html>",
      "utf8",
    );

    const { urlPaths } = await generateSitemapAndRobots({
      outDir: tmpDir,
      siteUrl: "https://example.com",
    });
    assert.deepEqual(urlPaths.sort(), ["/", "/docs/getting-started.html"]);

    const sitemap = await fs.readFile(path.join(tmpDir, "sitemap.xml"), "utf8");
    assert.match(sitemap, /<loc>https:\/\/example\.com\/<\/loc>/);
    assert.match(
      sitemap,
      /<loc>https:\/\/example\.com\/docs\/getting-started\.html<\/loc>/,
    );

    const robots = await fs.readFile(path.join(tmpDir, "robots.txt"), "utf8");
    assert.match(robots, /Sitemap: https:\/\/example\.com\/sitemap\.xml/);

    const htmlFiles = await findHtmlFiles(tmpDir);
    assert.equal(htmlFiles.length, 2);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("generates an empty-but-valid sitemap/robots when no pages exist yet", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pitway-website-"));
  try {
    const { urlPaths } = await generateSitemapAndRobots({
      outDir: tmpDir,
      siteUrl: "https://example.com",
    });
    assert.deepEqual(urlPaths, []);

    const sitemap = await fs.readFile(path.join(tmpDir, "sitemap.xml"), "utf8");
    assert.match(sitemap, /<urlset[^>]*>\s*<\/urlset>/);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
