import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveDriverAssets, resolveDriverAssetSource } from './driver-assets.js';

// M023/T001: the Claude Code asset surface. The shipped sources now live in
// two tiers -- src/integrations/common/ (driver-agnostic skills and protocol
// docs) and src/integrations/claude/ (Claude Code's own command docs, plus
// any override of a common asset) -- resolved by src/state/driver-assets.ts's
// driver-then-common fallback. Every exported function here keeps its
// pre-M023 name and signature; the installed .claude/ output stays
// byte-for-byte identical. Assets install verbatim, never generated or
// transformed.

// The full set of asset relative paths (e.g. "protocol-driver.md",
// "commands/milestone-add.md") currently shipped with this pitway install.
export function listClaudeAssets(): string[] {
  return resolveDriverAssets('claude');
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
    const shipped = readFileSync(resolveDriverAssetSource('claude', asset));
    const installed = readFileSync(destination);
    return { asset, status: shipped.equals(installed) ? 'identical' : 'conflict' };
  });
}

// Installs the given subset of currently shipped .md assets into
// <root>/.claude/, mirroring the resolved source set's relative layout
// exactly (e.g. commands/milestone-add.md -> .claude/commands/milestone-add.md).
// Defaults to the full shipped set for backward-compatible callers; init.ts
// passes exactly the classified-'absent' subset so an 'identical' asset is
// never rewritten.
export function installClaudeAssets(root: string, assets: string[] = listClaudeAssets()): string[] {
  const claudeDir = join(root, '.claude');
  for (const asset of assets) {
    const destination = join(claudeDir, asset);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, readFileSync(resolveDriverAssetSource('claude', asset)));
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
