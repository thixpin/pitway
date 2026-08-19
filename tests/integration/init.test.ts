import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { buildCli } from '../../src/cli/index.js';
import { registerInitCommand } from '../../src/cli/commands/init.js';
import { listClaudeAssets } from '../../src/state/claude-assets.js';

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

let root: string;

// Recursively lists every file under `dir`, relative to `dir`.
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

async function runInit(cwd: string, extraArgs: string[] = []): Promise<{ lines: string[]; error?: Error }> {
  const program = buildCli();
  const lines: string[] = [];
  registerInitCommand(program, { root: cwd, write: (s) => lines.push(s) });
  try {
    await program.parseAsync(['node', 'pitway', 'init', ...extraArgs]);
    return { lines };
  } catch (error) {
    return { lines, error: error as Error };
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pitway-init-'));
  git(['init', '-q'], root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('pitway init', () => {
  it('refuses outside a git work tree and creates nothing', async () => {
    const nonRepo = mkdtempSync(join(tmpdir(), 'pitway-init-nongit-'));
    try {
      const { error } = await runInit(nonRepo);
      expect(error?.message).toMatch(/git/i);
      expect(existsSync(join(nonRepo, '.pitway'))).toBe(false);
    } finally {
      rmSync(nonRepo, { recursive: true, force: true });
    }
  });

  it('creates exactly config.yaml and state.yaml in a clean repo', async () => {
    const { error } = await runInit(root);
    expect(error).toBeUndefined();
    const config = parse(readFileSync(join(root, '.pitway', 'config.yaml'), 'utf8'));
    const state = parse(readFileSync(join(root, '.pitway', 'state.yaml'), 'utf8'));
    expect(config).toEqual({ schema_version: 1 });
    expect(state).toEqual({ schema_version: 1, active_milestone: null, milestones: [] });
    const entries = execFileSync('ls', ['-A', join(root, '.pitway')]).toString().trim().split('\n');
    expect(entries.sort()).toEqual(['config.yaml', 'state.yaml']);
  });

  it('is a safe no-op when both files exist and validate', async () => {
    await runInit(root);
    writeFileSync(join(root, 'marker.txt'), 'x\n');
    const before = readFileSync(join(root, '.pitway', 'state.yaml'), 'utf8');
    const { error } = await runInit(root);
    expect(error).toBeUndefined();
    expect(readFileSync(join(root, '.pitway', 'state.yaml'), 'utf8')).toBe(before);
  });

  it('refuses partial state (config present, state missing) without overwriting', async () => {
    await runInit(root);
    rmSync(join(root, '.pitway', 'state.yaml'));
    const { error } = await runInit(root);
    expect(error?.message).toMatch(/inconsistent|partial/i);
    expect(existsSync(join(root, '.pitway', 'state.yaml'))).toBe(false);
  });

  it('refuses invalid existing state without overwriting', async () => {
    await runInit(root);
    writeFileSync(join(root, '.pitway', 'state.yaml'), 'schema_version: 99\n');
    const { error } = await runInit(root);
    expect(error?.message).toMatch(/inconsistent|invalid/i);
    expect(readFileSync(join(root, '.pitway', 'state.yaml'), 'utf8')).toBe('schema_version: 99\n');
  });
});

// AC003: init installs every .md file under src/integrations/claude/ via a
// glob (never a hardcoded list) into .claude/, default on, opt-out
// --no-claude, refusing a partial/inconsistent .claude/ state the same way
// it already refuses partial/inconsistent .pitway/ state.
describe('pitway init Claude Code asset installation (AC003)', () => {
  it('src/integrations/claude/ contains zero .ts files -- text assets and runtime code only', () => {
    const sourceRoot = new URL('../../src/integrations/claude/', import.meta.url);
    const files = listFilesRecursive(sourceRoot.pathname);
    expect(files.some((f) => f.endsWith('.ts'))).toBe(false);
    expect(files.every((f) => f.endsWith('.md'))).toBe(true);
    expect(files).toEqual(listClaudeAssets());
  });

  it('installs every shipped .md asset into .claude/, mirroring the source layout exactly', async () => {
    const { error } = await runInit(root);
    expect(error).toBeUndefined();
    const shipped = listClaudeAssets();
    expect(shipped.length).toBeGreaterThan(0);
    const installed = listFilesRecursive(join(root, '.claude'));
    expect(installed).toEqual(shipped.slice().sort());
    // Content is copied verbatim, not transformed.
    for (const asset of shipped) {
      expect(readFileSync(join(root, '.claude', asset), 'utf8')).toBe(
        readFileSync(
          new URL(`../../src/integrations/claude/${asset}`, import.meta.url),
          'utf8',
        ),
      );
    }
  });

  it('--no-claude skips installation entirely', async () => {
    const { error } = await runInit(root, ['--no-claude']);
    expect(error).toBeUndefined();
    expect(existsSync(join(root, '.claude'))).toBe(false);
    // .pitway/ state is unaffected by the opt-out.
    expect(existsSync(join(root, '.pitway', 'config.yaml'))).toBe(true);
  });

  it('is a safe no-op when .claude/ is already fully installed', async () => {
    await runInit(root);
    const first = listFilesRecursive(join(root, '.claude'));
    const mtimeBefore = statSync(join(root, '.claude', first[0]!)).mtimeMs;
    const { error } = await runInit(root);
    expect(error).toBeUndefined();
    expect(listFilesRecursive(join(root, '.claude'))).toEqual(first);
    expect(statSync(join(root, '.claude', first[0]!)).mtimeMs).toBe(mtimeBefore);
  });

  it('refuses a partial .claude/ state and writes nothing at all, including .pitway/', async () => {
    await runInit(root);
    const shipped = listClaudeAssets();
    // Simulate an interrupted/tampered install: remove exactly one managed
    // asset, leaving the rest present.
    rmSync(join(root, '.claude', shipped[0]!));
    rmSync(join(root, '.pitway'), { recursive: true, force: true });

    const { error } = await runInit(root);
    expect(error?.message).toMatch(/inconsistent|partial/i);
    expect(error?.message).toMatch(/\.claude/);
    // Nothing else got written either — the refusal is atomic.
    expect(existsSync(join(root, '.pitway'))).toBe(false);
    expect(existsSync(join(root, '.claude', shipped[0]!))).toBe(false);
  });

  // T005/AC010: the last asset-creating task in this milestone -- proves
  // init installs the COMPLETE current set of source .md files, including
  // auto-run.md and interactive-ux.md added by this very task, not merely
  // whatever subset existed when the installer/glob was first written.
  // Independently re-implements the recursive .md scan (via
  // listFilesRecursive, already used above against .claude/) directly
  // against the source tree, rather than delegating to listClaudeAssets()
  // -- so this doesn't just restate the installer's own idea of what's
  // shipped, it re-derives it from disk.
  it('installs the complete current asset set, including this task\'s own new files (AC010)', async () => {
    const sourceRoot = new URL('../../src/integrations/claude/', import.meta.url);
    const actualAssets = listFilesRecursive(sourceRoot.pathname);

    expect(actualAssets).toContain(join('commands', 'auto-run.md'));
    expect(actualAssets).toContain('interactive-ux.md');

    const { error } = await runInit(root);
    expect(error).toBeUndefined();
    const installed = listFilesRecursive(join(root, '.claude'));
    expect(installed).toEqual(actualAssets);
    for (const asset of actualAssets) {
      expect(readFileSync(join(root, '.claude', asset), 'utf8')).toBe(
        readFileSync(new URL(`../../src/integrations/claude/${asset}`, import.meta.url), 'utf8'),
      );
    }
  });

  it('never inspects or disturbs unrelated files already under .claude/', async () => {
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.claude', 'settings.json'), '{"unrelated": true}\n');
    const { error } = await runInit(root);
    expect(error).toBeUndefined();
    expect(readFileSync(join(root, '.claude', 'settings.json'), 'utf8')).toBe(
      '{"unrelated": true}\n',
    );
    expect(listFilesRecursive(join(root, '.claude'))).toContain('settings.json');
  });
});
