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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCli } from '../../src/cli/index.js';
import { registerInitCommand } from '../../src/cli/commands/init.js';
import { registerMilestoneAddCommand } from '../../src/cli/commands/milestone-add.js';
import { registerMilestoneConfirmCommand } from '../../src/cli/commands/milestone-confirm.js';
import {
  loadContract,
  loadState,
  loadTasks,
  loadUsage,
  loadVerificationResults,
  saveContract,
  saveState,
} from '../../src/state/store.js';

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

const REPLACEMENT_CONTRACT_FIXTURE = `---
schema_version: 1
id: M999
title: Replaced milestone
status: confirmed
requirement: null
confirmed_at: 2026-01-01T00:00:00Z
verification_approved_hash: null
acceptance_criteria:
  - id: AC002
    text: Replaced behavior holds.
verification:
  - id: CT002
    criterion: AC002
    type: command
    command: npm run replaced
---

# Contract

## Objective

Replaced example.

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

const REPLACEMENT_TASKS_FIXTURE = `schema_version: 1
tasks:
  - id: T002
    objective: Do the replaced work.
    status: in_progress
    depends_on: []
    acceptance_criteria:
      - It still works
    relevant_files:
      - src/y.ts
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

function writeReplacementInputs(dir: string): { contract: string; tasks: string } {
  const contract = join(dir, 'replacement-contract.md');
  const tasks = join(dir, 'replacement-tasks.yaml');
  writeFileSync(contract, REPLACEMENT_CONTRACT_FIXTURE);
  writeFileSync(tasks, REPLACEMENT_TASKS_FIXTURE);
  return { contract, tasks };
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'pitway-madd-'));
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

  it('refuses an unreadable contract input path, naming the file', async () => {
    const { tasks } = writeInputs(root);
    const missing = join(root, 'does-not-exist.md');
    const { error } = await run(['milestone-add', '--contract', missing, '--tasks', tasks], root);
    expect(error?.message).toMatch(/cannot read contract file/);
    expect(loadState(root).milestones).toEqual([]);
  });

  it('refuses a contract file that does not parse as a contract', async () => {
    const badContract = join(root, 'bad-contract.md');
    writeFileSync(badContract, 'not a contract at all\n');
    const { tasks } = writeInputs(root);
    const { error } = await run(['milestone-add', '--contract', badContract, '--tasks', tasks], root);
    expect(error?.message).toMatch(/invalid contract/);
    expect(loadState(root).milestones).toEqual([]);
  });

  it('refuses malformed tasks YAML naming the file', async () => {
    const { contract } = writeInputs(root);
    const badTasks = join(root, 'bad-tasks.yaml');
    writeFileSync(badTasks, 'tasks: [unclosed\n  - broken');
    const { error } = await run(['milestone-add', '--contract', contract, '--tasks', badTasks], root);
    expect(error?.message).toMatch(/malformed YAML/);
    expect(loadState(root).milestones).toEqual([]);
  });

  it('refuses schema-invalid tasks (valid YAML, missing required fields)', async () => {
    const { contract } = writeInputs(root);
    const badTasks = join(root, 'schema-bad-tasks.yaml');
    writeFileSync(badTasks, 'schema_version: 1\ntasks:\n  - id: T001\n');
    const { error } = await run(['milestone-add', '--contract', contract, '--tasks', badTasks], root);
    expect(error?.message).toMatch(/invalid tasks/);
    expect(loadState(root).milestones).toEqual([]);
  });

  it('proceeds when the active milestone is terminal (cancelled), minting the next id', async () => {
    const { contract, tasks } = writeInputs(root);
    const first = await run(['milestone-add', '--contract', contract, '--tasks', tasks], root);
    expect(first.error).toBeUndefined();
    // The crash-recovery shape: a cancel that flipped the contract but never
    // reached the state write leaves active_milestone pointing at a
    // cancelled milestone. milestone-add treats terminal (cancelled or
    // completed) as no obstacle.
    const m1 = loadContract(root, 'M001');
    saveContract(root, 'M001', {
      frontmatter: { ...m1.frontmatter, status: 'cancelled' },
      body: m1.body,
    });
    const second = await run(['milestone-add', '--contract', contract, '--tasks', tasks], root);
    expect(second.error).toBeUndefined();
    const state = loadState(root);
    expect(state.milestones).toEqual(['M001', 'M002']);
    expect(state.active_milestone).toBe('M002');
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

describe('pitway milestone-add --replace (AC001)', () => {
  it('refuses once the draft has been confirmed, pointing at milestone-confirm --amend', async () => {
    const { contract, tasks } = writeInputs(root);
    const added = await run(['milestone-add', '--contract', contract, '--tasks', tasks], root);
    expect(added.error).toBeUndefined();
    rmSync(contract);
    rmSync(tasks);
    const confirmed = await run(['milestone-confirm', 'M001'], root);
    expect(confirmed.error).toBeUndefined();

    const repl = writeReplacementInputs(root);
    const { error } = await run(
      ['milestone-add', '--replace', 'M001', '--contract', repl.contract, '--tasks', repl.tasks],
      root,
    );
    expect(error?.message).toMatch(/--amend/);
    expect(loadContract(root, 'M001').frontmatter.title).toBe('Example milestone');
  });

  it('overwrites the draft in place under the same id, with no git operation, resetting tasks/results/usage', async () => {
    const { contract, tasks } = writeInputs(root);
    const added = await run(['milestone-add', '--contract', contract, '--tasks', tasks], root);
    expect(added.error).toBeUndefined();
    const before = commitCount(root);

    const repl = writeReplacementInputs(root);
    const { error } = await run(
      ['milestone-add', '--replace', 'M001', '--contract', repl.contract, '--tasks', repl.tasks],
      root,
    );
    expect(error).toBeUndefined();
    expect(commitCount(root)).toBe(before);

    const state = loadState(root);
    expect(state.milestones).toEqual(['M001']);
    expect(state.active_milestone).toBe('M001');

    const replaced = loadContract(root, 'M001');
    expect(replaced.frontmatter.id).toBe('M001');
    expect(replaced.frontmatter.title).toBe('Replaced milestone');
    expect(replaced.frontmatter.status).toBe('draft');
    expect(replaced.frontmatter.confirmed_at).toBeNull();
    expect(replaced.frontmatter.verification_approved_hash).toBeNull();
    expect(replaced.frontmatter.acceptance_criteria.map((c) => c.id)).toEqual(['AC002']);

    const replacedTasks = loadTasks(root, 'M001');
    expect(replacedTasks.tasks).toHaveLength(1);
    expect(replacedTasks.tasks[0]!.id).toBe('T002');
    expect(replacedTasks.tasks[0]!.status).toBe('planned');
    expect(replacedTasks.tasks[0]!.result).toBeNull();

    expect(loadVerificationResults(root, 'M001')).toEqual({ schema_version: 1, results: [] });
    expect(loadUsage(root, 'M001')).toEqual({ schema_version: 1, planning: null, qa: null });
  });

  it('preserves the currently materialized requirement id when --requirement is omitted', async () => {
    const { contract, tasks } = writeInputs(root);
    const requirement = join(root, 'req.md');
    writeFileSync(requirement, '# Requirement\n\nOriginal.\n');
    const added = await run(
      ['milestone-add', '--contract', contract, '--tasks', tasks, '--requirement', requirement],
      root,
    );
    expect(added.error).toBeUndefined();
    expect(loadContract(root, 'M001').frontmatter.requirement).toBe('R001');

    const repl = writeReplacementInputs(root);
    const { error } = await run(
      ['milestone-add', '--replace', 'M001', '--contract', repl.contract, '--tasks', repl.tasks],
      root,
    );
    expect(error).toBeUndefined();
    expect(loadContract(root, 'M001').frontmatter.requirement).toBe('R001');
    expect(readFileSync(join(root, '.pitway', 'requirements', 'R001.md'), 'utf8')).toContain('Original.');
  });

  it('re-activates a draft left non-active (interrupted prior correction) when replacing it', async () => {
    const { contract, tasks } = writeInputs(root);
    const added = await run(['milestone-add', '--contract', contract, '--tasks', tasks], root);
    expect(added.error).toBeUndefined();
    // Crash-recovery shape: state.yaml no longer points at the draft.
    saveState(root, { ...loadState(root), active_milestone: null });

    const repl = writeReplacementInputs(root);
    const { error } = await run(
      ['milestone-add', '--replace', 'M001', '--contract', repl.contract, '--tasks', repl.tasks],
      root,
    );
    expect(error).toBeUndefined();
    expect(loadState(root).active_milestone).toBe('M001');
    expect(loadContract(root, 'M001').frontmatter.title).toBe('Replaced milestone');
  });

  it('creates a fresh requirement when --requirement is supplied, leaving the prior one on disk', async () => {
    const { contract, tasks } = writeInputs(root);
    const requirement = join(root, 'req.md');
    writeFileSync(requirement, '# Requirement\n\nOriginal.\n');
    const added = await run(
      ['milestone-add', '--contract', contract, '--tasks', tasks, '--requirement', requirement],
      root,
    );
    expect(added.error).toBeUndefined();

    const repl = writeReplacementInputs(root);
    const newRequirement = join(root, 'req2.md');
    writeFileSync(newRequirement, '# Requirement\n\nUpdated.\n');
    const { error } = await run(
      [
        'milestone-add',
        '--replace',
        'M001',
        '--contract',
        repl.contract,
        '--tasks',
        repl.tasks,
        '--requirement',
        newRequirement,
      ],
      root,
    );
    expect(error).toBeUndefined();
    expect(loadContract(root, 'M001').frontmatter.requirement).toBe('R002');
    expect(readFileSync(join(root, '.pitway', 'requirements', 'R001.md'), 'utf8')).toContain('Original.');
    expect(readFileSync(join(root, '.pitway', 'requirements', 'R002.md'), 'utf8')).toContain('Updated.');
  });
});

// The default CommandDeps fallbacks (deps.write ?? console.log,
// deps.root ?? process.cwd()) are only reached when a caller registers the
// command with no overrides -- the real shape a bare `pitway milestone-add`
// invocation takes outside this test file's harness. process.chdir into the
// fixture root keeps this from ever touching the real repository's state.
describe('pitway milestone-add default CommandDeps fallbacks', () => {
  it('falls back to console.log and process.cwd() when no overrides are given', async () => {
    const { contract, tasks } = writeInputs(root);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cwdBefore = process.cwd();
    process.chdir(root);
    let caught: unknown;
    let calls: unknown[][] = [];
    try {
      const program = buildCli();
      registerMilestoneAddCommand(program);
      await program.parseAsync(['node', 'pitway', 'milestone-add', '--contract', contract, '--tasks', tasks]);
    } catch (error) {
      caught = error;
    } finally {
      calls = logSpy.mock.calls;
      process.chdir(cwdBefore);
      logSpy.mockRestore();
    }

    expect(caught).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toMatch(/🏁 Created milestone M001 "Example milestone" as draft\./);
  });
});
