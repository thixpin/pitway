#!/usr/bin/env node
// Website build pipeline. Three unconditional steps on every `npm run build`:
//   1. Markdown (website/content/**/*.md) -> HTML, at build time only.
//   2. docs/assets/workflow.mmd -> transparent-background SVG, read directly
//      from its existing repo location (never copied into website/).
//   3. sitemap.xml + robots.txt, generated from whatever *.html pages exist
//      in the output directory once steps 1-2 have run.
// Output goes to website/dist/ (gitignored, never committed).

import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { marked } from "marked";
import { generateSitemapAndRobots, DEFAULT_SITE_URL } from "./sitemap.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const WEBSITE_ROOT = path.resolve(__dirname, "..");
export const REPO_ROOT = path.resolve(WEBSITE_ROOT, "..");
export const CONTENT_DIR = path.join(WEBSITE_ROOT, "content");
export const OUT_DIR = path.join(WEBSITE_ROOT, "dist");
export const WORKFLOW_MMD = path.join(
  REPO_ROOT,
  "docs",
  "assets",
  "workflow.mmd",
);

// Diagram colors chosen to stay legible whether the SVG lands on a
// #111629 (dark navy) or #FFFFFF (white) page background:
//   - node fills are an opaque light chip (own contrast backdrop, so they
//     read the same regardless of page background) with dark navy text.
//   - lines/borders use a mid-tone cyan accent, which keeps enough contrast
//     against both a near-black and a near-white surface.
const DIAGRAM_NODE_FILL = "#E8EEF7";
const DIAGRAM_TEXT_COLOR = "#111629";
const DIAGRAM_LINE_COLOR = "#3D8BD9";
const DIAGRAM_BORDER_COLOR = "#3D8BD9";

/** Recursively collect every *.md file under `dir`. Returns [] if `dir` doesn't exist. */
export async function findMarkdownFiles(dir) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }

  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findMarkdownFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

/** Derive a page <title> from the first ATX h1 in the Markdown source, if any. */
export function titleFromMarkdown(markdownSource, fallback) {
  const match = markdownSource.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : fallback;
}

/** Render one Markdown document to a standalone HTML page. Markdown -> HTML only, no client-side rendering. */
export function renderMarkdownToHtml(markdownSource, { title }) {
  const body = marked.parse(markdownSource);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
</head>
<body>
${body}</body>
</html>
`;
}

/** Convert every *.md file under contentDir to an *.html file under outDir, mirroring its relative path. */
export async function buildContentPages(contentDir, outDir) {
  const markdownFiles = await findMarkdownFiles(contentDir);
  const written = [];

  for (const mdPath of markdownFiles) {
    const relPath = path.relative(contentDir, mdPath);
    const htmlRelPath = relPath.replace(/\.md$/, ".html");
    const outPath = path.join(outDir, htmlRelPath);

    const source = await fsp.readFile(mdPath, "utf8");
    const title = titleFromMarkdown(source, path.basename(htmlRelPath, ".html"));
    const html = renderMarkdownToHtml(source, { title });

    await fsp.mkdir(path.dirname(outPath), { recursive: true });
    await fsp.writeFile(outPath, html, "utf8");
    written.push(outPath);
  }

  return written;
}

/** Escape a string for literal use inside a RegExp. */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * In a rendered SVG's inline <style> block, replace whatever hex color
 * Mermaid computed for `property` on `selector` (e.g. ".cluster text",
 * "fill") with `color`. Targets the CSS selector rather than a hardcoded
 * hex, so it stays correct even if Mermaid's internal color computation
 * changes across versions.
 */
export function overrideCssColor(svg, selector, property, color) {
  const re = new RegExp(
    `(${escapeRegExp(selector)}\\s*\\{[^}]*?${property}\\s*:\\s*)#[0-9a-fA-F]{3,8}`,
    "g",
  );
  return svg.replace(re, `$1${color}`);
}

