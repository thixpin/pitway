import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCli } from '../../src/cli/index.js';
import { registerInitCommand } from '../../src/cli/commands/init.js';
import {
  DRIVERS,
  driverDestinationDir,
  listDriverAssetDestinations,
  resolveDriverAssetSource,
  resolveDriverAssets,
} from '../../src/state/driver-assets.js';

// M023/T003 (AC008): structural verification of the two-tier driver asset
// layer, for BOTH drivers together. Expectations are re-derived from disk by
// this file's own recursive glob (listFilesRecursive below) -- never from the
// module under test's own listing, and never from a hardcoded count -- so the
// resolution tests cannot be tautological and a newly added asset is covered
// automatically.

// Independent source-tree discovery roots (mirrors init.test.ts's pattern).
const commonDir = new URL('../../src/integrations/common/', import.meta.url).pathname;
function sourceDriverDir(driver: string): string {
  return new URL(`../../src/integrations/${driver}/`, import.meta.url).pathname;
}

// Recursively lists every file under `dir`, relative to `dir`, sorted.
function listFilesRecursive(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(full).map((f) => join(entry.name, f)));
    } else {
      files.push(entry.name);
    }
  }
  return files.sort();
}

// The stray-override guard (pre-confirm architect review): a file in a driver
// directory is legitimate only if it either SHADOWS an existing common/
// relative path or belongs to that driver's declared driver-specific class --
// commands/*.md (which includes the ms-*.md aliases). Anything else (e.g. a
// typo'd override filename) would silently install as a NEW asset instead of
// shadowing its common counterpart, so it is returned here by name and fails
// the tests below.
const DRIVER_SPECIFIC_CLASS = /^commands\/[^/]+\.md$/;
function findStrayOverrides(driverFiles: string[], commonFiles: string[]): string[] {
  const common = new Set(commonFiles);
  return driverFiles.filter(
    (file) => !common.has(file) && !DRIVER_SPECIFIC_CLASS.test(file),
  );
}

describe('multi-driver source resolution (AC008)', () => {
  it('resolves every logical asset to the correct source tier for both drivers', () => {
    const commonFiles = listFilesRecursive(commonDir);
    expect(commonFiles.length).toBeGreaterThan(0);
    for (const driver of DRIVERS) {
      const driverDir = sourceDriverDir(driver);
      const driverFiles = listFilesRecursive(driverDir);
      expect(driverFiles.length).toBeGreaterThan(0);

      // The resolved logical set is exactly the union of the two tiers,
      // re-derived from disk here, independent of the module's own glob.
      const expectedUnion = [...new Set([...driverFiles, ...commonFiles])].sort();
      expect(resolveDriverAssets(driver)).toEqual(expectedUnion);

      // Per asset: driver wins when it ships the relative path, common is
      // the fallback otherwise.
      const driverSet = new Set(driverFiles);
      for (const asset of expectedUnion) {
        const source = resolveDriverAssetSource(driver, asset);
        const expectedRoot = driverSet.has(asset) ? driverDir : commonDir;
        expect(source).toBe(join(expectedRoot, asset));
        expect(existsSync(source)).toBe(true);
      }
    }
  });

  it('command docs come from each driver\'s own directory; skills and protocol docs from common/, for both drivers', () => {
    const commonFiles = listFilesRecursive(commonDir);
    // No command doc lives in the common tier -- commands are inherently
    // driver-specific (each driver's own frontmatter convention).
    expect(commonFiles.some((f) => f.startsWith('commands/'))).toBe(false);

    for (const driver of DRIVERS) {
      const driverDir = sourceDriverDir(driver);
      for (const asset of resolveDriverAssets(driver)) {
        const source = resolveDriverAssetSource(driver, asset);
        if (asset.startsWith('commands/')) {
          // Claude command docs from claude/, OpenCode command docs from
          // opencode/ -- never cross-driver, never common.
          expect(source).toBe(join(driverDir, asset));
        } else {
          // Skills (skills/**, including NOTICE.md) and the root-level
          // protocol docs resolve to common/ for BOTH drivers (AC005: no
          // skill/protocol overrides shipped).
          expect(source).toBe(join(commonDir, asset));
        }
      }
    }
  });

  it('both drivers ship the same command-doc set, derived by glob, never a hardcoded count', () => {
    const [claudeCommands, opencodeCommands] = DRIVERS.map((driver) =>
      listFilesRecursive(sourceDriverDir(driver)).filter((f) => f.startsWith('commands/')),
    );
    expect(claudeCommands!.length).toBeGreaterThan(0);
    // AC005: the OpenCode command set mirrors Claude Code's command docs
    // one-for-one (same relative filenames, including the ms-*.md aliases).
    expect(opencodeCommands).toEqual(claudeCommands);
    expect(claudeCommands!.some((f) => /^commands\/ms-[^/]+\.md$/.test(f))).toBe(true);
  });
});

