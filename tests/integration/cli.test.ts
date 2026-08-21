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
  'init',
  'milestone-add',
  'milestone-cancel',
  'milestone-complete',
  'milestone-confirm',
  'milestone-list',
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
  it('registers all 23 commands on a fresh buildCli() program', () => {
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
