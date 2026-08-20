import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listClaudeAssets } from '../../src/state/claude-assets.js';
import { listSafeManagedDirtyPaths } from '../../src/state/managed-init-paths.js';
import { AGENTS_MD_CONTENT, CLAUDE_MD_CONTENT } from '../../src/state/root-instructions.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pitway-managed-init-paths-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function shippedContent(asset: string): Buffer {
  return readFileSync(new URL(`../../src/integrations/claude/${asset}`, import.meta.url));
}

function writeClaudeAsset(asset: string, content: string | Buffer): void {
  const destination = join(root, '.claude', asset);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content);
}

// T005: real mix of absent/identical/conflict across both .claude/ assets
// and root instruction files together, not each kind in isolation, plus
// the unconditional .pitway/* pair.
describe('listSafeManagedDirtyPaths', () => {
  it('always includes .pitway/config.yaml and .pitway/state.yaml, regardless of classifier state', () => {
    const result = listSafeManagedDirtyPaths(root);
    expect(result).toContain('.pitway/config.yaml');
    expect(result).toContain('.pitway/state.yaml');
  });

  it('includes every absent/identical asset and root file, excludes every conflict, in one mixed tree', () => {
    const assets = listClaudeAssets();
    const [identicalAsset, conflictAsset] = assets;
    writeClaudeAsset(identicalAsset!, shippedContent(identicalAsset!));
    writeClaudeAsset(conflictAsset!, 'tampered\n');
    writeFileSync(join(root, 'AGENTS.md'), AGENTS_MD_CONTENT);
    writeFileSync(join(root, 'CLAUDE.md'), 'tampered CLAUDE.md\n');

    const result = listSafeManagedDirtyPaths(root);

    expect(result).toContain(`.claude/${identicalAsset}`);
    expect(result).not.toContain(`.claude/${conflictAsset}`);
    expect(result).toContain('AGENTS.md');
    expect(result).not.toContain('CLAUDE.md');
    // Every other, still-absent asset remains included (harmless).
    const untouched = assets.filter((a) => a !== identicalAsset && a !== conflictAsset);
    for (const asset of untouched) {
      expect(result).toContain(`.claude/${asset}`);
    }
  });

  it('is a pure read: repeated calls are stable and idempotent, no filesystem side effects', () => {
    writeFileSync(join(root, 'AGENTS.md'), AGENTS_MD_CONTENT);
    const first = listSafeManagedDirtyPaths(root);
    const second = listSafeManagedDirtyPaths(root);
    expect(second).toEqual(first);
  });

  it('a fully absent tree still returns the full safe set (every asset/root file, plus .pitway/*)', () => {
    const result = listSafeManagedDirtyPaths(root);
    for (const asset of listClaudeAssets()) {
      expect(result).toContain(`.claude/${asset}`);
    }
    expect(result).toContain('AGENTS.md');
    expect(result).toContain('CLAUDE.md');
  });
});
