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
import { resolveDriverAssetSource, resolveDriverAssets } from '../../src/state/driver-assets.js';
import { AGENTS_MD_CONTENT, CLAUDE_MD_CONTENT } from '../../src/state/root-instructions.js';

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

// AC011(b): extracts the PitWay-managed block (markers plus everything
// between) from a fixed-content constant, so append expectations compose
// from the shipped content rather than a second hand-maintained copy.
function extractManagedBlock(content: string): string {
  const start = content.indexOf('<!-- pitway:managed:start -->');
  const end = content.indexOf('<!-- pitway:managed:end -->', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return content.slice(start, end + '<!-- pitway:managed:end -->'.length);
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
  it('src/integrations/claude/ and common/ contain zero .ts files -- text assets only, and their union is the shipped set', () => {
    // M023/T001: shipped sources live in two tiers (claude/ + common/);
    // the resolved union, driver winning on collision, is the shipped set.
    const claudeFiles = listFilesRecursive(
      new URL('../../src/integrations/claude/', import.meta.url).pathname,
    );
    const commonFiles = listFilesRecursive(
      new URL('../../src/integrations/common/', import.meta.url).pathname,
    );
    const files = [...new Set([...claudeFiles, ...commonFiles])].sort();
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
    // Content is copied verbatim, not transformed -- compared against the
    // resolved source (driver-then-common fallback), per asset.
    for (const asset of shipped) {
      expect(readFileSync(join(root, '.claude', asset), 'utf8')).toBe(
        readFileSync(resolveDriverAssetSource('claude', asset), 'utf8'),
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

  // qc-90a293e4: a PitWay-owned asset whose bytes differ from shipped no
  // longer refuses init -- it is preserved untouched and reported (via the
  // human warning and the additive preservedAssets JSON field) for a
  // future `pitway update` to reconcile. Absent assets still install in
  // the same run; identical assets still no-op.
  it('preserves a single differing command doc untouched, reports it, and still installs absent assets', async () => {
    await runInit(root);
    const commandDoc = listClaudeAssets().find((a) => a.startsWith('commands/'))!;
    writeFileSync(join(root, '.claude', commandDoc), 'tampered content\n');
    const absentAsset = listClaudeAssets().find((a) => a !== commandDoc)!;
    rmSync(join(root, '.claude', absentAsset));

    const { lines, error } = await runInit(root);
    expect(error).toBeUndefined();
    // The differing asset is untouched, the absent one installed.
    expect(readFileSync(join(root, '.claude', commandDoc), 'utf8')).toBe('tampered content\n');
    expect(existsSync(join(root, '.claude', absentAsset))).toBe(true);
    // Reported by full destination path, with the pitway update pointer.
    const text = lines.join('\n');
    expect(text).toContain(`.claude/${commandDoc}`);
    expect(text).toMatch(/left untouched/);
    expect(text).toMatch(/pitway update/);
    expect(text).not.toContain(`.claude/${absentAsset}`);
  });

  it('reports a differing command doc and skill together in preservedAssets (--json)', async () => {
    await runInit(root);
    const commandDoc = listClaudeAssets().find((a) => a.startsWith('commands/'))!;
    const skill = 'skills/debugging/SKILL.md';
    writeFileSync(join(root, '.claude', commandDoc), 'tampered command doc\n');
    writeFileSync(join(root, '.claude', skill), 'tampered skill\n');

    const { lines, error } = await runInit(root, ['--json']);
    expect(error).toBeUndefined();
    const view = JSON.parse(lines[0]!) as { preservedAssets: string[] };
    expect(view.preservedAssets).toContain(`.claude/${commandDoc}`);
    expect(view.preservedAssets).toContain(`.claude/${skill}`);
    // Preserved means preserved: neither file was rewritten.
    expect(readFileSync(join(root, '.claude', commandDoc), 'utf8')).toBe('tampered command doc\n');
    expect(readFileSync(join(root, '.claude', skill), 'utf8')).toBe('tampered skill\n');
  });

  it('a differing asset does not block a fresh .pitway/ initialization', async () => {
    await runInit(root);
    const shipped = listClaudeAssets();
    const conflicting = shipped[0]!;
    const absent = shipped[1]!;
    writeFileSync(join(root, '.claude', conflicting), 'tampered content\n');
    rmSync(join(root, '.claude', absent));
    rmSync(join(root, '.pitway'), { recursive: true, force: true });

    const { error } = await runInit(root);
    expect(error).toBeUndefined();
    expect(existsSync(join(root, '.pitway'))).toBe(true);
    expect(existsSync(join(root, '.claude', absent))).toBe(true);
    expect(readFileSync(join(root, '.claude', conflicting), 'utf8')).toBe('tampered content\n');
  });

  it("a user's own unknown file in .claude/ is never inspected, reported, or touched", async () => {
    await runInit(root);
    const userFile = join(root, '.claude', 'my-own-notes.md');
    writeFileSync(userFile, 'user content, not a pitway asset\n');
    const userSetting = join(root, '.claude', 'settings.json');
    writeFileSync(userSetting, '{"theme":"dark"}\n');

    const { lines, error } = await runInit(root, ['--json']);
    expect(error).toBeUndefined();
    const view = JSON.parse(lines[0]!) as { preservedAssets: string[] };
    expect(view.preservedAssets).toEqual([]);
    expect(readFileSync(userFile, 'utf8')).toBe('user content, not a pitway asset\n');
    expect(readFileSync(userSetting, 'utf8')).toBe('{"theme":"dark"}\n');
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
    // M023/T001: re-derived from BOTH source tiers on disk (claude/ union
    // common/, driver winning on any collision) -- still independent of
    // listClaudeAssets()'s own answer.
    const claudeRoot = new URL('../../src/integrations/claude/', import.meta.url).pathname;
    const commonRoot = new URL('../../src/integrations/common/', import.meta.url).pathname;
    const claudeFiles = listFilesRecursive(claudeRoot);
    const actualAssets = [...new Set([...claudeFiles, ...listFilesRecursive(commonRoot)])].sort();

    expect(actualAssets).toContain(join('commands', 'auto-run.md'));
    expect(actualAssets).toContain('interactive-ux.md');

    const { error } = await runInit(root);
    expect(error).toBeUndefined();
    const installed = listFilesRecursive(join(root, '.claude'));
    expect(installed).toEqual(actualAssets);
    for (const asset of actualAssets) {
      const sourceRoot = claudeFiles.includes(asset) ? claudeRoot : commonRoot;
      expect(readFileSync(join(root, '.claude', asset), 'utf8')).toBe(
        readFileSync(join(sourceRoot, asset), 'utf8'),
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

// M023/T002 (AC005, AC006): opt-in OpenCode asset installation into
// .opencode/, additive alongside the default-on Claude installation, with
// the same absent/identical/conflict semantics.
describe('pitway init OpenCode asset installation (M023/T002, AC006)', () => {
  it('default init never touches .opencode/ at all', async () => {
    const { error } = await runInit(root);
    expect(error).toBeUndefined();
    expect(existsSync(join(root, '.opencode'))).toBe(false);
  });

  it('--opencode installs every resolved opencode asset into .opencode/, verbatim, alongside .claude/', async () => {
    const { error } = await runInit(root, ['--opencode']);
    expect(error).toBeUndefined();
    const resolved = resolveDriverAssets('opencode');
    expect(resolved.length).toBeGreaterThan(0);
    const installed = listFilesRecursive(join(root, '.opencode'));
    expect(installed).toEqual(resolved.slice().sort());
    // AC006's explicit destinations: commands, skills, root-level protocol docs.
    expect(installed).toContain(join('commands', 'milestone-status.md'));
    expect(installed).toContain(join('skills', 'debugging', 'SKILL.md'));
    expect(installed).toContain('protocol-driver.md');
    // Content is copied verbatim from the resolved source, per asset.
    for (const asset of resolved) {
      expect(readFileSync(join(root, '.opencode', asset), 'utf8')).toBe(
        readFileSync(resolveDriverAssetSource('opencode', asset), 'utf8'),
      );
    }
    // Additive: the default Claude installation still happened too.
    expect(listFilesRecursive(join(root, '.claude'))).toEqual(listClaudeAssets().slice().sort());
  });

  it('--opencode --no-claude installs .opencode/ only, never .claude/ or CLAUDE.md', async () => {
    const { error } = await runInit(root, ['--opencode', '--no-claude']);
    expect(error).toBeUndefined();
    expect(existsSync(join(root, '.opencode', 'protocol-driver.md'))).toBe(true);
    expect(existsSync(join(root, '.claude'))).toBe(false);
    expect(existsSync(join(root, 'CLAUDE.md'))).toBe(false);
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toBe(AGENTS_MD_CONTENT);
  });

  it('the --json view reports opencodeInstalled, mirroring claudeInstalled', async () => {
    const first = await runInit(root, ['--opencode', '--json']);
    expect(first.error).toBeUndefined();
    const view = JSON.parse(first.lines[0]!) as { claudeInstalled: boolean; opencodeInstalled: boolean };
    expect(view.claudeInstalled).toBe(true);
    expect(view.opencodeInstalled).toBe(true);
    // A fully installed rerun reports false for both -- nothing was written.
    const rerun = await runInit(root, ['--opencode', '--json']);
    expect(rerun.error).toBeUndefined();
    const rerunView = JSON.parse(rerun.lines[0]!) as {
      claudeInstalled: boolean;
      opencodeInstalled: boolean;
    };
    expect(rerunView.claudeInstalled).toBe(false);
    expect(rerunView.opencodeInstalled).toBe(false);
  });

  it('a default (flagless) rerun after --opencode leaves the installed .opencode/ untouched', async () => {
    await runInit(root, ['--opencode']);
    const before = listFilesRecursive(join(root, '.opencode'));
    const mtimeBefore = statSync(join(root, '.opencode', 'protocol-driver.md')).mtimeMs;
    const { error } = await runInit(root);
    expect(error).toBeUndefined();
    expect(listFilesRecursive(join(root, '.opencode'))).toEqual(before);
    expect(statSync(join(root, '.opencode', 'protocol-driver.md')).mtimeMs).toBe(mtimeBefore);
  });

  it('a partial-but-non-conflicting .opencode/ state installs only the missing assets cleanly', async () => {
    await runInit(root, ['--opencode']);
    const resolved = resolveDriverAssets('opencode');
    const removed = resolved[0]!;
    const untouched = resolved[1]!;
    rmSync(join(root, '.opencode', removed));
    const mtimeBefore = statSync(join(root, '.opencode', untouched)).mtimeMs;

    const { error } = await runInit(root, ['--opencode']);
    expect(error).toBeUndefined();
    expect(existsSync(join(root, '.opencode', removed))).toBe(true);
    expect(statSync(join(root, '.opencode', untouched)).mtimeMs).toBe(mtimeBefore);
  });

  // qc-90a293e4: same preserve-and-report semantics as .claude/ above.
  it('preserves a differing .opencode/ asset untouched, reports it by full path, and completes init', async () => {
    await runInit(root, ['--opencode']);
    const conflicting = resolveDriverAssets('opencode').find((a) => a.startsWith('commands/'))!;
    writeFileSync(join(root, '.opencode', conflicting), 'tampered content\n');
    rmSync(join(root, '.pitway'), { recursive: true, force: true });

    const { lines, error } = await runInit(root, ['--opencode', '--json']);
    expect(error).toBeUndefined();
    const view = JSON.parse(lines[0]!) as { preservedAssets: string[] };
    expect(view.preservedAssets).toContain(`.opencode/${conflicting}`);
    expect(readFileSync(join(root, '.opencode', conflicting), 'utf8')).toBe('tampered content\n');
    // Init itself completed: .pitway/ was recreated.
    expect(existsSync(join(root, '.pitway'))).toBe(true);
  });

  it('a differing .opencode/ asset is never inspected or reported by a default init that omits --opencode', async () => {
    await runInit(root, ['--opencode']);
    const conflicting = resolveDriverAssets('opencode')[0]!;
    writeFileSync(join(root, '.opencode', conflicting), 'tampered content\n');

    const { lines, error } = await runInit(root, ['--json']);
    expect(error).toBeUndefined();
    const view = JSON.parse(lines[0]!) as { preservedAssets: string[] };
    expect(view.preservedAssets).toEqual([]);
  });

  it("a user's own unknown file in .opencode/ is never inspected, reported, or touched", async () => {
    await runInit(root, ['--opencode']);
    const userFile = join(root, '.opencode', 'my-own-config.md');
    writeFileSync(userFile, 'user content, not a pitway asset\n');

    const { lines, error } = await runInit(root, ['--opencode', '--json']);
    expect(error).toBeUndefined();
    const view = JSON.parse(lines[0]!) as { preservedAssets: string[] };
    expect(view.preservedAssets).toEqual([]);
    expect(readFileSync(userFile, 'utf8')).toBe('user content, not a pitway asset\n');
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

  // AC011(c): a pre-existing user-authored file gets the managed block
  // APPENDED (developer directive 2026-08-22, replacing the former
  // preserve-untouched behavior), user content fully intact above it.
  it('appends the managed block to an existing, user-authored AGENTS.md, its own content intact above', async () => {
    const custom = '# My own AGENTS.md, hand-authored\n';
    writeFileSync(join(root, 'AGENTS.md'), custom);
    const { error } = await runInit(root);
    expect(error).toBeUndefined();
    const installed = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    expect(installed.startsWith(custom)).toBe(true);
    expect(installed).toBe(`${custom}\n${extractManagedBlock(AGENTS_MD_CONTENT)}\n`);
  });

  it('appends to an existing, user-authored CLAUDE.md the same way', async () => {
    const custom = '# My own CLAUDE.md, hand-authored\n';
    writeFileSync(join(root, 'CLAUDE.md'), custom);
    const { error } = await runInit(root);
    expect(error).toBeUndefined();
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toBe(
      `${custom}\n${extractManagedBlock(CLAUDE_MD_CONTENT)}\n`,
    );
  });

  // AC011(d): a file byte-equal to the pre-B008 PitWay-generated form is
  // rewritten to the new marked form outright, never appended-to.
  it('rewrites a legacy PitWay-generated AGENTS.md to the new marked form outright', async () => {
    const legacyAgentsMd =
      '# Agent Instructions\n' +
      '\n' +
      '- This project uses [PitWay](https://github.com/thixpin/pitway) to control the engineering workflow.\n' +
      '- Run `pitway resume` before starting or resuming any work.\n' +
      '- Never edit `.pitway/` directly.\n' +
      '- Work only within a confirmed task boundary.\n' +
      "- Obtain a task's bounded context via `pitway task-status <id> --context`.\n";
    writeFileSync(join(root, 'AGENTS.md'), legacyAgentsMd);
    const { error } = await runInit(root);
    expect(error).toBeUndefined();
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toBe(AGENTS_MD_CONTENT);
  });

  // AC011(e): a present-but-differing managed block is left completely
  // unmodified and reported (the future `pitway update` command's job).
  it('leaves a differing managed block unmodified, warning with the exact fixed content', async () => {
    const tampered = AGENTS_MD_CONTENT.replace('- Never edit `.pitway/` directly.\n', '');
    writeFileSync(join(root, 'AGENTS.md'), tampered);
    const { error, lines } = await runInit(root);
    expect(error).toBeUndefined();
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toBe(tampered);
    expect(lines.join('\n')).toContain(AGENTS_MD_CONTENT);
  });

  // qc-90a293e4: a differing PitWay-owned asset no longer refuses init, so
  // it no longer blocks root-file creation either -- the preserved asset
  // is reported, and both root files are still created.
  it('a differing .claude/ asset does not block root file creation', async () => {
    await runInit(root);
    const shipped = listClaudeAssets();
    writeFileSync(join(root, '.claude', shipped[0]!), 'tampered\n');
    rmSync(join(root, 'AGENTS.md'));
    rmSync(join(root, 'CLAUDE.md'));

    const { lines, error } = await runInit(root);
    expect(error).toBeUndefined();
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(root, 'CLAUDE.md'))).toBe(true);
    expect(lines.join('\n')).toContain(`.claude/${shipped[0]!}`);
  });

  it('--no-claude creates/preserves AGENTS.md only, never touching CLAUDE.md or .claude/', async () => {
    const { error } = await runInit(root, ['--no-claude']);
    expect(error).toBeUndefined();
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toBe(AGENTS_MD_CONTENT);
    expect(existsSync(join(root, 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(root, '.claude'))).toBe(false);
  });
});

describe('pitway init --reconfigure', () => {
  it('normal init remains unchanged (already-initialized no-op still preserves conflicts)', async () => {
    await runInit(root);
    const asset = listClaudeAssets().find((a) => a.startsWith('commands/'))!;
    writeFileSync(join(root, '.claude', asset), 'tampered\n');
    const { error, lines } = await runInit(root);
    expect(error).toBeUndefined();
    expect(readFileSync(join(root, '.claude', asset), 'utf8')).toBe('tampered\n');
    expect(lines.join('\n')).toMatch(/left untouched/);
  });

  it('works on an already-initialized project', async () => {
    await runInit(root, ['--opencode']);
    const { error, lines } = await runInit(root, ['--reconfigure']);
    expect(error).toBeUndefined();
    expect(lines.join('\n')).toMatch(/Reconfigured/);
  });

  it('preserves all .pitway workflow state', async () => {
    await runInit(root);
    // Create a milestone-like state to prove preservation
    const statePath = join(root, '.pitway', 'state.yaml');
    const beforeState = readFileSync(statePath, 'utf8');
    const configPath = join(root, '.pitway', 'config.yaml');
    const beforeConfig = readFileSync(configPath, 'utf8');
    // Add a dummy milestone entry via direct state edit (simulating workflow state)
    const state = parse(beforeState) as { milestones: string[] };
    state.milestones.push('M999');
    writeFileSync(statePath, `schema_version: 1\nactive_milestone: null\nmilestones: [${state.milestones.map((m) => `"${m}"`).join(', ')}]\n`);
    const tamperedState = readFileSync(statePath, 'utf8');
    const { error } = await runInit(root, ['--reconfigure']);
    expect(error).toBeUndefined();
    expect(readFileSync(statePath, 'utf8')).toBe(tamperedState);
    expect(readFileSync(configPath, 'utf8')).toBe(beforeConfig);
  });

  it('refreshes managed .claude and .opencode assets (including conflicts)', async () => {
    await runInit(root, ['--opencode']);
    const claudeAsset = listClaudeAssets().find((a) => a.startsWith('commands/'))!;
    const opencodeAsset = resolveDriverAssets('opencode').find((a) => a.startsWith('commands/'))!;
    writeFileSync(join(root, '.claude', claudeAsset), 'tampered claude\n');
    writeFileSync(join(root, '.opencode', opencodeAsset), 'tampered opencode\n');
    const { error } = await runInit(root, ['--reconfigure', '--opencode']);
    expect(error).toBeUndefined();
    expect(readFileSync(join(root, '.claude', claudeAsset), 'utf8')).toBe(
      readFileSync(resolveDriverAssetSource('claude', claudeAsset), 'utf8'),
    );
    expect(readFileSync(join(root, '.opencode', opencodeAsset), 'utf8')).toBe(
      readFileSync(resolveDriverAssetSource('opencode', opencodeAsset), 'utf8'),
    );
  });

  it('refreshes existing .opencode installation even without explicit --opencode flag', async () => {
    await runInit(root, ['--opencode']);
    const asset = resolveDriverAssets('opencode')[0]!;
    writeFileSync(join(root, '.opencode', asset), 'tampered\n');
    const { error } = await runInit(root, ['--reconfigure']);
    expect(error).toBeUndefined();
    expect(readFileSync(join(root, '.opencode', asset), 'utf8')).toBe(
      readFileSync(resolveDriverAssetSource('opencode', asset), 'utf8'),
    );
  });

  it('repeated reconfigure is idempotent', async () => {
    await runInit(root, ['--opencode']);
    const asset = listClaudeAssets()[0]!;
    writeFileSync(join(root, '.claude', asset), 'tampered\n');
    await runInit(root, ['--reconfigure', '--opencode']);
    const afterFirst = readFileSync(join(root, '.claude', asset), 'utf8');
    const mtimeFirst = statSync(join(root, '.claude', asset)).mtimeMs;
    const { error } = await runInit(root, ['--reconfigure', '--opencode']);
    expect(error).toBeUndefined();
    expect(readFileSync(join(root, '.claude', asset), 'utf8')).toBe(afterFirst);
    expect(statSync(join(root, '.claude', asset)).mtimeMs).toBe(mtimeFirst);
  });

  it('does not remove or overwrite unrelated user files', async () => {
    await runInit(root, ['--opencode']);
    const userClaude = join(root, '.claude', 'my-notes.md');
    const userOpencode = join(root, '.opencode', 'my-config.md');
    writeFileSync(userClaude, 'user claude notes\n');
    writeFileSync(userOpencode, 'user opencode notes\n');
    // Also tamper a managed asset to ensure refresh happens but user files stay
    const managed = listClaudeAssets()[0]!;
    writeFileSync(join(root, '.claude', managed), 'tampered managed\n');
    const { error } = await runInit(root, ['--reconfigure', '--opencode']);
    expect(error).toBeUndefined();
    expect(readFileSync(userClaude, 'utf8')).toBe('user claude notes\n');
    expect(readFileSync(userOpencode, 'utf8')).toBe('user opencode notes\n');
    expect(readFileSync(join(root, '.claude', managed), 'utf8')).toBe(
      readFileSync(resolveDriverAssetSource('claude', managed), 'utf8'),
    );
  });
});
