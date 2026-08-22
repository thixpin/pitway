import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  classifyDriverAssets,
  installDriverAssets,
  listDriverAssetDestinations,
  resolveDriverAssets,
  type DriverAssetClassification,
} from './driver-assets.js';

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
  return listDriverAssetDestinations('claude');
}

export type ClaudeAssetClassification = DriverAssetClassification;

// Classifies every currently shipped asset against <root>/.claude/<asset>.
// M023/T002: the byte-comparison itself now lives once in driver-assets.ts's
// classifyDriverAssets, shared with the opencode driver; this wrapper keeps
// its pre-M023 name and signature.
export function classifyClaudeAssets(root: string): ClaudeAssetClassification[] {
  return classifyDriverAssets(root, 'claude');
}

// Installs the given subset of currently shipped .md assets into
// <root>/.claude/, mirroring the resolved source set's relative layout
// exactly (e.g. commands/milestone-add.md -> .claude/commands/milestone-add.md).
// Defaults to the full shipped set for backward-compatible callers; init.ts
// passes exactly the classified-'absent' subset so an 'identical' asset is
// never rewritten. Delegates to driver-assets.ts's shared installer.
export function installClaudeAssets(root: string, assets: string[] = listClaudeAssets()): string[] {
  return installDriverAssets(root, 'claude', assets);
}

// AC003/T003 + M025/T006 (B009): the one and only place in the codebase
// that reads installed skills from disk for the pre-dispatch context gate.
// Scans every installed driver skills directory that exists
// (.claude/skills and .opencode/skills), union, sorted, deduplicated,
// while keeping each directory's own SKILL.md-present rule: a directory
// present without its own SKILL.md is never listed. Absent driver dirs
// contribute nothing. Returns [] when neither exists.
export function listInstalledSkillNames(root: string): string[] {
  const skillDirs = [join(root, '.claude', 'skills'), join(root, '.opencode', 'skills')];
  const names = new Set<string>();
  for (const skillsDir of skillDirs) {
    if (!existsSync(skillsDir)) continue;
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(skillsDir, entry.name, 'SKILL.md'))) {
        names.add(entry.name);
      }
    }
  }
  return [...names].sort();
}
