import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCli } from '../../src/cli/index.js';
import { registerInitCommand } from '../../src/cli/commands/init.js';
import { registerMilestoneAddCommand } from '../../src/cli/commands/milestone-add.js';
import { registerWriteMsArtifactsCommand } from '../../src/cli/commands/write-ms-artifacts.js';
import { loadState } from '../../src/state/store.js';

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

let root: string;

const CONTRACT_FIXTURE = `---
schema_version: 1
id: M999
title: Example milestone
status: confirmed
requirement: null
confirmed_at: 2026-01-01T00:00:00Z
verification_approved_hash: null
acceptance_criteria:
  - id: AC001
    text: Behavior holds.
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npm test
---

# Contract

## Objective

Example.

## Change Log
`;

const TASKS_FIXTURE = `schema_version: 1
tasks:
  - id: T001
    objective: Do the work.
    status: in_progress
    depends_on: []
    acceptance_criteria:
      - It works
    relevant_files:
      - src/x.ts
    verification:
      strategy: tdd
      detail: npm test
    result: null
    usage: null
`;

async function run(args: string[], cwd: string): Promise<{ lines: string[]; error?: Error }> {
  const program = buildCli();
  const lines: string[] = [];
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: (s) => lines.push(s) });
  registerInitCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerMilestoneAddCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerWriteMsArtifactsCommand(program, { root: cwd, write: (s) => lines.push(s) });
  try {
    await program.parseAsync(['node', 'pitway', ...args]);
    return { lines };
  } catch (error) {
    const err = error as Error & { code?: string };
    if (err.code?.startsWith('commander.')) {
      return { lines, error: new Error(lines.join('')) };
    }
    return { lines, error: err };
  }
}

