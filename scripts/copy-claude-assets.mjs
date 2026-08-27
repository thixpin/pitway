#!/usr/bin/env node
// Copies every file under src/integrations/ to dist/integrations/, preserving
// relative layout. `tsc` only emits compiled .ts sources -- it does not copy
// the Markdown assets that ship alongside them -- so this script runs as the
// second half of the `build` script (see package.json). It discovers files
// recursively at run time (mirroring src/state/driver-assets.ts's own
// listMarkdownAssets walk) rather than hard-coding a file count, tier list,
// or driver list, so a new asset -- or a driver directory that appears or
// disappears (M038/T001: only claude/ and common/ ship today) -- is handled
// automatically with no change here.
import { existsSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
// M023/T001: copies the whole integrations tree (common/, claude/, and any
// future driver override directory) -- dist/state/driver-assets.js resolves
// assets from dist/integrations/<driver>/ and dist/integrations/common/, so
// both tiers must ship. Note: this copy never removes stale files already
// under dist/integrations/ (dist/ is gitignored and rebuilt from scratch on
// publish).
const sourceDir = join(repoRoot, 'src', 'integrations');
const destDir = join(repoRoot, 'dist', 'integrations');

function copyRecursive(srcDir, destDirPath) {
  const entries = readdirSync(srcDir, { withFileTypes: true });
  mkdirSync(destDirPath, { recursive: true });
  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDirPath, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      copyFileSync(srcPath, destPath);
    }
  }
}

if (!existsSync(sourceDir)) {
  throw new Error(`copy-claude-assets: source directory not found: ${sourceDir}`);
}

copyRecursive(sourceDir, destDir);
