#!/usr/bin/env node
// Copies every file under src/integrations/claude/ to dist/integrations/claude/,
// preserving relative layout. `tsc` only emits compiled .ts sources -- it does
// not copy the Markdown assets that ship alongside them -- so this script runs
// as the second half of the `build` script (see package.json). It discovers
// files recursively at run time (mirroring src/state/claude-assets.ts's own
// listMarkdownAssets walk) rather than hard-coding a file count or list, so a
// later task's new asset under src/integrations/claude/ is copied automatically
// with no change here.
import { existsSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const sourceDir = join(repoRoot, 'src', 'integrations', 'claude');
const destDir = join(repoRoot, 'dist', 'integrations', 'claude');

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
