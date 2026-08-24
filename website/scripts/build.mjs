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
export const STYLES_DIR = path.join(WEBSITE_ROOT, "styles");
// Cascade order matters: layout.css and typography.css both consume
// tokens.css's custom properties.
export const STYLESHEET_FILES = ["tokens.css", "layout.css", "typography.css"];
export const WORKFLOW_MMD = path.join(
  REPO_ROOT,
  "docs",
  "assets",
  "workflow.mmd",
);

// Diagram colors chosen to stay legible whether the SVG lands on a
// #111629 (dark navy) or #FFFFFF (white) page background:
//   - node shapes (rect/circle/ellipse/polygon/path) render with a fully
//     transparent fill -- no opaque backing chip -- so text sits directly
//     on the page background; stroke and text colors below already read
//     correctly against both #111629 and #FFFFFF on their own.
//   - lines/borders use a mid-tone cyan accent, which keeps enough contrast
//     against both a near-black and a near-white surface.
//   - DIAGRAM_NODE_FILL still backs unrelated elements (edge labels,
//     icon/image shapes) that aren't node shapes and are unaffected here.
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

/**
 * Parse a leading `---\n...\n---\n` front-matter block off a Markdown
 * source, returning `{ data, content }` (content has the block stripped).
 * A file with no such block returns `{ data: {}, content: markdownSource }`
 * unchanged -- the backward-compatible fallback path.
 *
 * Hand-rolled rather than pulling in a YAML parser: every front-matter file
 * in this project is a flat set of known string keys (see
 * FRONT_MATTER_HEAD_KEYS below), one `key: "value"` pair per line. Each
 * line is split on its FIRST colon only, so a colon inside the value itself
 * (e.g. "Two-tier verification: each task...") is preserved verbatim rather
 * than needing full YAML flow-scalar escaping. Values may optionally be
 * wrapped in matching quotes, which are stripped. This intentionally does
 * not support multi-line values, lists, or nested structures -- none of
 * which this project's front matter uses.
 */
export function parseFrontMatter(markdownSource) {
  const match = markdownSource.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { data: {}, content: markdownSource };
  }

  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    let value = line.slice(sep + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    data[key] = value;
  }

  return { data, content: markdownSource.slice(match[0].length) };
}

/** Escape a string for safe use as HTML text/attribute content. */
function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Front-matter key -> Open Graph `property` value. description/canonical
// use their own tag shapes (<meta name>/<link rel>) and are handled
// separately in buildMetaTags below.
const FRONT_MATTER_OG_TAGS = [
  ["ogType", "og:type"],
  ["ogTitle", "og:title"],
  ["ogDescription", "og:description"],
  ["ogUrl", "og:url"],
  ["ogSiteName", "og:site_name"],
];

/** Build the optional <head> metadata tags for whichever front-matter keys are present. Only emits tags for keys actually given. */
function buildMetaTags({ description, canonical, ...og }) {
  const lines = [];
  if (description) {
    lines.push(`<meta name="description" content="${escapeHtml(description)}">`);
  }
  if (canonical) {
    lines.push(`<link rel="canonical" href="${escapeHtml(canonical)}">`);
  }
  for (const [key, property] of FRONT_MATTER_OG_TAGS) {
    if (og[key]) {
      lines.push(`<meta property="${property}" content="${escapeHtml(og[key])}">`);
    }
  }
  return lines;
}

/**
 * Render one Markdown document to a standalone HTML page. Markdown -> HTML
 * only, no client-side rendering. `meta.title` is required; `description`,
 * `canonical`, `ogType`, `ogTitle`, `ogDescription`, `ogUrl`, and
 * `ogSiteName` are optional and, when given, are injected as real <head>
 * tags (never left in <body>). Omitting all of them reproduces the
 * original bare charset/viewport/title-only <head>.
 */
export function renderMarkdownToHtml(markdownSource, meta) {
  const { title, ...rest } = meta;
  const body = marked.parse(markdownSource);
  const metaTags = buildMetaTags(rest);
  const headExtra = metaTags.length ? `\n${metaTags.join("\n")}` : "";
  // Root-relative hrefs: every page (root-level docs-index.html, one level
  // deep under pages/getting-started/concepts/workflow/agents) is served
  // from the site's domain root (see sitemap.mjs's DEFAULT_SITE_URL), so
  // "/styles/x.css" resolves correctly regardless of the page's own depth.
  const stylesheetLinks = STYLESHEET_FILES.map(
    (file) => `<link rel="stylesheet" href="/styles/${file}">`,
  ).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${stylesheetLinks}
<title>${escapeHtml(title)}</title>${headExtra}
</head>
<body>
${body}</body>
</html>
`;
}

/** Copy the three CSS files from website/styles/ into <outDir>/styles/, unmodified. */
export async function copyStylesheets(outDir) {
  const targetDir = path.join(outDir, "styles");
  await fsp.mkdir(targetDir, { recursive: true });
  for (const file of STYLESHEET_FILES) {
    await fsp.copyFile(path.join(STYLES_DIR, file), path.join(targetDir, file));
  }
}

/** Convert every *.md file under contentDir to an *.html file under outDir, mirroring its relative path. Parses each file's optional front matter into the built page's real <head>. */
export async function buildContentPages(contentDir, outDir) {
  const markdownFiles = await findMarkdownFiles(contentDir);
  const written = [];

  for (const mdPath of markdownFiles) {
    const relPath = path.relative(contentDir, mdPath);
    const htmlRelPath = relPath.replace(/\.md$/, ".html");
    const outPath = path.join(outDir, htmlRelPath);

    const source = await fsp.readFile(mdPath, "utf8");
    const { data, content } = parseFrontMatter(source);
    const title = titleFromMarkdown(content, path.basename(htmlRelPath, ".html"));
    const html = renderMarkdownToHtml(content, { title, ...data });

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

  // Node shapes (rect/circle/ellipse/polygon/path) get a transparent fill
  // instead of the DIAGRAM_NODE_FILL chip -- Mermaid's base theme groups
  // all five shapes into one comma-separated CSS rule ending in
  // ".node path{fill:...}", so overriding that one selector's fill covers
  // all of them. Stroke (DIAGRAM_BORDER_COLOR) and text (DIAGRAM_TEXT_COLOR)
  // are untouched. Subgraph/cluster fill and the root canvas background
  // are already transparent via clusterBkg/-b transparent above and are
  // not touched here.
  svg = overrideCssColor(svg, ".node path", "fill", "transparent");

  // Edge labels (the 🔄 loop-icon retry-arrow text) carry the same
  // DIAGRAM_NODE_FILL chip via themeVariables.edgeLabelBackground above,
  // across four CSS rules Mermaid emits for them -- an opaque near-white
  // patch behind the label on the dark page background. Three are hex
  // (overrideCssColor handles those); .labelBkg is Mermaid's own rgba() of
  // the same color, which overrideCssColor's hex-only regex can't match, so
  // it gets its own plain replace.
  for (const selector of [".edgeLabel", ".edgeLabel p", ".edgeLabel rect"]) {
    svg = overrideCssColor(svg, selector, "background-color", "transparent");
  }
  svg = overrideCssColor(svg, ".edgeLabel rect", "fill", "transparent");
  svg = svg.replace(/(\.labelBkg\{background-color:)rgba\([^)]*\)/, "$1transparent");

  await fsp.writeFile(outputPath, svg, "utf8");

  return outputPath;
}

async function main() {
  await fsp.rm(OUT_DIR, { recursive: true, force: true });
  await fsp.mkdir(OUT_DIR, { recursive: true });

  await copyStylesheets(OUT_DIR);
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
