import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCli } from '../../src/cli/index.js';
import { registerInitCommand } from '../../src/cli/commands/init.js';
import { registerMilestoneAddCommand } from '../../src/cli/commands/milestone-add.js';
import { registerMilestoneCancelCommand } from '../../src/cli/commands/milestone-cancel.js';
import { registerMilestoneConfirmCommand } from '../../src/cli/commands/milestone-confirm.js';
import { loadContract, loadState, saveState } from '../../src/state/store.js';

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function gitOutput(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

const commitCount = (cwd: string): number => Number(gitOutput(['rev-list', '--count', 'HEAD'], cwd).trim());

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
  registerInitCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerMilestoneAddCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerMilestoneConfirmCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerMilestoneCancelCommand(program, { root: cwd, write: (s) => lines.push(s) });
  try {
    await program.parseAsync(['node', 'pitway', ...args]);
    return { lines };
  } catch (error) {
    return { lines, error: error as Error };
  }
}

function milestoneDirName(id: string): string {
  const dir = join(root, '.pitway', 'milestones');
  const match = readdirSync(dir).find((e) => e === id || e.startsWith(`${id}-`));
  if (!match) throw new Error(`no milestone directory found for ${id}`);
  return match;
}

function writeInputs(dir: string): { contract: string; tasks: string } {
  const contract = join(dir, 'draft-contract.md');
  const tasks = join(dir, 'draft-tasks.yaml');
  writeFileSync(contract, CONTRACT_FIXTURE);
  writeFileSync(tasks, TASKS_FIXTURE);
  return { contract, tasks };
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'pitway-mcancel-'));
  git(['init', '-q'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  writeFileSync(join(root, 'README.md'), 'seed\n');
  git(['add', 'README.md'], root);
  git(['commit', '-q', '-m', 'init'], root);
  await run(['init'], root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('pitway milestone-cancel (AC001)', () => {
  it('cancels a draft milestone with no git operation, preserving the directory and contract.md', async () => {
    const { contract, tasks } = writeInputs(root);
    const added = await run(['milestone-add', '--contract', contract, '--tasks', tasks], root);
    expect(added.error).toBeUndefined();
    const before = commitCount(root);

    const { error } = await run(['milestone-cancel', 'M001'], root);
    expect(error).toBeUndefined();
    expect(commitCount(root)).toBe(before);

    const cancelled = loadContract(root, 'M001');
    expect(cancelled.frontmatter.status).toBe('cancelled');
    expect(cancelled.frontmatter.id).toBe('M001');

    const dir = milestoneDirName('M001');
    expect(existsSync(join(root, '.pitway', 'milestones', dir, 'contract.md'))).toBe(true);
    expect(existsSync(join(root, '.pitway', 'milestones', dir, 'tasks.yaml'))).toBe(true);

    const state = loadState(root);
    expect(state.milestones).toEqual(['M001']);
    expect(state.active_milestone).toBeNull();
  });

  it('refuses to cancel a milestone that is not draft', async () => {
    const { contract, tasks } = writeInputs(root);
    const added = await run(['milestone-add', '--contract', contract, '--tasks', tasks], root);
    expect(added.error).toBeUndefined();
    rmSync(contract);
    rmSync(tasks);
    const confirmed = await run(['milestone-confirm', 'M001'], root);
    expect(confirmed.error).toBeUndefined();

    const { error } = await run(['milestone-cancel', 'M001'], root);
    expect(error?.message).toMatch(/draft/);
    expect(loadContract(root, 'M001').frontmatter.status).toBe('in_progress');
    expect(loadState(root).active_milestone).toBe('M001');
  });

  it('never reuses a cancelled id: a subsequent milestone-add mints the next one', async () => {
    const { contract, tasks } = writeInputs(root);
    const added = await run(['milestone-add', '--contract', contract, '--tasks', tasks], root);
    expect(added.error).toBeUndefined();

    const { error: cancelError } = await run(['milestone-cancel', 'M001'], root);
    expect(cancelError).toBeUndefined();

    const second = writeInputs(root);
    const { error } = await run(
      ['milestone-add', '--contract', second.contract, '--tasks', second.tasks],
      root,
    );
    expect(error).toBeUndefined();

    const state = loadState(root);
    expect(state.milestones).toEqual(['M001', 'M002']);
    expect(state.active_milestone).toBe('M002');
    expect(loadContract(root, 'M001').frontmatter.status).toBe('cancelled');
    expect(loadContract(root, 'M002').frontmatter.status).toBe('draft');
  });

  it('cancels a non-active draft without touching active_milestone', async () => {
    const { contract, tasks } = writeInputs(root);
    const added = await run(['milestone-add', '--contract', contract, '--tasks', tasks], root);
    expect(added.error).toBeUndefined();
    // Crash-recovery shape: state.yaml no longer points at the draft (e.g.
    // an interrupted correction cleared it); cancelling the draft must not
    // rewrite state.yaml at all.
    saveState(root, { ...loadState(root), active_milestone: null });

    const { error } = await run(['milestone-cancel', 'M001'], root);
    expect(error).toBeUndefined();
    expect(loadContract(root, 'M001').frontmatter.status).toBe('cancelled');
    expect(loadState(root).active_milestone).toBeNull();
  });
});

// The default CommandDeps fallbacks (deps.write ?? console.log,
// deps.root ?? process.cwd()) are only reached when a caller registers the
// command with no overrides -- the real shape a bare `pitway milestone-cancel`
// invocation takes outside this test file's harness.
describe('pitway milestone-cancel default CommandDeps fallbacks', () => {
  it('falls back to console.log and process.cwd() when no overrides are given', async () => {
    const { contract, tasks } = writeInputs(root);
    const added = await run(['milestone-add', '--contract', contract, '--tasks', tasks], root);
    expect(added.error).toBeUndefined();

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cwdBefore = process.cwd();
    process.chdir(root);
    let caught: unknown;
    let calls: unknown[][] = [];
    try {
      const program = buildCli();
      registerMilestoneCancelCommand(program);
      await program.parseAsync(['node', 'pitway', 'milestone-cancel', 'M001']);
    } catch (error) {
      caught = error;
    } finally {
      calls = logSpy.mock.calls;
      process.chdir(cwdBefore);
      logSpy.mockRestore();
    }

    expect(caught).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toMatch(/🏁 Cancelled milestone M001; permanently retired\./);
  });
});
