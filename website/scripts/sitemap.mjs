// Sitemap/robots generation -- imported by build.mjs and run unconditionally
// as part of `npm run build` (never a separate, manually-invoked script).
// Walks whatever *.html files already exist in the build output directory
// and writes sitemap.xml + robots.txt alongside them.

import path from "node:path";
import fs from "node:fs/promises";

const DEFAULT_SITE_URL = "https://pitway.thixpin.me";
// M049/T001 (AC001): the one site name every page publishes (og:site_name,
// WebSite JSON-LD, breadcrumb root). Google resolves a displayed site name
// from these signals; an inconsistent or missing name falls back to the
// parent domain's identity.
const SITE_NAME = "PitWay";

// A page whose <head> opts out of indexing is still built and served, but
// never advertised in the sitemap.
const NOINDEX_META = /<meta\s+name="robots"\s+content="[^"]*\bnoindex\b[^"]*"/i;

async function isNoindexPage(htmlFilePath) {
  const html = await fs.readFile(htmlFilePath, "utf8");
  const head = html.match(/<head>([\s\S]*?)<\/head>/);
  return NOINDEX_META.test(head ? head[1] : html);
}

/** Recursively collect every *.html file under `dir`. Returns [] if `dir` doesn't exist. */
export async function findHtmlFiles(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }

  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findHtmlFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      files.push(fullPath);
    }
  }
  return files;
}

/** Map an on-disk HTML file (inside outDir) to its site URL path. `index.html` maps to `/`. */
export function toUrlPath(outDir, htmlFilePath) {
  const rel = path.relative(outDir, htmlFilePath).split(path.sep).join("/");
  if (rel === "index.html") return "/";
  return `/${rel}`;
}

export function buildSitemapXml(urlPaths, siteUrl) {
  const entries = urlPaths
    .map((urlPath) => `  <url><loc>${siteUrl}${urlPath}</loc></url>`)
    .join("\n");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    (entries ? `${entries}\n` : "") +
    `</urlset>\n`
  );
}

export function buildRobotsTxt(siteUrl) {
  return `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`;
}

/**
 * Generate sitemap.xml and robots.txt into `outDir` from whatever *.html
 * files currently exist there. Unconditional: called every build, even
 * when zero pages exist yet (produces an empty <urlset>).
 */
export async function generateSitemapAndRobots({
  outDir,
  siteUrl = DEFAULT_SITE_URL,
}) {
  const htmlFiles = await findHtmlFiles(outDir);
  // 404.html is an error page, not a real destination -- standard practice
  // is to keep it out of the sitemap entirely. Likewise any page that
  // declares itself noindex.
  const urlPaths = [];
  for (const file of htmlFiles) {
    if (path.basename(file) === "404.html") continue;
    if (await isNoindexPage(file)) continue;
    urlPaths.push(toUrlPath(outDir, file));
  }
  urlPaths.sort();

  await fs.writeFile(
    path.join(outDir, "sitemap.xml"),
    buildSitemapXml(urlPaths, siteUrl),
    "utf8",
  );
  await fs.writeFile(
    path.join(outDir, "robots.txt"),
    buildRobotsTxt(siteUrl),
    "utf8",
  );

  return { urlPaths };
}

export { DEFAULT_SITE_URL, SITE_NAME };
