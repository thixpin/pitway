#!/usr/bin/env node
// Read-only SEO audit over already-built HTML (website/dist/). Validates,
// never generates: sitemap.xml/robots.txt are produced unconditionally by
// build.mjs's own pipeline (AC001) -- this script only checks they exist
// and are well-formed, and never opens or edits a template/style/content
// file owned by another task.
//
// M049/T004 (AC006): beyond presence checks, this audit now holds the
// site-identity invariants Google reads a site name from -- one og:site_name
// everywhere, a branded <title> and canonical on every indexable page,
// WebSite JSON-LD on the homepage and BreadcrumbList JSON-LD elsewhere --
// and the noindex/sitemap interlock (a noindex page is exempt from the
// canonical/OG requirements but must never be advertised in sitemap.xml;
// the sitemap must list exactly the indexable pages' canonicals).

import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { findHtmlFiles, DEFAULT_SITE_URL, SITE_NAME } from "./sitemap.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEBSITE_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(WEBSITE_ROOT, "dist");
const HOME_URL = `${DEFAULT_SITE_URL}/`;

function extractHead(html) {
  const match = html.match(/<head>([\s\S]*?)<\/head>/);
  return match ? match[1] : "";
}

function firstMatch(text, regex) {
  const match = text.match(regex);
  return match ? match[1] : null;
}

function isNoindex(head) {
  return /<meta name="robots" content="[^"]*\bnoindex\b[^"]*">/i.test(head);
}

/** Every <script type="application/ld+json"> block in the head, parsed (or its parse error). */
function jsonLdBlocks(head) {
  return [...head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => {
    try {
      return { value: JSON.parse(m[1]) };
    } catch (err) {
      return { error: err.message };
    }
  });
}

/**
 * Per-page checks. Returns the problems plus what the sitemap check needs:
 * whether the page is indexable and which canonical it declares.
 */
function checkPage(relPath, html) {
  const problems = [];
  const head = extractHead(html);
  const noindex = isNoindex(head);
  const title = firstMatch(head, /<title>([^<]+)<\/title>/);
  const canonical = firstMatch(head, /<link rel="canonical" href="([^"]+)">/);
  const siteName = firstMatch(head, /<meta property="og:site_name" content="([^"]*)">/);

  // Every page, indexable or not.
  if (!title) problems.push("missing <title>");
  if (!/<meta name="description" content="[^"]+">/.test(head)) problems.push("missing meta description");
  if (siteName !== SITE_NAME) {
    problems.push(`og:site_name must be exactly "${SITE_NAME}" (found ${siteName === null ? "none" : `"${siteName}"`})`);
  }
  if (!/<meta name="twitter:card" content="[^"]+">/.test(head)) problems.push("missing twitter:card");

  const blocks = jsonLdBlocks(head);
  for (const [index, block] of blocks.entries()) {
    if (block.error) {
      problems.push(`JSON-LD block ${index + 1} is not valid JSON (${block.error})`);
    } else if (block.value?.["@context"] !== "https://schema.org" || !block.value?.["@type"]) {
      problems.push(`JSON-LD block ${index + 1} must declare @context https://schema.org and an @type`);
    }
  }
  const types = blocks.filter((b) => b.value).map((b) => b.value);

  // Indexable pages only: the signals a search engine reads and lists.
  if (!noindex) {
    if (title && !title.includes(SITE_NAME)) problems.push(`<title> must contain "${SITE_NAME}" (found "${title}")`);
    if (!canonical) problems.push("missing canonical URL");
    if (!/<meta property="og:title" content="[^"]+">/.test(head)) problems.push("missing og:title");
    if (!/<meta property="og:description" content="[^"]+">/.test(head)) problems.push("missing og:description");
    if (canonical === HOME_URL) {
      if (!types.some((t) => t["@type"] === "WebSite" && t.name === SITE_NAME)) {
        problems.push(`homepage must carry WebSite JSON-LD named "${SITE_NAME}"`);
      }
    } else if (canonical && !types.some((t) => t["@type"] === "BreadcrumbList")) {
      problems.push("indexable page must carry BreadcrumbList JSON-LD");
    }
  }

  const headingLevels = [...html.matchAll(/<h([1-6])[ >]/g)].map((m) => Number(m[1]));
  const h1Count = headingLevels.filter((level) => level === 1).length;
  if (h1Count !== 1) problems.push(`expected exactly one <h1>, found ${h1Count}`);
  for (let i = 1; i < headingLevels.length; i++) {
    if (headingLevels[i] > headingLevels[i - 1] + 1) {
      problems.push(`heading level skips from h${headingLevels[i - 1]} to h${headingLevels[i]}`);
      break;
    }
  }

  return { problems: problems.map((problem) => `${relPath}: ${problem}`), indexable: !noindex, canonical };
}

async function checkSitemapAndRobots(pages) {
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

    // The sitemap must list exactly the indexable pages' canonicals: nothing
    // noindex, nothing the pages don't claim, nothing indexable left out.
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).sort();
    const expected = pages
      .filter((p) => p.indexable && p.canonical)
      .map((p) => p.canonical)
      .sort();
    for (const url of expected.filter((u) => !locs.includes(u))) {
      problems.push(`sitemap.xml is missing indexable canonical ${url}`);
    }
    for (const url of locs.filter((u) => !expected.includes(u))) {
      problems.push(`sitemap.xml lists ${url}, which is not an indexable page's canonical`);
    }
    for (const page of pages.filter((p) => !p.indexable && p.canonical && locs.includes(p.canonical))) {
      problems.push(`sitemap.xml lists noindex page ${page.canonical}`);
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
  const pages = [];
  for (const file of htmlFiles) {
    const html = await fs.readFile(file, "utf8");
    const result = checkPage(path.relative(OUT_DIR, file), html);
    problems.push(...result.problems);
    pages.push(result);
  }
  problems.push(...(await checkSitemapAndRobots(pages)));

  if (problems.length > 0) {
    console.error(`check-seo: ${problems.length} problem(s) found:\n`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }

  const indexable = pages.filter((p) => p.indexable).length;
  console.log(
    `check-seo: ${htmlFiles.length} page(s) OK (${indexable} indexable, ${htmlFiles.length - indexable} noindex) -- ` +
      `og:site_name "${SITE_NAME}" and twitter:card everywhere; branded <title>, canonical, OG, and JSON-LD ` +
      `(WebSite on the homepage, BreadcrumbList elsewhere) on every indexable page; sitemap.xml lists exactly ` +
      `the indexable canonicals; robots.txt well-formed; heading hierarchy valid.`,
  );
}

main();
