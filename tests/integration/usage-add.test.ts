import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCli } from '../../src/cli/index.js';
import { registerUsageAddCommand } from '../../src/cli/commands/usage-add.js';
import { loadUsage, saveUsage } from '../../src/state/store.js';
import { derivePending } from '../../src/core/journal/operations.js';
import { readJournal, type JournalEntry } from '../../src/state/journal.js';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

const commitCount = (cwd: string): number => Number(git(['rev-list', '--count', 'HEAD'], cwd).trim());

let root: string;

async function run(args: string[]): Promise<{ lines: string[]; error?: Error }> {
  const program = buildCli();
  const lines: string[] = [];
  registerUsageAddCommand(program, { root, write: (s) => lines.push(s) });
  try {
    await program.parseAsync(['node', 'pitway', ...args]);
    return { lines };
  } catch (error) {
    return { lines, error: error as Error };
  }
}

function pendingUsageEntries(): JournalEntry[] {
  return derivePending(readJournal(root)).filter((e) => e.type === 'usage_recording');
}

function installFailingHook(): string {
  const hook = join(root, '.git', 'hooks', 'pre-commit');
  writeFileSync(hook, '#!/bin/sh\nexit 1\n');
  chmodSync(hook, 0o755);
  return hook;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pitway-usage-'));
  git(['init', '-q'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  mkdirSync(join(root, '.pitway', 'milestones', 'M001'), { recursive: true });
  saveUsage(root, 'M001', { schema_version: 1, planning: null, qa: null });
  git(['add', '-A'], root);
  git(['commit', '-q', '-m', 'seed'], root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('pitway usage-add', () => {
  it('first recording creates attempts 1 with measured tokens, journals it, and writes usage.yaml immediately with no commit of its own', async () => {
    const { lines, error } = await run([
      'usage-add',
      'M001',
      '--category',
      'planning',
      '--usage',
      '{"input_tokens":100,"output_tokens":50,"total_tokens":150}',
      '--json',
    ]);
    expect(error).toBeUndefined();

    const view = JSON.parse(lines[0]!) as { id: string; category: string; usage: unknown };
    expect(view).toEqual({
      id: 'M001',
      category: 'planning',
      usage: { attempts: 1, input_tokens: 100, output_tokens: 50, total_tokens: 150 },
    });

    // AC3: a read immediately after the command reflects the amended state,
    // before any checkpoint commit exists.
    const usage = loadUsage(root, 'M001');
    expect(usage.planning).toEqual({
      attempts: 1,
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
    });
    expect(usage.qa).toBeNull();

    // No commit of its own: usage.yaml sits dirty, waiting for the next checkpoint.
    expect(commitCount(root)).toBe(1);
    const status = git(['status', '--porcelain'], root).trim();
    expect(status).toContain('.pitway/milestones/M001/usage.yaml');

    const pending = pendingUsageEntries();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ milestone: 'M001', type: 'usage_recording', target: 'planning' });
  });

  it('subsequent recordings increment attempts once and sum token fields honestly, journaling each recording separately', async () => {
    await run(['usage-add', 'M001', '--category', 'planning', '--usage', '{"total_tokens":100}']);
    const { error } = await run([
      'usage-add',
      'M001',
      '--category',
      'planning',
      '--usage',
      '{"input_tokens":30,"total_tokens":50}',
    ]);
    expect(error).toBeUndefined();

    // absent+absent stays absent (output_tokens); absent+present is the
    // present value (input_tokens); present+present sums (total_tokens).
    expect(loadUsage(root, 'M001').planning).toEqual({
      attempts: 2,
      input_tokens: 30,
      total_tokens: 150,
    });
    // usage-add never commits — every recording is a pending journal entry.
    expect(commitCount(root)).toBe(1);
    expect(pendingUsageEntries()).toHaveLength(2);
  });

  it('planning and qa accumulate independently', async () => {
    await run(['usage-add', 'M001', '--category', 'planning', '--usage', '{"total_tokens":100}']);
    const { error } = await run([
      'usage-add',
      'M001',
      '--category',
      'qa',
      '--usage',
      '{"total_tokens":40}',
    ]);
    expect(error).toBeUndefined();

    const usage = loadUsage(root, 'M001');
    expect(usage.planning).toEqual({ attempts: 1, total_tokens: 100 });
    expect(usage.qa).toEqual({ attempts: 1, total_tokens: 40 });
    expect(commitCount(root)).toBe(1);
  });

  it('rejects malformed, unknown-field, or negative input without writing anything or journaling', async () => {
    const cases: string[][] = [
      ['usage-add', 'M001', '--category', 'planning', '--usage', 'not-json'],
      ['usage-add', 'M001', '--category', 'planning', '--usage', 'null'],
      ['usage-add', 'M001', '--category', 'planning', '--usage', '{"total_tokens":1,"attempts":1}'],
      ['usage-add', 'M001', '--category', 'planning', '--usage', '{"total_tokens":-5}'],
      ['usage-add', 'M001', '--category', 'planning', '--usage', '{"input_tokens":10}'],
      ['usage-add', 'M001', '--category', 'dev', '--usage', '{"total_tokens":1}'],
      ['usage-add', 'M001', '--category', 'planning'],
      ['usage-add', 'M001', '--usage', '{"total_tokens":1}'],
    ];
    for (const args of cases) {
      const { error } = await run(args);
      expect(error, args.join(' ')).toBeDefined();
    }
    expect(loadUsage(root, 'M001')).toEqual({ schema_version: 1, planning: null, qa: null });
    expect(commitCount(root)).toBe(1);
    expect(git(['status', '--porcelain'], root).trim()).toBe('');
    expect(pendingUsageEntries()).toHaveLength(0);
  });

  it('fails for a milestone without a usage file', async () => {
    const { error } = await run([
      'usage-add',
      'M999',
      '--category',
      'planning',
      '--usage',
      '{"total_tokens":1}',
    ]);
    expect(error?.message).toMatch(/M999/);
    expect(commitCount(root)).toBe(1);
  });

  it('succeeds regardless of unrelated dirty paths — there is no commit for a dirty tree to threaten', async () => {
    writeFileSync(join(root, 'wip.txt'), 'wip\n');
    const { error } = await run([
      'usage-add',
      'M001',
      '--category',
      'planning',
      '--usage',
      '{"total_tokens":100}',
    ]);
    expect(error).toBeUndefined();
    expect(loadUsage(root, 'M001').planning).toEqual({ attempts: 1, total_tokens: 100 });
    expect(commitCount(root)).toBe(1);
  });

  it('a full re-run after a hook failure elsewhere is unaffected — usage-add never invokes git at all', async () => {
    await run(['usage-add', 'M001', '--category', 'qa', '--usage', '{"total_tokens":100}']);
    installFailingHook();
    const { error } = await run(['usage-add', 'M001', '--category', 'qa', '--usage', '{"total_tokens":25}']);
    // A failing pre-commit hook cannot affect usage-add: it never creates a commit.
    expect(error).toBeUndefined();
    expect(loadUsage(root, 'M001').qa).toEqual({ attempts: 2, total_tokens: 125 });
    expect(commitCount(root)).toBe(1);
    expect(pendingUsageEntries()).toHaveLength(2);
  });

  it('journals and writes one pending recording per invocation; nothing is ever committed by usage-add', async () => {
    for (const total of [10, 20, 30]) {
      const { error } = await run([
        'usage-add',
        'M001',
        '--category',
        'planning',
        '--usage',
        `{"total_tokens":${total}}`,
      ]);
      expect(error).toBeUndefined();
    }
    expect(loadUsage(root, 'M001').planning).toEqual({ attempts: 3, total_tokens: 60 });
    expect(commitCount(root)).toBe(1);
    expect(pendingUsageEntries()).toHaveLength(3);
  });
});

// The default CommandDeps fallbacks (deps.write ?? console.log,
// deps.root ?? process.cwd()) are only reached when a caller registers the
// command with no overrides -- the real shape a bare `pitway usage-add`
// invocation takes outside this test file's harness.
//
// Coverage disclosure (AC008): renderUsageAddHuman's `view.usage === null`
// branch is unreachable in-process — recordUsage always returns the
// non-null accumulated recording (accumulate() returns NonNullable<Usage>),
// and the renderer is module-private, fed only by that return value.
describe('pitway usage-add default CommandDeps fallbacks', () => {
  it('falls back to console.log and process.cwd() when no overrides are given', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cwdBefore = process.cwd();
    process.chdir(root);
    let caught: unknown;
    let calls: unknown[][] = [];
    try {
      const program = buildCli();
      registerUsageAddCommand(program);
      await program.parseAsync([
        'node',
        'pitway',
        'usage-add',
        'M001',
        '--category',
        'planning',
        '--usage',
        '{"total_tokens":1200}',
      ]);
    } catch (error) {
      caught = error;
    } finally {
      calls = logSpy.mock.calls;
      process.chdir(cwdBefore);
      logSpy.mockRestore();
    }

    expect(caught).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.[0])).toMatch(
      /📊 Recorded pending planning usage for M001 \(attempt 1, 1200 total tokens\)/,
    );
  });
});
