import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classifyClaudeAssets, listClaudeAssets } from '../../src/state/claude-assets.js';

let root: string;

function shippedContent(asset: string): Buffer {
  return readFileSync(new URL(`../../src/integrations/claude/${asset}`, import.meta.url));
}

function writeDestination(root: string, asset: string, content: string | Buffer): void {
  const destination = join(root, '.claude', asset);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pitway-claude-assets-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

// T002: focused unit tests for classifyClaudeAssets against a real temp
// directory tree -- not a full pitway init -- covering absent/identical/
// conflict for a representative asset, plus a mixed case proving each
// asset is classified independently.
describe('classifyClaudeAssets', () => {
  it('classifies every asset absent when .claude/ does not exist at all', () => {
    const result = classifyClaudeAssets(root);
    expect(result.length).toBe(listClaudeAssets().length);
    expect(result.every((c) => c.status === 'absent')).toBe(true);
  });

  it('classifies a byte-identical installed asset as identical', () => {
    const [asset] = listClaudeAssets();
    writeDestination(root, asset!, shippedContent(asset!));
    const result = classifyClaudeAssets(root);
    expect(result.find((c) => c.asset === asset)?.status).toBe('identical');
  });

  it('classifies a byte-different installed asset as conflict', () => {
    const [asset] = listClaudeAssets();
    writeDestination(root, asset!, 'not the real shipped content\n');
    const result = classifyClaudeAssets(root);
    expect(result.find((c) => c.asset === asset)?.status).toBe('conflict');
  });

  it('classifies each asset independently in a mixed installed state', () => {
    const assets = listClaudeAssets();
    expect(assets.length).toBeGreaterThan(2);
    const [identicalAsset, conflictAsset] = assets;
    writeDestination(root, identicalAsset!, shippedContent(identicalAsset!));
    writeDestination(root, conflictAsset!, 'different content\n');

    const result = classifyClaudeAssets(root);
    expect(result.find((c) => c.asset === identicalAsset)?.status).toBe('identical');
    expect(result.find((c) => c.asset === conflictAsset)?.status).toBe('conflict');
    const rest = result.filter((c) => c.asset !== identicalAsset && c.asset !== conflictAsset);
    expect(rest.every((c) => c.status === 'absent')).toBe(true);
  });

  it('is a real content comparison, not a size/mtime heuristic', () => {
    const [asset] = listClaudeAssets();
    const shipped = shippedContent(asset!);
    // Same length as the shipped content, different bytes -- a size-only
    // heuristic would wrongly call this identical.
    const sameLength = Buffer.alloc(shipped.length, 'x');
    writeDestination(root, asset!, sameLength);
    const result = classifyClaudeAssets(root);
    expect(result.find((c) => c.asset === asset)?.status).toBe('conflict');
  });
});
