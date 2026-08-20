import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveContract, saveState, saveTasks } from '../../src/state/store.js';
import { buildCli } from '../../src/cli/index.js';
import { registerResumeCommand } from '../../src/cli/commands/resume.js';
import { deterministicBranchName } from '../../src/core/milestones/confirm.js';
import type { ContractFrontmatter, Task } from '../../src/state/schemas.js';

let root: string;

// base_branch omitted by default -- the exact shape every historical
// contract.md has (M012/T004): the field is absent, not merely null.
function frontmatter(
  status: ContractFrontmatter['status'],
  opts: { base_branch?: string; base_revision?: string } = {},
): ContractFrontmatter {
  return {
    schema_version: 1,
    id: 'M001',
    title: 'Test Milestone',
    status,
    requirement: null,
    confirmed_at: null,
    verification_approved_hash: null,
    acceptance_criteria: [{ id: 'AC001', text: 'x' }],
    verification: [{ id: 'CT001', criterion: 'AC001', type: 'command', command: 'npm test' }],
    ...opts,
  };
}

function task(overrides: Partial<Task> & Pick<Task, 'id' | 'status'>): Task {
  return {
    objective: 'x',
    depends_on: [],
    acceptance_criteria: ['x'],
    relevant_files: [],
    verification: { strategy: 'tdd', detail: 'npm test' },
    result: null,
    usage: null,
    ...overrides,
  };
}

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pitway-resume-'));
  // buildResumeView reads the git-invisible journal (for pending
  // quick-changes, AC003) via resolvePitwayJournalPath, which requires a
  // real git repository. M012/T004's branch surfacing additionally calls
  // currentBranch (git rev-parse --abbrev-ref HEAD), which fails on a
  // genuinely unborn HEAD -- an initial commit makes it resolvable for
  // every test in this file, not just the new branch ones.
  git(['init', '-q'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  writeFileSync(join(root, 'README.md'), 'seed\n');
  git(['add', 'README.md'], root);
  git(['commit', '-q', '-m', 'init'], root);
  mkdirSync(join(root, '.pitway', 'milestones', 'M001'), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('pitway resume', () => {
  it('reports no active milestone gracefully when none is set', async () => {
    saveState(root, { schema_version: 1, active_milestone: null, milestones: [] });
    const program = buildCli();
    const lines: string[] = [];
    registerResumeCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'resume', '--json']);

    const view = JSON.parse(lines.join('\n'));
    expect(view.activeMilestone).toBeNull();
    expect(view.nextTask).toBeNull();
  });

  it('reconstructs milestone/task state and picks the lowest ready task id deterministically', async () => {
    saveState(root, { schema_version: 1, active_milestone: 'M001', milestones: ['M001'] });
    saveContract(root, 'M001', { frontmatter: frontmatter('in_progress'), body: '\n' });
    // T004 appears before T002 in declared order to prove the pick is by id,
    // not array position.
    saveTasks(root, 'M001', {
      schema_version: 1,
      tasks: [
        task({ id: 'T004', status: 'ready' }),
        task({ id: 'T002', status: 'ready' }),
        task({ id: 'T001', status: 'completed' }),
        task({ id: 'T003', status: 'waiting' }),
        task({ id: 'T005', status: 'blocked' }),
      ],
    });

    const program = buildCli();
    const lines: string[] = [];
    registerResumeCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'resume', '--json']);

    const view = JSON.parse(lines.join('\n'));
    expect(view.activeMilestone).toBe('M001');
    expect(view.contractStatus).toBe('in_progress');
    expect(view.tasks).toHaveLength(5);
    expect(view.ready.sort()).toEqual(['T002', 'T004']);
    expect(view.waiting).toEqual(['T003']);
    expect(view.blocked).toEqual(['T005']);
    expect(view.nextTask).toBe('T002');
  });

  it('reports null next task when no task is ready', async () => {
    saveState(root, { schema_version: 1, active_milestone: 'M001', milestones: ['M001'] });
    saveContract(root, 'M001', { frontmatter: frontmatter('in_progress'), body: '\n' });
    saveTasks(root, 'M001', {
      schema_version: 1,
      tasks: [task({ id: 'T001', status: 'waiting' })],
    });

    const program = buildCli();
    const lines: string[] = [];
    registerResumeCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'resume', '--json']);

    expect(JSON.parse(lines.join('\n')).nextTask).toBeNull();
  });

  it('reports an in_progress task as the continuation target and suppresses the ready recommendation (AC010)', async () => {
    saveState(root, { schema_version: 1, active_milestone: 'M001', milestones: ['M001'] });
    saveContract(root, 'M001', { frontmatter: frontmatter('in_progress'), body: '\n' });
    // T003 (ready, lower id) is declared before T002 (in_progress) to prove
    // the in_progress task wins regardless of declared order or id ordering.
    saveTasks(root, 'M001', {
      schema_version: 1,
      tasks: [
        task({ id: 'T003', status: 'ready' }),
        task({ id: 'T002', status: 'in_progress' }),
        task({ id: 'T001', status: 'completed' }),
      ],
    });

    const program = buildCli();
    const lines: string[] = [];
    registerResumeCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'resume', '--json']);

    const view = JSON.parse(lines.join('\n'));
    expect(view.ready).toEqual(['T003']);
    expect(view.nextTask).toBe('T002');
  });

  it('omits the branch section entirely for a main-strategy (base_branch absent) milestone', async () => {
    saveState(root, { schema_version: 1, active_milestone: 'M001', milestones: ['M001'] });
    saveContract(root, 'M001', { frontmatter: frontmatter('in_progress'), body: '\n' });
    saveTasks(root, 'M001', { schema_version: 1, tasks: [task({ id: 'T001', status: 'ready' })] });

    const program = buildCli();
    const lines: string[] = [];
    registerResumeCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'resume', '--json']);

    const view = JSON.parse(lines.join('\n'));
    expect(view.branch).toBeUndefined();
    expect(JSON.stringify(view)).not.toMatch(/"branch"/);

    const humanProgram = buildCli();
    const humanLines: string[] = [];
    registerResumeCommand(humanProgram, { root, write: (s) => humanLines.push(s) });
    await humanProgram.parseAsync(['node', 'pitway', 'resume']);
    expect(humanLines.join('\n')).not.toMatch(/Branch/);
  });

  it('reports the tracked branch as matched when currently checked out on it (M012/T004)', async () => {
    const expected = deterministicBranchName('M001', 'Test Milestone');
    git(['checkout', '-b', expected], root);
    saveState(root, { schema_version: 1, active_milestone: 'M001', milestones: ['M001'] });
    saveContract(root, 'M001', {
      frontmatter: frontmatter('in_progress', { base_branch: 'main', base_revision: 'abc123' }),
      body: '\n',
    });
    saveTasks(root, 'M001', { schema_version: 1, tasks: [task({ id: 'T001', status: 'ready' })] });

    const program = buildCli();
    const lines: string[] = [];
    registerResumeCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'resume', '--json']);

    const view = JSON.parse(lines.join('\n'));
    expect(view.branch).toEqual({ expected, actual: expected, matches: true });

    const humanProgram = buildCli();
    const humanLines: string[] = [];
    registerResumeCommand(humanProgram, { root, write: (s) => humanLines.push(s) });
    await humanProgram.parseAsync(['node', 'pitway', 'resume']);
    expect(humanLines.join('\n')).toMatch(new RegExp(`Branch: ${expected} \\(tracked`));
  });

  it('reports a branch mismatch without checking anything out itself (M012/T004)', async () => {
    const expected = deterministicBranchName('M001', 'Test Milestone');
    // Still on the initial branch (never created/checked out `expected`).
    const actual = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root })
      .toString()
      .trim();
    saveState(root, { schema_version: 1, active_milestone: 'M001', milestones: ['M001'] });
    saveContract(root, 'M001', {
      frontmatter: frontmatter('in_progress', { base_branch: 'main', base_revision: 'abc123' }),
      body: '\n',
    });
    saveTasks(root, 'M001', { schema_version: 1, tasks: [task({ id: 'T001', status: 'ready' })] });

    const program = buildCli();
    const lines: string[] = [];
    registerResumeCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'resume', '--json']);

    const view = JSON.parse(lines.join('\n'));
    expect(view.branch).toEqual({ expected, actual, matches: false });
    expect(execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root }).toString().trim()).toBe(
      actual,
    );

    const humanProgram = buildCli();
    const humanLines: string[] = [];
    registerResumeCommand(humanProgram, { root, write: (s) => humanLines.push(s) });
    await humanProgram.parseAsync(['node', 'pitway', 'resume']);
    expect(humanLines.join('\n')).toMatch(/Branch mismatch: expected .* — switch manually/);
  });
});

