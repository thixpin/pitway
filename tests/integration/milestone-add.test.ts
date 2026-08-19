import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCli } from '../../src/cli/index.js';
import { registerInitCommand } from '../../src/cli/commands/init.js';
import { registerMilestoneAddCommand } from '../../src/cli/commands/milestone-add.js';
import { loadContract, loadState, loadTasks } from '../../src/state/store.js';

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
  registerInitCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerMilestoneAddCommand(program, { root: cwd, write: (s) => lines.push(s) });
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
  root = mkdtempSync(join(tmpdir(), 'pitway-madd-'));
  git(['init', '-q'], root);
  await run(['init'], root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('pitway milestone-add', () => {
  it('creates M001 forced to draft/planned, registers state, sets active', async () => {
    const { contract, tasks } = writeInputs(root);
    const { error } = await run(['milestone-add', '--contract', contract, '--tasks', tasks], root);
    expect(error).toBeUndefined();

    const state = loadState(root);
    expect(state).toEqual({ schema_version: 1, active_milestone: 'M001', milestones: ['M001'] });

    const created = loadContract(root, 'M001');
    expect(created.frontmatter.id).toBe('M001');
    expect(created.frontmatter.status).toBe('draft');
    expect(created.frontmatter.confirmed_at).toBeNull();
    expect(created.frontmatter.verification_approved_hash).toBeNull();

    const createdTasks = loadTasks(root, 'M001');
    expect(createdTasks.tasks[0]!.status).toBe('planned');

    // CONTRACT_FIXTURE's title is "Example milestone" -> deterministic slug.
    const dir = milestoneDirName('M001');
    expect(dir).toBe('M001-example-milestone');
    expect(existsSync(join(root, '.pitway', 'milestones', dir, 'verification-results.yaml'))).toBe(true);
    expect(existsSync(join(root, '.pitway', 'milestones', dir, 'usage.yaml'))).toBe(true);
  });

  it('carries only the bare id in state.yaml, contract frontmatter, and tasks — never the slug', async () => {
    const { contract, tasks } = writeInputs(root);
    const { error } = await run(['milestone-add', '--contract', contract, '--tasks', tasks], root);
    expect(error).toBeUndefined();

    const dir = milestoneDirName('M001');
    expect(dir).not.toBe('M001');

    const state = loadState(root);
    expect(state.active_milestone).toBe('M001');
    expect(state.milestones).toEqual(['M001']);

    const created = loadContract(root, 'M001');
    expect(created.frontmatter.id).toBe('M001');

    const createdTasks = loadTasks(root, 'M001');
    for (const t of createdTasks.tasks) {
      expect(t.depends_on.every((d) => !d.includes('-'))).toBe(true);
    }
  });

  it('writes the requirement artifact and links it when --requirement is given', async () => {
    const { contract, tasks } = writeInputs(root);
    const requirement = join(root, 'req.md');
    writeFileSync(requirement, '# Requirement\n\nDo the thing.\n');
    const { error } = await run(
      ['milestone-add', '--contract', contract, '--tasks', tasks, '--requirement', requirement],
      root,
    );
    expect(error).toBeUndefined();
    expect(readFileSync(join(root, '.pitway', 'requirements', 'R001.md'), 'utf8')).toContain(
      'Do the thing.',
    );
    expect(loadContract(root, 'M001').frontmatter.requirement).toBe('R001');
  });

  it('validates before writing: bad dependency reference leaves .pitway/ unchanged', async () => {
    const { contract } = writeInputs(root);
    const badTasks = join(root, 'bad-tasks.yaml');
    writeFileSync(badTasks, TASKS_FIXTURE.replace('depends_on: []', 'depends_on: [T999]'));
    const { error } = await run(['milestone-add', '--contract', contract, '--tasks', badTasks], root);
    expect(error?.message).toMatch(/T999/);
    expect(existsSync(join(root, '.pitway', 'milestones', 'M001'))).toBe(false);
    expect(loadState(root).milestones).toEqual([]);
  });

  it('validates CT-to-AC criterion references', async () => {
    const badContract = join(root, 'bad-contract.md');
    writeFileSync(badContract, CONTRACT_FIXTURE.replace('criterion: AC001', 'criterion: AC999'));
    const { tasks } = writeInputs(root);
    const { error } = await run(['milestone-add', '--contract', badContract, '--tasks', tasks], root);
    expect(error?.message).toMatch(/AC999/);
    expect(existsSync(join(root, '.pitway', 'milestones', 'M001'))).toBe(false);
  });

  it('refuses while the active milestone is non-terminal', async () => {
    const { contract, tasks } = writeInputs(root);
    await run(['milestone-add', '--contract', contract, '--tasks', tasks], root);
    const { error } = await run(['milestone-add', '--contract', contract, '--tasks', tasks], root);
    expect(error?.message).toMatch(/M001/);
    expect(loadState(root).milestones).toEqual(['M001']);
  });

  it('refuses when the next id directory exists unregistered (bare)', async () => {
    const { contract, tasks } = writeInputs(root);
    mkdirSync(join(root, '.pitway', 'milestones', 'M001'), { recursive: true });
    const { error } = await run(['milestone-add', '--contract', contract, '--tasks', tasks], root);
    expect(error?.message).toMatch(/M001/);
    expect(loadState(root).milestones).toEqual([]);
  });

  it('refuses when the next id directory exists unregistered (slugged)', async () => {
    const { contract, tasks } = writeInputs(root);
    mkdirSync(join(root, '.pitway', 'milestones', 'M001-stale-draft'), { recursive: true });
    const { error } = await run(['milestone-add', '--contract', contract, '--tasks', tasks], root);
    expect(error?.message).toMatch(/M001/);
    expect(loadState(root).milestones).toEqual([]);
  });

  it('grandfathers a pre-existing bare directory: a milestone created bare still resolves correctly', async () => {
    // Simulates an M001-M005-style bare directory that predates slugging —
    // milestone-add's own createMilestone path always slugs new directories,
    // so grandfathering is tested by hand-creating the bare directory and
    // confirming loads through it still work via the standard store API.
    mkdirSync(join(root, '.pitway', 'milestones', 'M001'), { recursive: true });
    writeFileSync(
      join(root, '.pitway', 'milestones', 'M001', 'tasks.yaml'),
      'schema_version: 1\ntasks: []\n',
    );
    expect(loadTasks(root, 'M001')).toEqual({ schema_version: 1, tasks: [] });
  });
});