/** Resolve the locally-installed mmdc (Mermaid CLI) binary. */
export function resolveMmdcBin() {
  const bin = path.join(
    WEBSITE_ROOT,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "mmdc.cmd" : "mmdc",
  );
  if (!fs.existsSync(bin)) {
    throw new Error(
      `mmdc (Mermaid CLI) not found at ${bin} -- did \`npm ci\` install devDependencies?`,
    );
  }
  return bin;
}

/**
 * Render a .mmd source (read from its existing location, never copied) to a
 * transparent-background SVG via the Mermaid CLI, into `outDir` as `fileName`.
 */
export async function renderWorkflowDiagram(
  mmdPath,
  outDir,
  fileName = "workflow.svg",
) {
  await fsp.mkdir(outDir, { recursive: true });

  const themeConfigPath = path.join(outDir, ".mermaid-theme.json");
  const outputPath = path.join(outDir, fileName);

  await fsp.writeFile(
    themeConfigPath,
    JSON.stringify({
      theme: "base",
      themeVariables: {
        primaryColor: DIAGRAM_NODE_FILL,
        primaryTextColor: DIAGRAM_TEXT_COLOR,
        primaryBorderColor: DIAGRAM_BORDER_COLOR,
        secondaryColor: DIAGRAM_NODE_FILL,
        tertiaryColor: DIAGRAM_NODE_FILL,
        lineColor: DIAGRAM_LINE_COLOR,
        textColor: DIAGRAM_TEXT_COLOR,
        edgeLabelBackground: DIAGRAM_NODE_FILL,
        clusterBkg: "transparent",
        clusterBorder: DIAGRAM_LINE_COLOR,
        arrowheadColor: DIAGRAM_LINE_COLOR,
        titleColor: DIAGRAM_LINE_COLOR,
      },
    }),
    "utf8",
  );

  const mmdc = resolveMmdcBin();
  execFileSync(
    mmdc,
    [
      "-i",
      mmdPath,
      "-o",
      outputPath,
      "-b",
      "transparent",
      "-c",
      themeConfigPath,
    ],
    { stdio: "pipe" },
  );

  await fsp.rm(themeConfigPath, { force: true });

  // Two categories of element render straight onto the transparent canvas
  // with no opaque backing chip behind them: (1) the .mmd source's own
  // `style ... stroke:#333` on its subgraph containers (an inline SVG style
  // attribute, which wins over the themeVariables above), and (2) cluster
  // (subgraph) title text and arrowheads, whose colors Mermaid's base theme
  // derives internally rather than taking the themeVariables above verbatim.
  // Both are near-black and nearly invisible against a #111629 dark-navy
  // page background, so re-point them to the dual-readable accent used for
  // the rest of the diagram's lines. This edits only the generated SVG
  // output (a build artifact, regenerated every run) -- workflow.mmd itself
  // is never touched.
  let svg = await fsp.readFile(outputPath, "utf8");
  svg = svg.split("stroke:#333").join(`stroke:${DIAGRAM_LINE_COLOR}`);
  for (const selector of [".cluster-label text", ".cluster-label span", ".cluster text", ".cluster span"]) {
    svg = overrideCssColor(svg, selector, "fill", DIAGRAM_LINE_COLOR);
    svg = overrideCssColor(svg, selector, "color", DIAGRAM_LINE_COLOR);
  }
  svg = overrideCssColor(svg, ".arrowheadPath", "fill", DIAGRAM_LINE_COLOR);
  await fsp.writeFile(outputPath, svg, "utf8");

  return outputPath;
}

async function main() {
  await fsp.rm(OUT_DIR, { recursive: true, force: true });
  await fsp.mkdir(OUT_DIR, { recursive: true });

  await buildContentPages(CONTENT_DIR, OUT_DIR);

  if (fs.existsSync(WORKFLOW_MMD)) {
    await renderWorkflowDiagram(WORKFLOW_MMD, path.join(OUT_DIR, "assets"));
  }

  // Unconditional: sitemap.xml/robots.txt are always part of `npm run build`,
  // generated from whatever *.html pages exist in OUT_DIR at this point.
  await generateSitemapAndRobots({ outDir: OUT_DIR, siteUrl: DEFAULT_SITE_URL });
}

const isMain =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
