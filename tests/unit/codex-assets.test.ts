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

// M023/T002 (AC005, AC006, AC007): the Codex driver's resolution,
// command-doc convention, destinations, and installed-asset classification --
// mirroring tests/unit/claude-assets.test.ts's style for the claude driver.

const codexDir = fileURLToPath(new URL('../../src/integrations/codex/', import.meta.url));
const claudeDir = fileURLToPath(new URL('../../src/integrations/claude/', import.meta.url));
const commonDir = fileURLToPath(new URL('../../src/integrations/common/', import.meta.url));

let root: string;

function shippedContent(asset: string): Buffer {
  return readFileSync(resolveDriverAssetSource('codex', asset));
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
  const destination = join(root, '.codex', asset);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content);
}

// Splits an Codex command doc into its parsed YAML frontmatter and body.
// Codex docs must be strict-YAML parseable (their descriptions carry a
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
  root = mkdtempSync(join(tmpdir(), 'pitway-codex-assets-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

// AC005: Codex ships exactly one command doc per Claude Code command doc
// (the expected set derived from glob discovery of claude/commands/, never a
// hardcoded count), in Codex's own verified convention -- one markdown
// file per command under commands/, frontmatter carrying only `description`
// (always quoted; `argument-hint` is a Claude Code field, not an Codex
// one), body mirroring the Claude source doc's own body verbatim.
describe('Codex command docs mirror the Claude Code command set (AC005)', () => {
  const claudeCommandDocs = listMarkdownFiles(join(claudeDir, 'commands'));

  it('ships exactly one commands/<name>.md per Claude Code command doc, including the ms-* aliases', () => {
    expect(claudeCommandDocs.length).toBeGreaterThan(0);
    expect(listMarkdownFiles(join(codexDir, 'commands'))).toEqual(claudeCommandDocs);
  });

  it.each(claudeCommandDocs.map((doc) => [doc]))(
    'commands/%s re-wraps its Claude source: parseable quoted-description-only frontmatter, body verbatim',
    (doc) => {
      const codex = readFileSync(join(codexDir, 'commands', doc), 'utf8');
      const claude = readFileSync(join(claudeDir, 'commands', doc), 'utf8');
      const parsed = splitFrontmatter(codex);
      const claudeParsed = splitClaudeSource(claude);
      // Codex's verified frontmatter convention: `description` only --
      // strict-YAML parseable (the descriptions contain a second colon, so
      // they must be quoted), no argument-hint.
      expect(Object.keys(parsed.frontmatter)).toEqual(['description']);
      expect(codex).toMatch(/^---\ndescription: "/);
      expect(parsed.frontmatter['description']).toBe(claudeParsed.description);
      expect(String(parsed.frontmatter['description']).startsWith('PitWay: ')).toBe(true);
      // The body -- the pitway-invocation instruction -- mirrors the Claude
      // source doc's own body byte-for-byte.
      expect(parsed.body).toBe(claudeParsed.body);
    },
  );

  it('each ms-*.md alias stays byte-parallel to its canonical codex counterpart', () => {
    const aliases = claudeCommandDocs.filter((doc) => doc.startsWith('ms-'));
    expect(aliases.length).toBe(8);
    for (const alias of aliases) {
      const canonical = alias.replace('ms-', 'milestone-');
      expect(readFileSync(join(codexDir, 'commands', alias))).toEqual(
        readFileSync(join(codexDir, 'commands', canonical)),
      );
    }
  });
});

// AC005: skills and protocol docs are NOT overridden for Codex -- they
// resolve to common/ entirely. The driver directory holds command docs and
// nothing else.
describe('Codex resolution: commands from codex/, everything else from common/ (AC005)', () => {
  it('src/integrations/codex/ contains only commands/*.md -- no skill or protocol-doc overrides', () => {
    const driverFiles = listMarkdownFiles(codexDir);
    expect(driverFiles.length).toBeGreaterThan(0);
    expect(driverFiles.every((f) => /^commands\/[^/]+\.md$/.test(f))).toBe(true);
  });

  it('the resolved codex set is the codex/ command docs union the common/ fallbacks', () => {
    const union = [
      ...new Set([...listMarkdownFiles(codexDir), ...listMarkdownFiles(commonDir)]),
    ].sort();
    expect(resolveDriverAssets('codex')).toEqual(union);
  });

  it('every skill and protocol doc resolves to its common/ source; every command doc to codex/', () => {
    for (const asset of resolveDriverAssets('codex')) {
      const source = resolveDriverAssetSource('codex', asset);
      if (asset.startsWith('commands/')) {
        expect(source).toBe(join(codexDir, asset));
      } else {
        expect(source).toBe(join(commonDir, asset));
      }
    }
  });
});

// AC006: the destination layout -- .codex/<relativePath>, exactly like
// claude's .claude/<relativePath>: skills at .codex/skills/<name>/SKILL.md,
// commands at .codex/commands/<name>.md, the 7 protocol docs root-level at
// .codex/<name>.md. Installing both drivers into one repo can never
// collide on a destination path.
describe('Codex destination paths (AC006)', () => {
  it('maps every resolved asset to .codex/<relativePath>', () => {
    expect(listDriverAssetDestinations('codex')).toEqual(
      resolveDriverAssets('codex').map((asset) => `.codex/${asset}`),
    );
  });

  it('places skills, commands, and the root-level protocol docs at their AC006-specified destinations', () => {
    const destinations = listDriverAssetDestinations('codex');
    expect(destinations).toContain('.codex/skills/debugging/SKILL.md');
    expect(destinations).toContain('.codex/commands/milestone-status.md');
    for (const doc of [
      'protocol-driver.md',
      'protocol-worker.md',
      'dispatch.md',
      'coordination.md',
      'report-format.md',
      'lsp-guidance.md',
      'interactive-ux.md',
    ]) {
      expect(destinations).toContain(`.codex/${doc}`);
    }
  });

  it('never collides with a claude destination path', () => {
    const codex = new Set(listDriverAssetDestinations('codex'));
    for (const destination of listDriverAssetDestinations('claude')) {
      expect(codex.has(destination)).toBe(false);
    }
  });
});

// AC007: classification of installed .codex/ assets against a real temp
// directory tree -- absent/identical/conflict, each asset independently,
// mirroring claude-assets.test.ts's classifyClaudeAssets coverage.
describe('classifyDriverAssets(root, "codex")', () => {
  it('classifies every asset absent when .codex/ does not exist at all', () => {
    const result = classifyDriverAssets(root, 'codex');
    expect(result.length).toBe(resolveDriverAssets('codex').length);
    expect(result.every((c) => c.status === 'absent')).toBe(true);
  });

  it('classifies a byte-identical installed asset as identical', () => {
    const [asset] = resolveDriverAssets('codex');
    writeDestination(root, asset!, shippedContent(asset!));
    const result = classifyDriverAssets(root, 'codex');
    expect(result.find((c) => c.asset === asset)?.status).toBe('identical');
  });

  it('classifies a byte-different installed asset as conflict', () => {
    const [asset] = resolveDriverAssets('codex');
    writeDestination(root, asset!, 'not the real shipped content\n');
    const result = classifyDriverAssets(root, 'codex');
    expect(result.find((c) => c.asset === asset)?.status).toBe('conflict');
  });

  it('classifies each asset independently in a mixed installed state', () => {
    const assets = resolveDriverAssets('codex');
    expect(assets.length).toBeGreaterThan(2);
    const [identicalAsset, conflictAsset] = assets;
    writeDestination(root, identicalAsset!, shippedContent(identicalAsset!));
    writeDestination(root, conflictAsset!, 'different content\n');

    const result = classifyDriverAssets(root, 'codex');
    expect(result.find((c) => c.asset === identicalAsset)?.status).toBe('identical');
    expect(result.find((c) => c.asset === conflictAsset)?.status).toBe('conflict');
    const rest = result.filter((c) => c.asset !== identicalAsset && c.asset !== conflictAsset);
    expect(rest.every((c) => c.status === 'absent')).toBe(true);
  });
});

// M025/T010 (AC012/B017 governance): automatic non-blocking issue capture rule in protocol-worker.md (codex driver resolves to common/)
describe('M025 T010 codex protocol-worker non-blocking issue capture rule (AC012)', () => {
  it('protocol-worker.md instructs agents to surface unrelated non-blocking findings immediately via the existing PitWay workflow/host mechanism', () => {
    const text = shippedContent('protocol-worker.md').toString('utf8');
    expect(text).toMatch(/unrelated, non-blocking/);
    expect(text).toMatch(/existing PitWay workflow\/host mechanism/);
    expect(text).toMatch(/pitway backlog add/);
    expect(text).toMatch(/surface/i);
    expect(text).toMatch(/naming the discovering task/);
  });

  it('protocol-worker.md separates reporting (agent) from capture (driver/host) and forbids direct .pitway edits / mandatory CLI invocation', () => {
    const text = shippedContent('protocol-worker.md').toString('utf8');
    expect(text).toMatch(/reporting is the agent.*capture belongs to the driver\/host/i);
    expect(text).toMatch(/never edit.*\.pitway\//i);
    expect(text).toMatch(/never.*required to invoke.*pitway/i);
  });

  it('protocol-worker.md keeps blocking/task-related issues on the normal escalation/scope rules', () => {
    const text = shippedContent('protocol-worker.md').toString('utf8');
    expect(text).toMatch(/Blocking or task-related issues keep following the normal escalation\/scope rules/);
    expect(text).toMatch(/task-amend/);
    expect(text).toMatch(/contract amendment/);
    expect(text).toMatch(/developer approval/);
  });
});

// M025/T003 (B014): every covered codex command doc carries a usage block (```sh + pitway), backlog documents --milestone/--task
describe('M025 T003 codex command docs carry usage blocks (B014)', () => {
  const COVERED_COMMAND_DOCS = [
    'commands/auto-run.md',
    'commands/backlog.md',
    'commands/milestone-add.md',
    'commands/milestone-cancel.md',
    'commands/milestone-complete.md',
    'commands/milestone-confirm.md',
    'commands/milestone-list.md',
    'commands/milestone-merge.md',
    'commands/milestone-review.md',
    'commands/ms-add.md',
    'commands/ms-cancel.md',
    'commands/ms-complete.md',
    'commands/ms-confirm.md',
    'commands/ms-list.md',
    'commands/ms-merge.md',
    'commands/ms-review.md',
    'commands/quick-change.md',
    'commands/resume.md',
    'commands/task-add.md',
    'commands/task-amend.md',
    'commands/task-discard.md',
    'commands/task-dispatch.md',
    'commands/task-integrate.md',
    'commands/task-status.md',
    'commands/task-update.md',
    'commands/task-verify.md',
    'commands/usage-add.md',
    'commands/verification-repair.md',
    'commands/verify.md',
    'commands/write-ms-artifacts.md',
  ];

  it.each(COVERED_COMMAND_DOCS.map((doc) => [doc]))(
    '%s contains a usage block with ```sh and pitway',
    (doc) => {
      const text = shippedContent(doc).toString('utf8');
      expect(text).toMatch(/```sh/);
      expect(text).toMatch(/pitway/);
    },
  );

  it('backlog.md usage block documents --milestone and --task filters', () => {
    const text = shippedContent('commands/backlog.md').toString('utf8');
    expect(text).toMatch(/--milestone/);
    expect(text).toMatch(/--task/);
    expect(text).toMatch(/backlog list.*--milestone.*--task/s);
  });
});

// M025/T004 (AC004/B011): common protocol-driver verbatim relay + footer habit rule (shared asset, pinned via codex resolution as well)
describe('M025 T004 common protocol-driver verbatim relay + footer habit (AC004/B011) via codex', () => {
  it('protocol-driver.md mandates verbatim table+footer relay and the routine-update footer closing line', () => {
    const text = shippedContent('protocol-driver.md').toString('utf8');
    expect(text).toContain('reproduce the rendered table and racing footer as-is');
    expect(text).toContain('annotations may surround');
    expect(text).toContain('never prose summaries');
    expect(text).toContain('end routine progress updates with the footer');
  });
});

// M025/T005 (AC005/B013,B015): codex milestone-status/ms-status --report passthrough + footer relay (B014 usage blocks owned here as well)
describe('M025 T005 codex milestone-status --report + footer relay (AC005/B013,B015)', () => {
  it('codex milestone-status.md carries the relay rule and a usage block with --report passthrough', () => {
    const text = shippedContent('commands/milestone-status.md').toString('utf8');
    expect(text).toContain('reproduce the rendered table and racing footer as-is');
    expect(text).toContain('annotations may surround');
    expect(text).toContain('never prose summaries');
    expect(text).toContain('end routine progress updates with the footer');
    expect(text).toMatch(/```sh/);
    expect(text).toMatch(/pitway milestone-status <id> \[--report\] \[--json\]/);
    expect(text).toMatch(/--report/);
    expect(text).toMatch(/--json/);
  });

  it('codex ms-status.md carries the relay rule and a usage block with --report and stays byte-identical to milestone-status.md', () => {
    const text = shippedContent('commands/ms-status.md').toString('utf8');
    expect(text).toContain('reproduce the rendered table and racing footer as-is');
    expect(text).toContain('annotations may surround');
    expect(text).toContain('never prose summaries');
    expect(text).toContain('end routine progress updates with the footer');
    expect(text).toMatch(/```sh/);
    expect(text).toMatch(/pitway milestone-status <id> \[--report\] \[--json\]/);
    expect(text).toMatch(/--report/);
    expect(text).toMatch(/--json/);
    expect(shippedContent('commands/ms-status.md')).toEqual(shippedContent('commands/milestone-status.md'));
  });
});