// AC002 (M013/T002): task name id-fallback, both human and --json.
describe('pitway resume task name rendering (M013/T002)', () => {
  it('renders a task with name set, in both human and --json output', async () => {
    saveState(root, { schema_version: 1, active_milestone: 'M001', milestones: ['M001'] });
    saveContract(root, 'M001', { frontmatter: frontmatter('in_progress'), body: '\n' });
    saveTasks(root, 'M001', {
      schema_version: 1,
      tasks: [task({ id: 'T001', name: 'Config schema for branch_strategy', status: 'ready' })],
    });

    const jsonProgram = buildCli();
    const jsonLines: string[] = [];
    registerResumeCommand(jsonProgram, { root, write: (s) => jsonLines.push(s) });
    await jsonProgram.parseAsync(['node', 'pitway', 'resume', '--json']);
    const view = JSON.parse(jsonLines.join('\n'));
    expect(view.tasks).toEqual([{ id: 'T001', name: 'Config schema for branch_strategy', status: 'ready' }]);

    const humanProgram = buildCli();
    const humanLines: string[] = [];
    registerResumeCommand(humanProgram, { root, write: (s) => humanLines.push(s) });
    await humanProgram.parseAsync(['node', 'pitway', 'resume']);
    expect(humanLines.join('\n')).toContain('  T001  Config schema for branch_strategy  ◌ Ready');
  });

  it('falls back to the bare id, byte-identical to pre-M013 output, when name is absent', async () => {
    saveState(root, { schema_version: 1, active_milestone: 'M001', milestones: ['M001'] });
    saveContract(root, 'M001', { frontmatter: frontmatter('in_progress'), body: '\n' });
    saveTasks(root, 'M001', {
      schema_version: 1,
      tasks: [task({ id: 'T001', status: 'ready' })],
    });

    const jsonProgram = buildCli();
    const jsonLines: string[] = [];
    registerResumeCommand(jsonProgram, { root, write: (s) => jsonLines.push(s) });
    await jsonProgram.parseAsync(['node', 'pitway', 'resume', '--json']);
    const view = JSON.parse(jsonLines.join('\n'));
    expect(view.tasks).toEqual([{ id: 'T001', name: null, status: 'ready' }]);

    const humanProgram = buildCli();
    const humanLines: string[] = [];
    registerResumeCommand(humanProgram, { root, write: (s) => humanLines.push(s) });
    await humanProgram.parseAsync(['node', 'pitway', 'resume']);
    expect(humanLines.join('\n')).toContain('  T001  ◌ Ready');
  });
});
