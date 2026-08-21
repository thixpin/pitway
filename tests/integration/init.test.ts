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
import { AGENTS_MD_CONTENT, CLAUDE_MD_CONTENT } from '../../src/state/root-instructions.js';

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
    // AC010/T010 (M014): the three parallel-mode command docs install too --
    // discovery is dynamic, so this is the shipped-and-installed proof.
    for (const doc of [
      'commands/task-dispatch.md',
      'commands/task-integrate.md',
      'commands/task-discard.md',
    ]) {
      expect(installed).toContain(doc);
    }
    // AC011/T010 (M015): the new milestone-review command doc installs too.
    expect(installed).toContain('commands/milestone-review.md');
    // AC002/T002 (M017): the new task-add command doc installs too.
    expect(installed).toContain('commands/task-add.md');
    // AC008/T005 (M018): the new backlog command doc installs too.
    expect(installed).toContain('commands/backlog.md');
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

  // T002: corrected semantics -- a partial-but-non-conflicting .claude/
  // state (some assets absent, none differing) is no longer refused; it
  // installs the missing assets cleanly, mirroring .pitway/'s own
  // fresh-install behavior. Only an actual content conflict refuses.
  it('a partial-but-non-conflicting .claude/ state installs the missing assets cleanly', async () => {
    await runInit(root);
    const shipped = listClaudeAssets();
    // Simulate an interrupted install: remove exactly one managed asset,
    // leaving the rest present and unmodified.
    rmSync(join(root, '.claude', shipped[0]!));

    const { error } = await runInit(root);
    expect(error).toBeUndefined();
    expect(existsSync(join(root, '.claude', shipped[0]!))).toBe(true);
    expect(listFilesRecursive(join(root, '.claude'))).toEqual(shipped.slice().sort());
  });

  // T002: direct regression test for installClaudeAssets's new subset
  // parameter -- not merely the all-identical or all-absent extremes.
  it('a mixed rerun installs only the absent assets, leaving identical ones untouched', async () => {
    await runInit(root);
    const shipped = listClaudeAssets();
    const removed = shipped[0]!;
    const untouched = shipped[1]!;
    rmSync(join(root, '.claude', removed));
    const mtimeBefore = statSync(join(root, '.claude', untouched)).mtimeMs;

    const { error } = await runInit(root);
    expect(error).toBeUndefined();
    expect(existsSync(join(root, '.claude', removed))).toBe(true);
    expect(statSync(join(root, '.claude', untouched)).mtimeMs).toBe(mtimeBefore);
  });

  it('refuses a single conflicting command doc, naming exactly that path, writing nothing else', async () => {
    await runInit(root);
    const commandDoc = listClaudeAssets().find((a) => a.startsWith('commands/'))!;
    writeFileSync(join(root, '.claude', commandDoc), 'tampered content\n');
    const absentAsset = listClaudeAssets().find((a) => a !== commandDoc)!;
    rmSync(join(root, '.claude', absentAsset));

    const { error } = await runInit(root);
    expect(error?.message).toMatch(new RegExp(commandDoc.replace('.', '\\.')));
    expect(error?.message).not.toMatch(new RegExp(absentAsset.replace('.', '\\.')));
    // Nothing else got written either — the refusal is atomic.
    expect(existsSync(join(root, '.claude', absentAsset))).toBe(false);
  });

  it('refuses a single conflicting skill the same way', async () => {
    await runInit(root);
    const skill = 'skills/debugging/SKILL.md';
    writeFileSync(join(root, '.claude', skill), 'tampered content\n');

    const { error } = await runInit(root);
    expect(error?.message).toMatch(/skills\/debugging\/SKILL\.md/);
  });

  it('refuses two simultaneous conflicts, naming both together, not just one', async () => {
    await runInit(root);
    const commandDoc = listClaudeAssets().find((a) => a.startsWith('commands/'))!;
    const skill = 'skills/debugging/SKILL.md';
    writeFileSync(join(root, '.claude', commandDoc), 'tampered command doc\n');
    writeFileSync(join(root, '.claude', skill), 'tampered skill\n');

    const { error } = await runInit(root);
    expect(error?.message).toMatch(new RegExp(commandDoc.replace('.', '\\.')));
    expect(error?.message).toMatch(/skills\/debugging\/SKILL\.md/);
  });

  it('a conflict alongside otherwise-absent assets writes nothing at all, including .pitway/', async () => {
    await runInit(root);
    const shipped = listClaudeAssets();
    const conflicting = shipped[0]!;
    const absent = shipped[1]!;
    writeFileSync(join(root, '.claude', conflicting), 'tampered content\n');
    rmSync(join(root, '.claude', absent));
    rmSync(join(root, '.pitway'), { recursive: true, force: true });

    const { error } = await runInit(root);
    expect(error?.message).toMatch(/conflicting|inconsistent/i);
    // Nothing else got written either — the refusal is atomic.
    expect(existsSync(join(root, '.pitway'))).toBe(false);
    expect(existsSync(join(root, '.claude', absent))).toBe(false);
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

  // T001: proves the six vendored skills and NOTICE.md install to exactly
  // .claude/skills/<name>/SKILL.md and .claude/skills/NOTICE.md -- named
  // explicitly here rather than assumed from the generic glob coverage
  // above, since a glob mismatch elsewhere could otherwise mask a missing
  // skill.
  it('installs all six vendored skills and NOTICE.md under .claude/skills/ (T001)', async () => {
    const { error } = await runInit(root);
    expect(error).toBeUndefined();
    const vendoredSkills = [
      'debugging',
      'bug-fix',
      'testing',
      'code-quality-review',
      'architecture-review',
      'security-audit',
    ];
    for (const name of vendoredSkills) {
      expect(existsSync(join(root, '.claude', 'skills', name, 'SKILL.md'))).toBe(true);
    }
    expect(existsSync(join(root, '.claude', 'skills', 'NOTICE.md'))).toBe(true);
    // infra-design/terraform-review are explicitly rejected, never vendored.
    expect(existsSync(join(root, '.claude', 'skills', 'infra-design'))).toBe(false);
    expect(existsSync(join(root, '.claude', 'skills', 'terraform-review'))).toBe(false);
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

// AC004/T004: root agent-discovery files, entirely separate from .claude/
// asset installation above.
describe('pitway init root agent-discovery files (AC004)', () => {
  it('creates both AGENTS.md and CLAUDE.md when absent, with the fixed content', async () => {
    const { error } = await runInit(root);
    expect(error).toBeUndefined();
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toBe(AGENTS_MD_CONTENT);
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toBe(CLAUDE_MD_CONTENT);
  });

  it('an identical rerun performs zero writes to either root file', async () => {
    await runInit(root);
    const agentsMtimeBefore = statSync(join(root, 'AGENTS.md')).mtimeMs;
    const claudeMtimeBefore = statSync(join(root, 'CLAUDE.md')).mtimeMs;
    const { error } = await runInit(root);
    expect(error).toBeUndefined();
    expect(statSync(join(root, 'AGENTS.md')).mtimeMs).toBe(agentsMtimeBefore);
    expect(statSync(join(root, 'CLAUDE.md')).mtimeMs).toBe(claudeMtimeBefore);
  });

  it('preserves an existing, user-authored AGENTS.md byte-for-byte, warning with the exact fixed content', async () => {
    const custom = '# My own AGENTS.md, hand-authored\n';
    writeFileSync(join(root, 'AGENTS.md'), custom);
    const { error, lines } = await runInit(root);
    expect(error).toBeUndefined();
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toBe(custom);
    expect(lines.join('\n')).toContain(AGENTS_MD_CONTENT);
  });

  it('preserves an existing, user-authored CLAUDE.md the same way', async () => {
    const custom = '# My own CLAUDE.md, hand-authored\n';
    writeFileSync(join(root, 'CLAUDE.md'), custom);
    const { error, lines } = await runInit(root);
    expect(error).toBeUndefined();
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toBe(custom);
    expect(lines.join('\n')).toContain(CLAUDE_MD_CONTENT);
  });

  it('a simulated .claude/ conflict refuses the whole init with neither root file created (preflight ordering)', async () => {
    await runInit(root);
    const shipped = listClaudeAssets();
    writeFileSync(join(root, '.claude', shipped[0]!), 'tampered\n');
    rmSync(join(root, 'AGENTS.md'));
    rmSync(join(root, 'CLAUDE.md'));

    const { error } = await runInit(root);
    expect(error).toBeDefined();
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(root, 'CLAUDE.md'))).toBe(false);
  });

  it('--no-claude creates/preserves AGENTS.md only, never touching CLAUDE.md or .claude/', async () => {
    const { error } = await runInit(root, ['--no-claude']);
    expect(error).toBeUndefined();
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toBe(AGENTS_MD_CONTENT);
    expect(existsSync(join(root, 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(root, '.claude'))).toBe(false);
  });
});
