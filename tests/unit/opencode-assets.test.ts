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
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  classifyDriverAssets,
  listDriverAssetDestinations,
  resolveDriverAssetSource,
  resolveDriverAssets,
} from '../../src/state/driver-assets.js';

// M023/T002 (AC005, AC006, AC007): the OpenCode driver's resolution,
// command-doc convention, destinations, and installed-asset classification --
// mirroring tests/unit/claude-assets.test.ts's style for the claude driver.

const opencodeDir = fileURLToPath(new URL('../../src/integrations/opencode/', import.meta.url));
const claudeDir = fileURLToPath(new URL('../../src/integrations/claude/', import.meta.url));
const commonDir = fileURLToPath(new URL('../../src/integrations/common/', import.meta.url));

let root: string;

function shippedContent(asset: string): Buffer {
  return readFileSync(resolveDriverAssetSource('opencode', asset));
}

// Independent recursive .md scan -- deliberately re-implemented here rather
// than delegating to the resolver under test.
function listMarkdownFiles(dir: string, base: string = dir): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listMarkdownFiles(full, base));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(relative(base, full));
    }
  }
  return files.sort();
}

function writeDestination(root: string, asset: string, content: string | Buffer): void {
  const destination = join(root, '.opencode', asset);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content);
}

// Splits an OpenCode command doc into its parsed YAML frontmatter and body.
// OpenCode docs must be strict-YAML parseable (their descriptions carry a
// second colon, so quoting is load-bearing).
function splitFrontmatter(text: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  expect(match).not.toBeNull();
  return { frontmatter: parse(match![1]!) as Record<string, unknown>, body: match![2]! };
}

