import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// M023/T001/AC002: driver-then-common asset resolution. Text assets ship in
// two tiers: src/integrations/common/ holds every genuinely driver-agnostic
// asset (skills, protocol docs), and src/integrations/<driver>/ holds that
// driver's own driver-specific assets (its command docs) plus any override
// of a common asset at the same relative path. Resolution is a flat, static,
// two-tier lookup over a hardcoded driver list -- no dynamic driver
// discovery or registration, no manifest file, no template engine, no
// translation/compile step, no plugin or adapter framework.
export const DRIVERS = ['claude', 'opencode'] as const;
export type Driver = (typeof DRIVERS)[number];

// Both tiers live alongside this compiled module: src/integrations/ in the
// source tree, dist/integrations/ in the built package (the build's asset
// copy step mirrors the whole integrations tree).
const integrationsDir = fileURLToPath(new URL('../integrations/', import.meta.url));

export function commonAssetsDir(): string {
  return join(integrationsDir, 'common');
}

export function driverAssetsDir(driver: Driver): string {
  return join(integrationsDir, driver);
}

// Recursively lists every .md file under `dir`, returning paths relative to
// `base`, sorted. Glob-based discovery, not a hardcoded list, so a later
// task's new assets install automatically with no change to this module.
// A missing directory is treated as empty -- the hardcoded driver list may
// name a driver whose directory does not exist yet (no overrides at all).
function listMarkdownAssets(dir: string, base: string = dir): string[] {
  if (!existsSync(dir)) return [];
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

// Directory-parameterized core, exported so tests can prove the collision
// rule against fixture directories; production callers use the default
// packaged locations via the driver-facing wrappers below.
export function resolveAssetsFromDirs(driverDir: string, commonDir: string): string[] {
  return [...new Set([...listMarkdownAssets(driverDir), ...listMarkdownAssets(commonDir)])].sort();
}

export function resolveAssetSourceFromDirs(
  driverDir: string,
  commonDir: string,
  asset: string,
): string {
  // Driver wins on any relative-path collision; common is the fallback.
  const override = join(driverDir, asset);
  if (existsSync(override)) return override;
  const fallback = join(commonDir, asset);
  if (existsSync(fallback)) return fallback;
  throw new Error(`unknown asset: ${asset} (neither ${driverDir} nor ${commonDir} ships it)`);
}

// The resolved asset set for one driver: driver overrides/driver-specific
// files union common fallbacks, as relative paths (e.g. "protocol-driver.md",
// "commands/milestone-add.md").
export function resolveDriverAssets(driver: Driver): string[] {
  return resolveAssetsFromDirs(driverAssetsDir(driver), commonAssetsDir());
}

// Absolute source path for one resolved asset of one driver.
export function resolveDriverAssetSource(driver: Driver, asset: string): string {
  return resolveAssetSourceFromDirs(driverAssetsDir(driver), commonAssetsDir(), asset);
}