function writeInputs(dir: string): { contract: string; tasks: string } {
  const contract = join(dir, 'draft-contract.md');
  const tasks = join(dir, 'draft-tasks.yaml');
  writeFileSync(contract, CONTRACT_FIXTURE);
  writeFileSync(tasks, TASKS_FIXTURE);
  return { contract, tasks };
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'pitway-wma-'));
  git(['init', '-q'], root);
  await run(['init'], root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('pitway write-ms-artifacts', () => {
  it('requires --destination', async () => {
    const { contract, tasks } = writeInputs(root);
    const { error } = await run(['write-ms-artifacts', '--contract', contract, '--tasks', tasks], root);
    expect(error?.message).toMatch(/destination/);
  });

  it('refuses a destination directly under .pitway', async () => {
    const { contract, tasks } = writeInputs(root);
    const destination = join(root, '.pitway');
    const { error } = await run(
      ['write-ms-artifacts', '--contract', contract, '--tasks', tasks, '--destination', destination],
      root,
    );
    expect(error?.message).toMatch(/\.pitway/);
    expect(existsSync(join(destination, 'contract.md'))).toBe(false);
  });

  it('refuses a destination in a subdirectory of .pitway', async () => {
    const { contract, tasks } = writeInputs(root);
    const destination = join(root, '.pitway', 'milestones', 'M999');
    const { error } = await run(
      ['write-ms-artifacts', '--contract', contract, '--tasks', tasks, '--destination', destination],
      root,
    );
    expect(error?.message).toMatch(/\.pitway/);
    expect(existsSync(destination)).toBe(false);
  });

  it('writes draft artifacts to an explicit destination without touching .pitway/ state', async () => {
    const { contract, tasks } = writeInputs(root);
    const destination = join(root, 'drafts');
    const stateBefore = loadState(root);
    const { error } = await run(
      ['write-ms-artifacts', '--contract', contract, '--tasks', tasks, '--destination', destination],
      root,
    );
    expect(error).toBeUndefined();

    const writtenContract = join(destination, 'contract.md');
    const writtenTasks = join(destination, 'tasks.yaml');
    expect(existsSync(writtenContract)).toBe(true);
    expect(existsSync(writtenTasks)).toBe(true);
    expect(readFileSync(writtenContract, 'utf8')).toBe(CONTRACT_FIXTURE);
    expect(readFileSync(writtenTasks, 'utf8')).toBe(TASKS_FIXTURE);

    expect(loadState(root)).toEqual(stateBefore);
    expect(existsSync(join(root, '.pitway', 'milestones', 'M001'))).toBe(false);
  });

  it('refuses to overwrite an existing destination file without --overwrite, naming it', async () => {
    const { contract, tasks } = writeInputs(root);
    const destination = join(root, 'drafts');
    await run(['write-ms-artifacts', '--contract', contract, '--tasks', tasks, '--destination', destination], root);

    const { error } = await run(
      ['write-ms-artifacts', '--contract', contract, '--tasks', tasks, '--destination', destination],
      root,
    );
    expect(error?.message).toMatch(join(destination, 'contract.md'));
  });

  it('overwrites when --overwrite is given', async () => {
    const { contract, tasks } = writeInputs(root);
    const destination = join(root, 'drafts');
    await run(['write-ms-artifacts', '--contract', contract, '--tasks', tasks, '--destination', destination], root);

    const { error } = await run(
      [
        'write-ms-artifacts',
        '--contract',
        contract,
        '--tasks',
        tasks,
        '--destination',
        destination,
        '--overwrite',
      ],
      root,
    );
    expect(error).toBeUndefined();
  });

  it('reuses milestone-add validation: refuses a bad dependency reference', async () => {
    const { contract } = writeInputs(root);
    const badTasks = join(root, 'bad-tasks.yaml');
    writeFileSync(badTasks, TASKS_FIXTURE.replace('depends_on: []', 'depends_on: [T999]'));
    const destination = join(root, 'drafts');
    const { error } = await run(
      ['write-ms-artifacts', '--contract', contract, '--tasks', badTasks, '--destination', destination],
      root,
    );
    expect(error?.message).toMatch(/T999/);
    expect(existsSync(destination)).toBe(false);
  });

  it('reuses milestone-add validation: refuses a bad criterion reference', async () => {
    const badContract = join(root, 'bad-contract.md');
    writeFileSync(badContract, CONTRACT_FIXTURE.replace('criterion: AC001', 'criterion: AC999'));
    const { tasks } = writeInputs(root);
    const destination = join(root, 'drafts');
    const { error } = await run(
      ['write-ms-artifacts', '--contract', badContract, '--tasks', tasks, '--destination', destination],
      root,
    );
    expect(error?.message).toMatch(/AC999/);
    expect(existsSync(destination)).toBe(false);
  });

  it('never confirms, commits, or dispatches: written artifacts are unmodified milestone-add input', async () => {
    const { contract, tasks } = writeInputs(root);
    const destination = join(root, 'drafts');
    await run(['write-ms-artifacts', '--contract', contract, '--tasks', tasks, '--destination', destination], root);

    const writtenContract = join(destination, 'contract.md');
    const writtenTasks = join(destination, 'tasks.yaml');
    const { error } = await run(
      ['milestone-add', '--contract', writtenContract, '--tasks', writtenTasks],
      root,
    );
    expect(error).toBeUndefined();
    expect(loadState(root).active_milestone).toBe('M001');
  });
});

// The default CommandDeps fallbacks (deps.write ?? console.log,
// deps.root ?? process.cwd()) are only reached when a caller registers the
// command with no overrides -- the real shape a bare `pitway
// write-ms-artifacts` invocation takes outside this test file's harness.
describe('pitway write-ms-artifacts default CommandDeps fallbacks', () => {
  it('falls back to console.log and process.cwd() when no overrides are given', async () => {
    const { contract, tasks } = writeInputs(root);
    const destination = join(root, 'drafts');

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cwdBefore = process.cwd();
    process.chdir(root);
    let caught: unknown;
    let calls: unknown[][] = [];
    try {
      const program = buildCli();
      registerWriteMsArtifactsCommand(program);
      await program.parseAsync([
        'node',
        'pitway',
        'write-ms-artifacts',
        '--contract',
        contract,
        '--tasks',
        tasks,
        '--destination',
        destination,
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
    expect(String(calls[0]?.[0])).toContain('📜 Wrote draft artifacts:');
    expect(existsSync(join(destination, 'contract.md'))).toBe(true);
  });
});
