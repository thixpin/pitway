import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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

export interface ClaudeAssetClassification {
  asset: string;
  status: 'absent' | 'identical' | 'conflict';
}

// Classifies every currently shipped asset against <root>/.claude/<asset>:
// the one and only place in the codebase that compares installed .claude/
// asset bytes. 'absent' when the destination file does not exist yet;
// 'identical' when it exists and its bytes exactly equal the shipped
// source (a real content comparison, never mtime/size); 'conflict' when it
// exists with different bytes.
//
// Only the pitway-managed asset paths are inspected. .claude/ is shared
// space -- a developer's own Claude Code configuration (settings.json,
// skills/, unrelated commands) may already live there and is never
// touched or considered by this classification.
export function classifyClaudeAssets(root: string): ClaudeAssetClassification[] {
  const claudeDir = join(root, '.claude');
  return listClaudeAssets().map((asset) => {
    const destination = join(claudeDir, asset);
    if (!existsSync(destination)) {
      return { asset, status: 'absent' };
    }
    const shipped = readFileSync(join(assetsSourceDir, asset));
    const installed = readFileSync(destination);
    return { asset, status: shipped.equals(installed) ? 'identical' : 'conflict' };
  });
}

// Installs the given subset of currently shipped .md assets into
// <root>/.claude/, mirroring src/integrations/claude/'s relative layout
// exactly (e.g. commands/milestone-add.md -> .claude/commands/milestone-add.md).
// Defaults to the full shipped set for backward-compatible callers; init.ts
// passes exactly the classified-'absent' subset so an 'identical' asset is
// never rewritten.
export function installClaudeAssets(root: string, assets: string[] = listClaudeAssets()): string[] {
  const claudeDir = join(root, '.claude');
  for (const asset of assets) {
    const destination = join(claudeDir, asset);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, readFileSync(join(assetsSourceDir, asset)));
  }
  return assets;
}

// AC003/T003: the one and only place in the codebase that reads
// .claude/skills/ from disk for the pre-dispatch context gate. Every
// immediate subdirectory name under <root>/.claude/skills/ that itself
// contains a SKILL.md file, sorted; a directory present without its own
// SKILL.md is never listed. Empty array when .claude/skills/ does not
// exist at all.
export function listInstalledSkillNames(root: string): string[] {
  const skillsDir = join(root, '.claude', 'skills');
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(skillsDir, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
}
