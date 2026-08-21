import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildCli, registerAllCommands } from '../../src/cli/index.js';
import { renderOutput } from '../../src/cli/output.js';
import type { Command } from 'commander';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
) as { version: string };

const ALL_COMMAND_NAMES = [
  'auto-run',
  'backlog',
  'init',
  'milestone-add',
  'milestone-cancel',
  'milestone-complete',
  'milestone-confirm',
  'milestone-list',
  'milestone-merge',
  'milestone-review',
  'milestone-status',
  'quick-change',
  'resume',
  'task-status',
  'task-add',
  'task-amend',
  'task-discard',
  'task-dispatch',
  'task-integrate',
  'task-update',
  'task-verify',
  'usage-add',
  'verification-repair',
  'verify',
  'write-ms-artifacts',
].sort();

// Node's native TS loader resolves relative import specifiers literally — it
// never remaps this repo's `.js` specifiers to their sibling `.ts` files — so
// running `pitway` as a real `node` subprocess only works once a build step
// (npm packaging and distribution, explicitly deferred) emits real .js. These
// tests instead exercise the exact buildCli()/registerAllCommands
// construction the real bin entry point uses, in-process via vitest's own
// resolver, with commander's exit-on-help/version overridden locally so a
// caught CommanderError proves reachability instead of killing the worker.
function captureProgram(): { program: Command; lines: string[] } {
  const lines: string[] = [];
  const program = buildCli();
  program.exitOverride();
  program.configureOutput({
    writeOut: (s) => lines.push(s),
    writeErr: (s) => lines.push(s),
  });
  return { program, lines };
}

describe('pitway bin entry point', () => {
  it('reports the package version', async () => {
    const { program, lines } = captureProgram();
    await expect(program.parseAsync(['node', 'pitway', '--version'])).rejects.toThrow();
    expect(lines.join('').trim()).toBe(pkg.version);
  });

  it('shows help naming the pitway program', async () => {
    const { program, lines } = captureProgram();
    await expect(program.parseAsync(['node', 'pitway', '--help'])).rejects.toThrow();
    expect(lines.join('')).toContain('pitway');
  });
});

