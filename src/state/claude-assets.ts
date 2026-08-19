import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Source directory shipped with the pitway package: AC003 requires
// src/integrations/claude/ to contain only text assets, zero .ts files,
// zero runtime code -- this module installs those assets verbatim, never
// generating or transforming their content.
const assetsSourceDir = fileURLToPath(new URL('../integrations/claude/', import.meta.url));

// Recursively lists every .md file under `dir`, returning paths relative to
// `base`. Glob-based discovery, not a hardcoded list, so a later task's new
// assets under src/integrations/claude/ install automatically with no
// change to this module.
function listMarkdownAssets(dir: string, base: string = dir): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listMarkdownAssets(full, base));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(relative(base, full));
    }
  }
  return files.sort();
}

// The full set of asset relative paths (e.g. "protocol-driver.md",
// "commands/milestone-add.md") currently shipped with this pitway install.
export function listClaudeAssets(): string[] {
  return listMarkdownAssets(assetsSourceDir);
}

// Repo-relative destination paths for every currently shipped asset (e.g.
// ".claude/protocol-driver.md", ".claude/commands/milestone-add.md") -- the
// single authoritative source for what "a managed Claude asset path" means.
// Reused wherever that needs to be known (baseline git-safety in
// src/core/milestones/confirm.ts) so no caller ever hardcodes or duplicates
// this list; a later task's new assets are covered automatically because
// this derives from listClaudeAssets(), not a separate manifest.
export function listClaudeAssetDestinations(): string[] {
  return listClaudeAssets().map((asset) => `.claude/${asset}`);
}

export type ClaudeAssetsProbe = 'ok' | 'missing' | 'invalid';

// Probes the target repo's .claude/ directory against the currently shipped
// asset set, generalizing init's existing config.yaml/state.yaml two-file
// probe (each independently missing/ok/invalid, combined into one verdict)
// from a fixed pair to a dynamic asset list:
//   - every asset present  -> 'ok'      (already installed; no-op)
//   - every asset absent   -> 'missing' (fresh install)
//   - any other mix        -> 'invalid' (partial/inconsistent; refuse)
//
// Only the pitway-managed asset paths are inspected. .claude/ is shared
// space -- a developer's own Claude Code configuration (settings.json,
// skills/, unrelated commands) may already live there and is never
// touched or considered by this probe.
export function probeClaudeAssets(root: string): ClaudeAssetsProbe {
  const assets = listClaudeAssets();
  const claudeDir = join(root, '.claude');
  const present = assets.filter((asset) => {
    const path = join(claudeDir, asset);
    return existsSync(path) && statSync(path).isFile();
  });
  if (present.length === 0) return 'missing';
  if (present.length === assets.length) return 'ok';
  return 'invalid';
}

// Installs every currently shipped .md asset into <root>/.claude/,
// mirroring src/integrations/claude/'s relative layout exactly (e.g.
// commands/milestone-add.md -> .claude/commands/milestone-add.md). Callers
// are expected to have already refused on a non-'missing' probe result.
export function installClaudeAssets(root: string): string[] {
  const assets = listClaudeAssets();
  const claudeDir = join(root, '.claude');
  for (const asset of assets) {
    const destination = join(claudeDir, asset);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, readFileSync(join(assetsSourceDir, asset)));
  }
  return assets;
}
