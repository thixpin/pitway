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
  WORKFLOW_MMD,
} from "./build.mjs";
import { generateSitemapAndRobots, findHtmlFiles } from "./sitemap.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_MD = path.join(__dirname, "__fixtures__", "sample.md");

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