describe('multi-driver destination mapping (AC006, AC008)', () => {
  it('maps every logical asset to the correct per-driver destination', () => {
    expect(driverDestinationDir('claude')).toBe('.claude');
    expect(driverDestinationDir('opencode')).toBe('.opencode');
    for (const driver of DRIVERS) {
      const destDir = driverDestinationDir(driver);
      // Destination layout mirrors the resolved relative layout exactly:
      // skills at <dir>/skills/..., commands at <dir>/commands/<name>.md,
      // protocol docs at <dir>/<name>.md (root-level).
      expect(listDriverAssetDestinations(driver)).toEqual(
        resolveDriverAssets(driver).map((asset) => `${destDir}/${asset}`),
      );
    }
  });

  it('the two drivers\' destination sets have zero path collisions', () => {
    const all = DRIVERS.flatMap((driver) => listDriverAssetDestinations(driver));
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('installing both drivers into one real repo (AC008)', () => {
  let root: string;

  function git(args: string[], cwd: string): void {
    execFileSync('git', args, { cwd, stdio: 'pipe' });
  }

  async function runInit(cwd: string, extraArgs: string[] = []): Promise<{ error?: Error }> {
    const program = buildCli();
    registerInitCommand(program, { root: cwd, write: () => {} });
    try {
      await program.parseAsync(['node', 'pitway', 'init', ...extraArgs]);
      return {};
    } catch (error) {
      return { error: error as Error };
    }
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pitway-multidriver-'));
    git(['init', '-q'], root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('a real pitway init --opencode installs both trees, byte-identical to their resolved sources, with no collision', async () => {
    const { error } = await runInit(root, ['--opencode']);
    expect(error).toBeUndefined();

    const installedByDriver = new Map<string, string[]>();
    for (const driver of DRIVERS) {
      const destDir = join(root, driverDestinationDir(driver));
      const resolved = resolveDriverAssets(driver);
      const installed = listFilesRecursive(destDir);
      // Every resolved asset installed, mirroring the source layout exactly.
      expect(installed).toEqual(resolved.slice().sort());
      // Byte parity: each installed file exactly equals its resolved source.
      for (const asset of resolved) {
        expect(readFileSync(join(destDir, asset), 'utf8')).toBe(
          readFileSync(resolveDriverAssetSource(driver, asset), 'utf8'),
        );
      }
      installedByDriver.set(driver, installed.map((f) => `${driverDestinationDir(driver)}/${f}`));
    }

    // Zero destination-path collisions across the two installed trees.
    const allInstalled = [...installedByDriver.values()].flat();
    expect(new Set(allInstalled).size).toBe(allInstalled.length);
  });
});

describe('stray-override guard (AC008, pre-confirm architect review)', () => {
  it('every real driver-directory file either shadows common/ or is a declared driver-specific command doc', () => {
    const commonFiles = listFilesRecursive(commonDir);
    for (const driver of DRIVERS) {
      const driverFiles = listFilesRecursive(sourceDriverDir(driver));
      // Any offender appears here BY NAME -- an empty-array equality means a
      // failure output lists exactly the offending file paths per driver.
      expect(findStrayOverrides(driverFiles, commonFiles)).toEqual([]);
    }
  });

  it('fails by name on a typo\'d override filename that would silently install as a new asset (fixture)', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'pitway-stray-fixture-'));
    try {
      const fixtureCommon = join(fixture, 'common');
      const fixtureDriver = join(fixture, 'driver');
      mkdirSync(fixtureCommon, { recursive: true });
      mkdirSync(join(fixtureDriver, 'commands'), { recursive: true });
      writeFileSync(join(fixtureCommon, 'protocol-driver.md'), 'common protocol doc\n');
      // Legitimate: a real shadow of an existing common/ relative path.
      writeFileSync(join(fixtureDriver, 'protocol-driver.md'), 'driver override\n');
      // Legitimate: driver-specific class, including the ms-*.md aliases.
      writeFileSync(join(fixtureDriver, 'commands', 'ms-add.md'), 'command doc\n');
      // Stray: a typo'd override filename ("protcol") shadows nothing and is
      // not a command doc -- it would install as a NEW asset. Must be caught.
      writeFileSync(join(fixtureDriver, 'protcol-driver.md'), 'typo\n');

      expect(
        findStrayOverrides(listFilesRecursive(fixtureDriver), listFilesRecursive(fixtureCommon)),
      ).toEqual(['protcol-driver.md']);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
