#!/usr/bin/env node
// Read-only accessibility audit over already-built HTML/CSS (website/dist/).
// Validates automatable signals only -- image alt text, and that T005's
// :focus-visible / prefers-reduced-motion CSS actually shipped in the
// build output. What this can't automate (keyboard navigation, reduced-
// motion *behavior*, video captions) is documented in
// website/content/manual-checks.md. Never generates content or edits a
// template/style/content file owned by another task.

import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { findHtmlFiles } from "./sitemap.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEBSITE_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(WEBSITE_ROOT, "dist");

function checkImagesHaveAlt(relPath, html) {
  const problems = [];
  const imgTags = html.match(/<img[^>]*>/g) ?? [];
  for (const tag of imgTags) {
    const altMatch = tag.match(/alt="([^"]*)"/);
    if (!altMatch || altMatch[1].trim().length === 0) {
      problems.push(`${relPath}: <img> missing non-empty alt text (${tag.slice(0, 60)}${tag.length > 60 ? "..." : ""})`);
    }
  }
  return problems;
}

async function checkStylesheetSignals() {
  const stylesDir = path.join(OUT_DIR, "styles");
  let files;
  try {
    files = await fs.readdir(stylesDir);
  } catch {
    return ["no built styles/ directory found under website/dist -- run `npm run build` first"];
  }

  let combinedCss = "";
  for (const file of files) {
    if (file.endsWith(".css")) {
      combinedCss += await fs.readFile(path.join(stylesDir, file), "utf8");
    }
  }

  const problems = [];
  if (!/:focus-visible/.test(combinedCss)) {
    problems.push("no :focus-visible rule found in the built stylesheets");
  }
  if (!/prefers-reduced-motion/.test(combinedCss)) {
    problems.push("no prefers-reduced-motion media query found in the built stylesheets");
  }
  return problems;
}

async function main() {
  const htmlFiles = await findHtmlFiles(OUT_DIR);
  if (htmlFiles.length === 0) {
    console.error("check-a11y: no built HTML pages found under website/dist -- run `npm run build` first.");
    process.exitCode = 1;
    return;
  }

  const problems = [];
  for (const file of htmlFiles) {
    const html = await fs.readFile(file, "utf8");
    problems.push(...checkImagesHaveAlt(path.relative(OUT_DIR, file), html));
  }
  problems.push(...(await checkStylesheetSignals()));

  if (problems.length > 0) {
    console.error(`check-a11y: ${problems.length} problem(s) found:\n`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `check-a11y: ${htmlFiles.length} page(s) OK -- image alt text present, :focus-visible and prefers-reduced-motion CSS shipped.`,
  );
}

main();