describe('registerAllCommands', () => {
  it('registers all 25 commands on a fresh buildCli() program', () => {
    const program = buildCli();
    registerAllCommands(program, {});
    expect(program.commands.map((c) => c.name()).sort()).toEqual(ALL_COMMAND_NAMES);
  });

  it.each(ALL_COMMAND_NAMES)(
    'the real entry-point construction registers "%s" and it responds to --help',
    async (name) => {
      const { program, lines } = captureProgram();
      registerAllCommands(program, {});
      await expect(program.parseAsync(['node', 'pitway', name, '--help'])).rejects.toThrow();
      expect(lines.join('')).toContain(name);
    },
  );

  // auto-run's subcommands nest under the top-level 'auto-run' entry rather
  // than registering their own top-level program.commands entries, so
  // program.commands only ever gains ONE new entry for auto-run itself --
  // each subcommand needs its own explicit reachability coverage here.
  it.each(['enable', 'disable', 'status'])(
    'the real entry-point construction registers "auto-run %s" and it responds to --help',
    async (subcommand) => {
      const { program, lines } = captureProgram();
      registerAllCommands(program, {});
      await expect(
        program.parseAsync(['node', 'pitway', 'auto-run', subcommand, '--help']),
      ).rejects.toThrow();
      expect(lines.join('')).toContain(subcommand);
    },
  );

  // M018/T003 (AC006): backlog's five subcommands nest under the single
  // top-level 'backlog' entry, mirroring auto-run's own subcommand
  // reachability coverage above.
  it.each(['add', 'list', 'show', 'promote', 'archive'])(
    'the real entry-point construction registers "backlog %s" and it responds to --help',
    async (subcommand) => {
      const { program, lines } = captureProgram();
      registerAllCommands(program, {});
      await expect(
        program.parseAsync(['node', 'pitway', 'backlog', subcommand, '--help']),
      ).rejects.toThrow();
      expect(lines.join('')).toContain(subcommand);
    },
  );

  // M019/T003 (AC009-AC013): the 7 named milestone-* commands each gain a
  // native Commander alias; aliases add no new top-level program.commands
  // entries (the 'registers all 25 commands' test above already pins that
  // count unchanged), so reachability is asserted via direct invocation +
  // Command.aliases() here instead. milestone-merge/ms-merge added by a
  // post-M019 quick-change (qc-7e6fb2a4) at explicit developer request --
  // M019/AC013 originally excluded it since it postdated the backlog item's
  // fixed command list.
  const MS_ALIASES: Array<[string, string]> = [
    ['milestone-add', 'ms-add'],
    ['milestone-cancel', 'ms-cancel'],
    ['milestone-complete', 'ms-complete'],
    ['milestone-confirm', 'ms-confirm'],
    ['milestone-list', 'ms-list'],
    ['milestone-merge', 'ms-merge'],
    ['milestone-review', 'ms-review'],
    ['milestone-status', 'ms-status'],
  ];

  it.each(MS_ALIASES)('%s registers the alias %s via Command.aliases()', (canonical, alias) => {
    const program = buildCli();
    registerAllCommands(program, {});
    const command = program.commands.find((c) => c.name() === canonical);
    expect(command?.aliases()).toContain(alias);
  });

  it.each(MS_ALIASES)('pitway %s and pitway %s respond identically to --help', async (canonical, alias) => {
    const canonicalRun = captureProgram();
    registerAllCommands(canonicalRun.program, {});
    await expect(
      canonicalRun.program.parseAsync(['node', 'pitway', canonical, '--help']),
    ).rejects.toThrow();

    const aliasRun = captureProgram();
    registerAllCommands(aliasRun.program, {});
    await expect(aliasRun.program.parseAsync(['node', 'pitway', alias, '--help'])).rejects.toThrow();

    expect(aliasRun.lines.join('')).toBe(canonicalRun.lines.join(''));
  });

  // milestone-review's own subcommands must be reachable under the ms-review
  // alias too, not only the canonical parent name.
  it.each(['start', 'brief', 'record', 'report', 'decide'])(
    'pitway ms-review %s is reachable and responds to --help',
    async (subcommand) => {
      const { program, lines } = captureProgram();
      registerAllCommands(program, {});
      await expect(
        program.parseAsync(['node', 'pitway', 'ms-review', subcommand, '--help']),
      ).rejects.toThrow();
      expect(lines.join('')).toContain(subcommand);
    },
  );

  // Scope is fixed to exactly the 8 named milestone-* commands (the original
  // 7 from M019/AC013, plus milestone-merge/ms-merge added by qc-7e6fb2a4)
  // -- no task-* command gains an alias, and auto-run/quick-change/backlog/
  // resume/etc. are unchanged. A single assertion over every registered
  // command's own alias set proves no alias exists outside the 8 declared
  // above.
  it('registers no alias anywhere outside the 8 named milestone-* commands', () => {
    const program = buildCli();
    registerAllCommands(program, {});
    const actualAliasPairs = program.commands
      .flatMap((c) => c.aliases().map((alias) => [c.name(), alias]))
      .sort();
    expect(actualAliasPairs).toEqual([...MS_ALIASES].sort());
  });
});

describe('renderOutput', () => {
  it('renders valid JSON when json is requested', () => {
    const rendered = renderOutput({ a: 1 }, { json: true }, () => 'human');
    expect(() => JSON.parse(rendered)).not.toThrow();
    expect(JSON.parse(rendered)).toEqual({ a: 1 });
  });

  it('renders via the human formatter otherwise', () => {
    const rendered = renderOutput({ a: 1 }, { json: false }, (d) => `human:${d.a}`);
    expect(rendered).toBe('human:1');
  });
});
