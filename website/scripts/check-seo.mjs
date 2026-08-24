#!/usr/bin/env node
// Read-only SEO audit over already-built HTML (website/dist/). Validates,
// never generates: sitemap.xml/robots.txt are produced unconditionally by
// build.mjs's own pipeline (AC001) -- this script only checks they exist
// and are well-formed, and never opens or edits a template/style/content
// file owned by another task.

import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { findHtmlFiles } from "./sitemap.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEBSITE_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(WEBSITE_ROOT, "dist");

function extractHead(html) {
  const match = html.match(/<head>([\s\S]*?)<\/head>/);
  return match ? match[1] : "";
}

/** Title/description/canonical/OG presence, plus heading hierarchy (single h1, no skipped levels). */
function checkPage(relPath, html) {
  const problems = [];
  const head = extractHead(html);

  if (!/<title>[^<]+<\/title>/.test(head)) problems.push("missing <title>");
  if (!/<meta name="description" content="[^"]+">/.test(head)) problems.push("missing meta description");
  if (!/<link rel="canonical" href="[^"]+">/.test(head)) problems.push("missing canonical URL");
  if (!/<meta property="og:title" content="[^"]+">/.test(head)) problems.push("missing og:title");
  if (!/<meta property="og:description" content="[^"]+">/.test(head)) problems.push("missing og:description");

  const headingLevels = [...html.matchAll(/<h([1-6])[ >]/g)].map((m) => Number(m[1]));
  const h1Count = headingLevels.filter((level) => level === 1).length;
  if (h1Count !== 1) problems.push(`expected exactly one <h1>, found ${h1Count}`);
  for (let i = 1; i < headingLevels.length; i++) {
    if (headingLevels[i] > headingLevels[i - 1] + 1) {
      problems.push(`heading level skips from h${headingLevels[i - 1]} to h${headingLevels[i]}`);
      break;
    }
  }

  return problems.map((problem) => `${relPath}: ${problem}`);
}

async function checkSitemapAndRobots() {
  const problems = [];

  let sitemap;
  try {
    sitemap = await fs.readFile(path.join(OUT_DIR, "sitemap.xml"), "utf8");
  } catch {
    problems.push("sitemap.xml is missing from the build output");
  }
  if (sitemap !== undefined) {
    if (!/^<\?xml version="1\.0" encoding="UTF-8"\?>/.test(sitemap)) {
      problems.push("sitemap.xml is missing its XML declaration");
    }
    if (!/<urlset[^>]*>/.test(sitemap) || !/<\/urlset>/.test(sitemap)) {
      problems.push("sitemap.xml is missing a well-formed <urlset> root element");
    }
  }

  let robots;
  try {
    robots = await fs.readFile(path.join(OUT_DIR, "robots.txt"), "utf8");
  } catch {
    problems.push("robots.txt is missing from the build output");
  }
  if (robots !== undefined && !/Sitemap: https?:\/\/\S+/.test(robots)) {
    problems.push("robots.txt is missing a Sitemap: line");
  }

  return problems;
}

async function main() {
  const htmlFiles = await findHtmlFiles(OUT_DIR);
  if (htmlFiles.length === 0) {
    console.error("check-seo: no built HTML pages found under website/dist -- run `npm run build` first.");
    process.exitCode = 1;
    return;
  }

  const problems = [];
  for (const file of htmlFiles) {
    const html = await fs.readFile(file, "utf8");
    problems.push(...checkPage(path.relative(OUT_DIR, file), html));
  }
  problems.push(...(await checkSitemapAndRobots()));

  if (problems.length > 0) {
    console.error(`check-seo: ${problems.length} problem(s) found:\n`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `check-seo: ${htmlFiles.length} page(s) OK -- title/description/canonical/OG present, heading hierarchy valid, sitemap.xml/robots.txt well-formed.`,
  );
}

main();