// The Claude Code source docs use Claude Code's own lenient frontmatter
// convention (unquoted second colon), so their description and body are
// extracted textually, mirroring claude-assets.test.ts's own regex, never
// strict-YAML parsed.
function splitClaudeSource(text: string): { description: string; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  expect(match).not.toBeNull();
  const description = /^description:\s*"?(.*?)"?$/m.exec(match![1]!);
  expect(description).not.toBeNull();
  return { description: description![1]!, body: match![2]! };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pitway-opencode-assets-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

// AC005: OpenCode ships exactly one command doc per Claude Code command doc
// (the expected set derived from glob discovery of claude/commands/, never a
// hardcoded count), in OpenCode's own verified convention -- one markdown
// file per command under commands/, frontmatter carrying only `description`
// (always quoted; `argument-hint` is a Claude Code field, not an OpenCode
// one), body mirroring the Claude source doc's own body verbatim.
describe('OpenCode command docs mirror the Claude Code command set (AC005)', () => {
  const claudeCommandDocs = listMarkdownFiles(join(claudeDir, 'commands'));

  it('ships exactly one commands/<name>.md per Claude Code command doc, including the ms-* aliases', () => {
    expect(claudeCommandDocs.length).toBeGreaterThan(0);
    expect(listMarkdownFiles(join(opencodeDir, 'commands'))).toEqual(claudeCommandDocs);
  });

  it.each(claudeCommandDocs.map((doc) => [doc]))(
    'commands/%s re-wraps its Claude source: parseable quoted-description-only frontmatter, body verbatim',
    (doc) => {
      const opencode = readFileSync(join(opencodeDir, 'commands', doc), 'utf8');
      const claude = readFileSync(join(claudeDir, 'commands', doc), 'utf8');
      const parsed = splitFrontmatter(opencode);
      const claudeParsed = splitClaudeSource(claude);
      // OpenCode's verified frontmatter convention: `description` only --
      // strict-YAML parseable (the descriptions contain a second colon, so
      // they must be quoted), no argument-hint.
      expect(Object.keys(parsed.frontmatter)).toEqual(['description']);
      expect(opencode).toMatch(/^---\ndescription: "/);
      expect(parsed.frontmatter['description']).toBe(claudeParsed.description);
      expect(String(parsed.frontmatter['description']).startsWith('PitWay: ')).toBe(true);
      // The body -- the pitway-invocation instruction -- mirrors the Claude
      // source doc's own body byte-for-byte.
      expect(parsed.body).toBe(claudeParsed.body);
    },
  );

  it('each ms-*.md alias stays byte-parallel to its canonical opencode counterpart', () => {
    const aliases = claudeCommandDocs.filter((doc) => doc.startsWith('ms-'));
    expect(aliases.length).toBe(8);
    for (const alias of aliases) {
      const canonical = alias.replace('ms-', 'milestone-');
      expect(readFileSync(join(opencodeDir, 'commands', alias))).toEqual(
        readFileSync(join(opencodeDir, 'commands', canonical)),
      );
    }
  });
});

// AC005: skills and protocol docs are NOT overridden for OpenCode -- they
// resolve to common/ entirely. The driver directory holds command docs and
// nothing else.
describe('OpenCode resolution: commands from opencode/, everything else from common/ (AC005)', () => {
  it('src/integrations/opencode/ contains only commands/*.md -- no skill or protocol-doc overrides', () => {
    const driverFiles = listMarkdownFiles(opencodeDir);
    expect(driverFiles.length).toBeGreaterThan(0);
    expect(driverFiles.every((f) => /^commands\/[^/]+\.md$/.test(f))).toBe(true);
  });

  it('the resolved opencode set is the opencode/ command docs union the common/ fallbacks', () => {
    const union = [
      ...new Set([...listMarkdownFiles(opencodeDir), ...listMarkdownFiles(commonDir)]),
    ].sort();
    expect(resolveDriverAssets('opencode')).toEqual(union);
  });

  it('every skill and protocol doc resolves to its common/ source; every command doc to opencode/', () => {
    for (const asset of resolveDriverAssets('opencode')) {
      const source = resolveDriverAssetSource('opencode', asset);
      if (asset.startsWith('commands/')) {
        expect(source).toBe(join(opencodeDir, asset));
      } else {
        expect(source).toBe(join(commonDir, asset));
      }
    }
  });
});

// AC006: the destination layout -- .opencode/<relativePath>, exactly like
// claude's .claude/<relativePath>: skills at .opencode/skills/<name>/SKILL.md,
// commands at .opencode/commands/<name>.md, the 7 protocol docs root-level at
// .opencode/<name>.md. Installing both drivers into one repo can never
// collide on a destination path.
describe('OpenCode destination paths (AC006)', () => {
  it('maps every resolved asset to .opencode/<relativePath>', () => {
    expect(listDriverAssetDestinations('opencode')).toEqual(
      resolveDriverAssets('opencode').map((asset) => `.opencode/${asset}`),
    );
  });

  it('places skills, commands, and the root-level protocol docs at their AC006-specified destinations', () => {
    const destinations = listDriverAssetDestinations('opencode');
    expect(destinations).toContain('.opencode/skills/debugging/SKILL.md');
    expect(destinations).toContain('.opencode/commands/milestone-status.md');
    for (const doc of [
      'protocol-driver.md',
      'protocol-worker.md',
      'dispatch.md',
      'coordination.md',
      'report-format.md',
      'lsp-guidance.md',
      'interactive-ux.md',
    ]) {
      expect(destinations).toContain(`.opencode/${doc}`);
    }
  });

  it('never collides with a claude destination path', () => {
    const opencode = new Set(listDriverAssetDestinations('opencode'));
    for (const destination of listDriverAssetDestinations('claude')) {
      expect(opencode.has(destination)).toBe(false);
    }
  });
});

// AC007: classification of installed .opencode/ assets against a real temp
// directory tree -- absent/identical/conflict, each asset independently,
// mirroring claude-assets.test.ts's classifyClaudeAssets coverage.
describe('classifyDriverAssets(root, "opencode")', () => {
  it('classifies every asset absent when .opencode/ does not exist at all', () => {
    const result = classifyDriverAssets(root, 'opencode');
    expect(result.length).toBe(resolveDriverAssets('opencode').length);
    expect(result.every((c) => c.status === 'absent')).toBe(true);
  });

  it('classifies a byte-identical installed asset as identical', () => {
    const [asset] = resolveDriverAssets('opencode');
    writeDestination(root, asset!, shippedContent(asset!));
    const result = classifyDriverAssets(root, 'opencode');
    expect(result.find((c) => c.asset === asset)?.status).toBe('identical');
  });

  it('classifies a byte-different installed asset as conflict', () => {
    const [asset] = resolveDriverAssets('opencode');
    writeDestination(root, asset!, 'not the real shipped content\n');
    const result = classifyDriverAssets(root, 'opencode');
    expect(result.find((c) => c.asset === asset)?.status).toBe('conflict');
  });

  it('classifies each asset independently in a mixed installed state', () => {
    const assets = resolveDriverAssets('opencode');
    expect(assets.length).toBeGreaterThan(2);
    const [identicalAsset, conflictAsset] = assets;
    writeDestination(root, identicalAsset!, shippedContent(identicalAsset!));
    writeDestination(root, conflictAsset!, 'different content\n');

    const result = classifyDriverAssets(root, 'opencode');
    expect(result.find((c) => c.asset === identicalAsset)?.status).toBe('identical');
    expect(result.find((c) => c.asset === conflictAsset)?.status).toBe('conflict');
    const rest = result.filter((c) => c.asset !== identicalAsset && c.asset !== conflictAsset);
    expect(rest.every((c) => c.status === 'absent')).toBe(true);
  });
});
