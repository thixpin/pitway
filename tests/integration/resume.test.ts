import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadConfig,
  saveBacklog,
  saveConfig,
  saveContract,
  saveReviews,
  saveState,
  saveTasks,
  saveVerificationResults,
} from '../../src/state/store.js';
import { appendQuickChangeRecord, appendWorktreeIntegrateRecord } from '../../src/state/journal.js';
import { buildCli } from '../../src/cli/index.js';
import { registerInitCommand } from '../../src/cli/commands/init.js';
import { registerMilestoneAddCommand } from '../../src/cli/commands/milestone-add.js';
import { registerMilestoneConfirmCommand } from '../../src/cli/commands/milestone-confirm.js';
import { registerTaskUpdateCommand } from '../../src/cli/commands/task-update.js';
import { registerResumeCommand } from '../../src/cli/commands/resume.js';
import { deterministicBranchName } from '../../src/core/milestones/confirm.js';
import { dispatchTask } from '../../src/core/tasks/dispatch.js';
import { createTaskWorktree } from '../../src/git/worktree.js';
import { installDriverAssets, resolveDriverAssets } from '../../src/state/driver-assets.js';
import type { ParallelView } from '../../src/cli/commands/resume.js';
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
  // Real milestone-add-created repos always carry config.yaml (init writes
  // it); buildResumeView reads it for the execution strategy (M014/T008).
  writeFileSync(join(root, '.pitway', 'config.yaml'), 'schema_version: 1\n');
  // M013/T005: buildResumeView now also derives the racing footer, which
  // reads verification-results.yaml via the shared status helper -- present
  // (empty) on every real milestone-add-created milestone; matched here so
  // this hand-built fixture reflects that, the same way real milestones do.
  saveVerificationResults(root, 'M001', { schema_version: 1, results: [] });
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

// M018/T004 (AC007): pendingBacklogItems mirrors pendingQuickChanges's own
// coverage exactly -- present in both --json and human output, and
// unaffected by which milestone is active (root-level, not milestone-scoped).
describe('pitway resume pendingBacklogItems (M018/T004)', () => {
  it('omits the block when no backlog items are pending, in both --json and human output', async () => {
    saveState(root, { schema_version: 1, active_milestone: null, milestones: [] });

    const program = buildCli();
    const lines: string[] = [];
    registerResumeCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'resume', '--json']);
    const view = JSON.parse(lines.join('\n'));
    expect(view.pendingBacklogItems).toEqual([]);

    const humanLines: string[] = [];
    const humanProgram = buildCli();
    registerResumeCommand(humanProgram, { root, write: (s) => humanLines.push(s) });
    await humanProgram.parseAsync(['node', 'pitway', 'resume']);
    expect(humanLines.join('\n')).not.toContain('Pending backlog items');
  });

  it('lists pending items (id/title only) and excludes promoted/archived ones, in both --json and human output', async () => {
    saveState(root, { schema_version: 1, active_milestone: 'M001', milestones: ['M001'] });
    saveContract(root, 'M001', { frontmatter: frontmatter('in_progress'), body: '\n' });
    saveTasks(root, 'M001', { schema_version: 1, tasks: [task({ id: 'T001', status: 'ready' })] });
    saveBacklog(root, {
      schema_version: 1,
      items: [
        {
          id: 'B001',
          title: 'Pending one',
          reason: 'r',
          status: 'pending',
          source: { milestone: 'M001', task: null },
          created_at: '2026-08-21T00:00:00Z',
          resolved_at: null,
          promoted_to: null,
          archived_reason: null,
        },
        {
          id: 'B002',
          title: 'Already archived',
          reason: 'r',
          status: 'archived',
          source: { milestone: 'M001', task: null },
          created_at: '2026-08-21T00:00:00Z',
          resolved_at: '2026-08-21T01:00:00Z',
          promoted_to: null,
          archived_reason: 'no longer relevant',
        },
      ],
    });

    const program = buildCli();
    const lines: string[] = [];
    registerResumeCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'resume', '--json']);
    const view = JSON.parse(lines.join('\n'));
    expect(view.pendingBacklogItems).toEqual([{ id: 'B001', title: 'Pending one' }]);

    const humanLines: string[] = [];
    const humanProgram = buildCli();
    registerResumeCommand(humanProgram, { root, write: (s) => humanLines.push(s) });
    await humanProgram.parseAsync(['node', 'pitway', 'resume']);
    const human = humanLines.join('\n');
    expect(human).toContain('Pending backlog items (1)');
    expect(human).toContain('B001');
    expect(human).not.toContain('B002');
  });
});

// M035/T001: driver configuration-drift detection -- advisory only, never
// blocking, never mutating. Computed independent of the active milestone,
// like pendingBacklogItems above.
describe('pitway resume driver configuration drift (M035/T001)', () => {
  it('omits the block when no driver is installed, in both --json and human output', async () => {
    saveState(root, { schema_version: 1, active_milestone: null, milestones: [] });

    const program = buildCli();
    const lines: string[] = [];
    registerResumeCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'resume', '--json']);
    const view = JSON.parse(lines.join('\n'));
    expect(view.driverDrift).toBeUndefined();

    const humanLines: string[] = [];
    const humanProgram = buildCli();
    registerResumeCommand(humanProgram, { root, write: (s) => humanLines.push(s) });
    await humanProgram.parseAsync(['node', 'pitway', 'resume']);
    expect(humanLines.join('\n')).not.toContain('Configuration drift');
  });

  it('omits the block when an installed driver is fully up to date', async () => {
    saveState(root, { schema_version: 1, active_milestone: null, milestones: [] });
    installDriverAssets(root, 'claude');

    const program = buildCli();
    const lines: string[] = [];
    registerResumeCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'resume', '--json']);
    const view = JSON.parse(lines.join('\n'));
    expect(view.driverDrift).toBeUndefined();
  });

  it('detects drift when an installed driver has a conflicting asset, and suggests a bare reconfigure', async () => {
    saveState(root, { schema_version: 1, active_milestone: null, milestones: [] });
    installDriverAssets(root, 'claude');
    const assets = resolveDriverAssets('claude');
    writeFileSync(join(root, '.claude', assets[0]!), 'hand-edited or stale\n');

    const program = buildCli();
    const lines: string[] = [];
    registerResumeCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'resume', '--json']);
    const view = JSON.parse(lines.join('\n'));
    expect(view.driverDrift).toEqual({ drivers: ['claude'], suggestedCommand: 'pitway init --reconfigure' });

    const humanLines: string[] = [];
    const humanProgram = buildCli();
    registerResumeCommand(humanProgram, { root, write: (s) => humanLines.push(s) });
    await humanProgram.parseAsync(['node', 'pitway', 'resume']);
    const human = humanLines.join('\n');
    expect(human).toContain('Configuration drift');
    expect(human).toContain('claude');
    expect(human).toContain('pitway init --reconfigure');
  });

  it('appends --no-claude when only a non-claude driver has drift and claude was never installed', async () => {
    saveState(root, { schema_version: 1, active_milestone: null, milestones: [] });
    installDriverAssets(root, 'codex');
    const assets = resolveDriverAssets('codex');
    writeFileSync(join(root, '.codex', assets[0]!), 'stale\n');

    const program = buildCli();
    const lines: string[] = [];
    registerResumeCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'resume', '--json']);
    const view = JSON.parse(lines.join('\n'));
    expect(view.driverDrift).toEqual({
      drivers: ['codex'],
      suggestedCommand: 'pitway init --reconfigure --no-claude',
    });
  });

  it('omits --no-claude when claude is installed even if only another driver has drift', async () => {
    saveState(root, { schema_version: 1, active_milestone: null, milestones: [] });
    installDriverAssets(root, 'claude');
    installDriverAssets(root, 'codex');
    const assets = resolveDriverAssets('codex');
    writeFileSync(join(root, '.codex', assets[0]!), 'stale\n');

    const program = buildCli();
    const lines: string[] = [];
    registerResumeCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'resume', '--json']);
    const view = JSON.parse(lines.join('\n'));
    expect(view.driverDrift).toEqual({ drivers: ['codex'], suggestedCommand: 'pitway init --reconfigure' });
  });

  it('lists multiple drifted drivers together in one advisory', async () => {
    saveState(root, { schema_version: 1, active_milestone: null, milestones: [] });
    installDriverAssets(root, 'claude');
    installDriverAssets(root, 'codex');
    writeFileSync(join(root, '.claude', resolveDriverAssets('claude')[0]!), 'stale\n');
    writeFileSync(join(root, '.codex', resolveDriverAssets('codex')[0]!), 'stale\n');

    const program = buildCli();
    const lines: string[] = [];
    registerResumeCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'resume', '--json']);
    const view = JSON.parse(lines.join('\n'));
    expect([...view.driverDrift.drivers].sort()).toEqual(['claude', 'codex']);
  });

  it('does not block resume or touch the stale file itself -- advisory only', async () => {
    saveState(root, { schema_version: 1, active_milestone: null, milestones: [] });
    installDriverAssets(root, 'claude');
    const assets = resolveDriverAssets('claude');
    writeFileSync(join(root, '.claude', assets[0]!), 'stale\n');

    const program = buildCli();
    const lines: string[] = [];
    registerResumeCommand(program, { root, write: (s) => lines.push(s) });
    await expect(program.parseAsync(['node', 'pitway', 'resume', '--json'])).resolves.not.toThrow();
    expect(readFileSync(join(root, '.claude', assets[0]!), 'utf8')).toBe('stale\n');
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

// AC004 (M013/T005): the racing footer, wired into resume.
describe('pitway resume racing footer (M013/T005)', () => {
  it('is entirely absent (not blank) for a draft milestone', async () => {
    saveState(root, { schema_version: 1, active_milestone: 'M001', milestones: ['M001'] });
    saveContract(root, 'M001', { frontmatter: frontmatter('draft'), body: '\n' });
    saveTasks(root, 'M001', { schema_version: 1, tasks: [task({ id: 'T001', status: 'planned' })] });

    const jsonProgram = buildCli();
    const jsonLines: string[] = [];
    registerResumeCommand(jsonProgram, { root, write: (s) => jsonLines.push(s) });
    await jsonProgram.parseAsync(['node', 'pitway', 'resume', '--json']);
    expect(JSON.parse(jsonLines.join('\n')).footer).toBeNull();

    const humanProgram = buildCli();
    const humanLines: string[] = [];
    registerResumeCommand(humanProgram, { root, write: (s) => humanLines.push(s) });
    await humanProgram.parseAsync(['node', 'pitway', 'resume']);
    // The footer's own shape (a workload % followed by the count segment) is
    // unique -- unlike a bare 🏁, which also appears in the header line.
    expect(humanLines.join('\n')).not.toMatch(/\d+% · ✅/);
  });

  it('renders the footer as the final line once confirmed', async () => {
    saveState(root, { schema_version: 1, active_milestone: 'M001', milestones: ['M001'] });
    saveContract(root, 'M001', { frontmatter: frontmatter('in_progress'), body: '\n' });
    saveTasks(root, 'M001', {
      schema_version: 1,
      tasks: [task({ id: 'T001', status: 'completed' }), task({ id: 'T002', status: 'ready' })],
    });

    const jsonProgram = buildCli();
    const jsonLines: string[] = [];
    registerResumeCommand(jsonProgram, { root, write: (s) => jsonLines.push(s) });
    await jsonProgram.parseAsync(['node', 'pitway', 'resume', '--json']);
    expect(JSON.parse(jsonLines.join('\n')).footer).toBe('🏎️ 48% · ✅ 1/2 · Next: T002');

    const humanProgram = buildCli();
    const humanLines: string[] = [];
    registerResumeCommand(humanProgram, { root, write: (s) => humanLines.push(s) });
    await humanProgram.parseAsync(['node', 'pitway', 'resume']);
    const lines = humanLines.join('\n').split('\n');
    expect(lines[lines.length - 1]).toBe('🏎️ 48% · ✅ 1/2 · Next: T002');
  });
});

// Developer directive (2026-08-20, during M014): the racing footer is a
// separate, permanent, single-line status element -- only progress/status
// information, never concatenated with narration, task-lifecycle messages,
// or anything else. Task-name gates render as their own ` · ` segment.
describe('pitway resume footer output separation (M014 driver-output directive)', () => {
  it('renders the footer blank-line-separated, exactly once, single-line, with the name segment', async () => {
    saveState(root, { schema_version: 1, active_milestone: 'M001', milestones: ['M001'] });
    saveContract(root, 'M001', { frontmatter: frontmatter('in_progress'), body: '\n' });
    saveTasks(root, 'M001', {
      schema_version: 1,
      tasks: [
        task({ id: 'T001', status: 'completed' }),
        task({ id: 'T002', status: 'ready', name: 'fail-closed worktree state guard' }),
      ],
    });

    const program = buildCli();
    const lines: string[] = [];
    registerResumeCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'resume']);
    const output = lines.join('\n');
    const outputLines = output.split('\n');
    const last = outputLines[outputLines.length - 1]!;

    // Single concise line: icon, workload %, exact count, gate (+ name).
    expect(last).toBe('🏎️ 48% · ✅ 1/2 · Next: T002 · fail-closed worktree state guard');
    // A separate element: blank line before it, nothing after it.
    expect(outputLines[outputLines.length - 2]).toBe('');
    // Exactly one footer-shaped line in the whole output -- the footer is
    // never concatenated into or duplicated by any narration line.
    const footerShaped = outputLines.filter((l) => /\d+% · ✅ \d+\/\d+/.test(l));
    expect(footerShaped).toEqual([last]);
    // Strict shape: nothing but progress/status segments.
    expect(last).toMatch(
      /^(🏎️|🏁|🔧) \d+% · ✅ \d+\/\d+ · (Complete|Next: (T\d{3}( · .+)?|verification|developer approval))$/,
    );
  });
});

// AC003: resume is the authoritative recovery view for pending
// quick-changes -- draft and approved records qualify; committed, cancelled,
// and promoted records never appear.
describe('pitway resume pending quick-changes (AC003)', () => {
  const qc = (
    id: string,
    status: 'draft' | 'approved' | 'committed' | 'cancelled' | 'promoted',
    objective: string,
    runs: Array<{ at: string; status: 'pass' | 'fail'; evidence: string }> = [],
  ): void => {
    appendQuickChangeRecord(root, {
      id,
      status,
      objective,
      scope: ['README.md'],
      verifyCommand: 'echo ok',
      ...(status === 'draft' ? {} : { approvedHash: `sha256:${'a'.repeat(64)}` }),
      runs,
    });
  };

  it('lists draft and approved records and excludes terminal ones, in both --json and human output', async () => {
    saveState(root, { schema_version: 1, active_milestone: 'M001', milestones: ['M001'] });
    saveContract(root, 'M001', { frontmatter: frontmatter('in_progress'), body: '\n' });
    saveTasks(root, 'M001', { schema_version: 1, tasks: [task({ id: 'T001', status: 'ready' })] });
    qc('qc-draft', 'draft', 'Fix a typo');
    qc('qc-approved', 'approved', 'Bump a dependency');
    qc('qc-promoted', 'promoted', 'Landed as a milestone', [
      { at: '2026-08-21T00:00:00Z', status: 'pass', evidence: 'ok' },
    ]);
    qc('qc-cancelled', 'cancelled', 'Abandoned');

    const program = buildCli();
    const lines: string[] = [];
    registerResumeCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'resume', '--json']);
    const view = JSON.parse(lines.join('\n'));
    expect(view.pendingQuickChanges).toEqual([
      { id: 'qc-draft', status: 'draft', objective: 'Fix a typo' },
      { id: 'qc-approved', status: 'approved', objective: 'Bump a dependency' },
    ]);

    const humanProgram = buildCli();
    const humanLines: string[] = [];
    registerResumeCommand(humanProgram, { root, write: (s) => humanLines.push(s) });
    await humanProgram.parseAsync(['node', 'pitway', 'resume']);
    const human = humanLines.join('\n');
    expect(human).toContain('🔧 Pending quick-changes');
    expect(human).toContain('  qc-draft  draft  Fix a typo');
    expect(human).toContain('  qc-approved  approved  Bump a dependency');
    expect(human).not.toContain('qc-promoted');
    expect(human).not.toContain('qc-cancelled');
  });

  it('shows pending quick-changes and backlog items even with no active milestone (human output)', async () => {
    saveState(root, { schema_version: 1, active_milestone: null, milestones: [] });
    qc('qc-open', 'draft', 'Still waiting');
    saveBacklog(root, {
      schema_version: 1,
      items: [
        {
          id: 'B001',
          title: 'Follow-up work',
          reason: 'r',
          status: 'pending',
          source: { milestone: 'M001', task: null },
          created_at: '2026-08-21T00:00:00Z',
          resolved_at: null,
          promoted_to: null,
          archived_reason: null,
        },
      ],
    });

    const program = buildCli();
    const lines: string[] = [];
    registerResumeCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'resume']);
    const human = lines.join('\n');
    expect(human).toContain('No active milestone. Run milestone-add to start one.');
    expect(human).toContain('🔧 Pending quick-changes');
    expect(human).toContain('  qc-open  draft  Still waiting');
    expect(human).toContain('🔧 Pending backlog items (1)');
    expect(human).toContain('  B001  Follow-up work');
  });
});

describe('pitway resume human continuation line (AC010)', () => {
  it("renders 'Continue: <id>' for an in_progress task instead of a Next recommendation", async () => {
    saveState(root, { schema_version: 1, active_milestone: 'M001', milestones: ['M001'] });
    saveContract(root, 'M001', { frontmatter: frontmatter('in_progress'), body: '\n' });
    saveTasks(root, 'M001', {
      schema_version: 1,
      tasks: [task({ id: 'T001', status: 'in_progress' }), task({ id: 'T002', status: 'ready' })],
    });

    const program = buildCli();
    const lines: string[] = [];
    registerResumeCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'resume']);
    const human = lines.join('\n');
    expect(human).toContain('Continue: T001');
    expect(human.split('\n').some((l) => l.startsWith('Next: '))).toBe(false);
  });
});

// AC006/T006 (M015): the open review session, surfaced by resume alone.
describe('pitway resume open review session (M015/T006)', () => {
  it('surfaces the open session with recorded/pending counts in --json and human output', async () => {
    saveState(root, { schema_version: 1, active_milestone: 'M001', milestones: ['M001'] });
    saveContract(root, 'M001', { frontmatter: frontmatter('in_progress'), body: '\n' });
    saveTasks(root, 'M001', { schema_version: 1, tasks: [task({ id: 'T001', status: 'ready' })] });
    saveReviews(root, 'M001', {
      schema_version: 1,
      sessions: [
        {
          id: 'rev-abc123',
          status: 'open',
          created_at: '2026-08-21T00:00:00Z',
          roles: ['developer', 'qa'],
          content_hash: `sha256:${'b'.repeat(64)}`,
          findings: [
            { role: 'developer', recorded_at: '2026-08-21T01:00:00Z', findings: [], usage: null },
          ],
          decision: null,
        },
      ],
    });

    const program = buildCli();
    const lines: string[] = [];
    registerResumeCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'resume', '--json']);
    const view = JSON.parse(lines.join('\n'));
    expect(view.openReview).toEqual({
      milestone: 'M001',
      sessionId: 'rev-abc123',
      roles: ['developer', 'qa'],
      recordedCount: 1,
      pendingCount: 1,
    });

    const humanProgram = buildCli();
    const humanLines: string[] = [];
    registerResumeCommand(humanProgram, { root, write: (s) => humanLines.push(s) });
    await humanProgram.parseAsync(['node', 'pitway', 'resume']);
    expect(humanLines.join('\n')).toContain(
      '📜 Open review rev-abc123 (M001) — roles: developer, qa — recorded 1/2',
    );
  });
});

// AC008 (M014/T008): the parallel view through resume's own CLI surface --
// active dispatches and each read-only residue class, in json and human
// output. Built on a real milestone-add/confirm fixture (dispatch requires
// a committed baseline), mirroring task-discard.test.ts's own setup.
describe('pitway resume parallel worktrees view (M014/T008)', () => {
  let proot: string;
  let pscratch: string;

  const PAR_CONTRACT = `---
schema_version: 1
id: M999
title: Parallel milestone
status: draft
requirement: null
confirmed_at: null
verification_approved_hash: null
acceptance_criteria:
  - id: AC001
    text: Behavior holds.
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: echo ok
---

# Contract

## Objective

Example.

## Change Log
`;

  const PAR_TASKS = `schema_version: 1
tasks:
  - id: T001
    objective: First independent task.
    status: planned
    depends_on: []
    acceptance_criteria:
      - It works
    context_files:
      - src/a.ts
    write_scope:
      - src/a.ts
    verification:
      strategy: tdd
      detail: npm test
    result: null
    usage: null
  - id: T002
    objective: Second independent task.
    status: planned
    depends_on: []
    acceptance_criteria:
      - It works
    context_files:
      - src/b.ts
    write_scope:
      - src/b.ts
    verification:
      strategy: tdd
      detail: npm test
    result: null
    usage: null
`;

  async function prun(args: string[]): Promise<{ lines: string[]; error?: Error }> {
    const program = buildCli();
    const lines: string[] = [];
    registerInitCommand(program, { root: proot, write: (s) => lines.push(s) });
    registerMilestoneAddCommand(program, { root: proot, write: (s) => lines.push(s) });
    registerMilestoneConfirmCommand(program, { root: proot, write: (s) => lines.push(s) });
    registerTaskUpdateCommand(program, { root: proot, write: (s) => lines.push(s) });
    registerResumeCommand(program, { root: proot, write: (s) => lines.push(s) });
    try {
      await program.parseAsync(['node', 'pitway', ...args]);
      return { lines };
    } catch (error) {
      return { lines, error: error as Error };
    }
  }

  async function resumeParallel(): Promise<ParallelView> {
    const result = await prun(['resume', '--json']);
    expect(result.error).toBeUndefined();
    const view = JSON.parse(result.lines.join('\n')) as { parallel: ParallelView | null };
    expect(view.parallel).not.toBeNull();
    return view.parallel!;
  }

  beforeEach(async () => {
    proot = mkdtempSync(join(tmpdir(), 'pitway-resume-par-'));
    pscratch = mkdtempSync(join(tmpdir(), 'pitway-resume-par-in-'));
    git(['init', '-q'], proot);
    git(['config', 'user.email', 'test@example.com'], proot);
    git(['config', 'user.name', 'Test'], proot);
    writeFileSync(join(proot, 'README.md'), 'seed\n');
    git(['add', 'README.md'], proot);
    git(['commit', '-q', '-m', 'init'], proot);
    await prun(['init', '--no-claude']);
    saveConfig(proot, { ...loadConfig(proot), execution: { strategy: 'parallel_worktrees' } });
    const contract = join(pscratch, 'contract.md');
    const tasks = join(pscratch, 'tasks.yaml');
    writeFileSync(contract, PAR_CONTRACT);
    writeFileSync(tasks, PAR_TASKS);
    expect((await prun(['milestone-add', '--contract', contract, '--tasks', tasks])).error).toBeUndefined();
    expect((await prun(['milestone-confirm', 'M001'])).error).toBeUndefined();
  });

  afterEach(() => {
    rmSync(proot, { recursive: true, force: true });
    rmSync(pscratch, { recursive: true, force: true });
  });

  it('renders active dispatches in --json and the human 🏎️ section, with no residues', async () => {
    const dispatched = dispatchTask(proot, 'T001');
    const parallel = await resumeParallel();
    expect(parallel.activeDispatches).toEqual([
      { taskId: 'T001', branch: 'pitway/task/M001-T001', worktreePath: dispatched.worktreePath },
    ]);
    expect(parallel.residues).toEqual([]);

    const human = await prun(['resume']);
    const out = human.lines.join('\n');
    expect(out).toContain('🏎️ Dispatched worktrees');
    expect(out).toContain(`  T001  pitway/task/M001-T001  ${dispatched.worktreePath}`);
    expect(out).not.toContain('Worktree residues');
  });

  it('classifies a vanished worktree and renders the human residue section', async () => {
    const dispatched = dispatchTask(proot, 'T001');
    rmSync(dispatched.worktreePath, { recursive: true, force: true });

    const parallel = await resumeParallel();
    expect(parallel.residues.some((r) => r.class === 'vanished-worktree' && r.taskId === 'T001')).toBe(true);

    const human = await prun(['resume']);
    const out = human.lines.join('\n');
    expect(out).toContain('🔧 Worktree residues (read-only report)');
    expect(out).toContain('[vanished-worktree]');
    expect(out).toContain('task-discard T001');
  });

  it('still names the vanished dispatch when the entire worktrees directory is gone', async () => {
    dispatchTask(proot, 'T001');
    rmSync(join(proot, '.pitway-worktrees'), { recursive: true, force: true });

    const parallel = await resumeParallel();
    expect(parallel.activeDispatches).toEqual([]);
    expect(parallel.residues.some((r) => r.class === 'vanished-worktree' && r.taskId === 'T001')).toBe(true);
  });

  it("classifies a closed dispatch whose worktree survives as 'cleanup-pending'", async () => {
    const dispatched = dispatchTask(proot, 'T001');
    appendWorktreeIntegrateRecord(proot, {
      id: 'wti-test',
      dispatchId: dispatched.dispatchId,
      milestone: 'M001',
      taskId: 'T001',
      workerSha: 'a'.repeat(40),
      at: '2026-08-21T00:00:00Z',
    });

    const parallel = await resumeParallel();
    expect(parallel.residues.some((r) => r.class === 'cleanup-pending' && r.taskId === 'T001')).toBe(true);
  });

  it('still reports cleanup-pending with a null taskId when the worktree marker file is gone', async () => {
    const dispatched = dispatchTask(proot, 'T001');
    appendWorktreeIntegrateRecord(proot, {
      id: 'wti-markerless',
      dispatchId: dispatched.dispatchId,
      milestone: 'M001',
      taskId: 'T001',
      workerSha: 'a'.repeat(40),
      at: '2026-08-21T00:00:00Z',
    });
    // The runtime marker vanished (e.g. a worker deleted it): the residue is
    // still named by path, with taskId honestly null rather than guessed.
    rmSync(join(dispatched.worktreePath, '.pitway-worktree.yaml'), { force: true });

    const parallel = await resumeParallel();
    const residue = parallel.residues.find((r) => r.class === 'cleanup-pending');
    expect(residue).toBeDefined();
    expect(residue!.taskId).toBeNull();
    // git's porcelain listing reports the canonical path form (macOS
    // /private/var vs /var) -- compare on the stable suffix.
    expect(residue!.path).toMatch(/\.pitway-worktrees\/M001-T001$/);
  });

  it('reports no cleanup-pending residue for a closed dispatch whose directory is already gone', async () => {
    const dispatched = dispatchTask(proot, 'T001');
    appendWorktreeIntegrateRecord(proot, {
      id: 'wti-gone',
      dispatchId: dispatched.dispatchId,
      milestone: 'M001',
      taskId: 'T001',
      workerSha: 'a'.repeat(40),
      at: '2026-08-21T00:00:00Z',
    });
    // Directory removed but the stale git worktree entry not yet pruned:
    // nothing is left to clean up, so no cleanup-pending report -- only the
    // in_progress-without-live-dispatch classification remains.
    rmSync(dispatched.worktreePath, { recursive: true, force: true });

    const parallel = await resumeParallel();
    expect(parallel.residues.some((r) => r.class === 'cleanup-pending')).toBe(false);
    expect(parallel.residues.some((r) => r.class === 'inline-or-interrupted' && r.taskId === 'T001')).toBe(true);
  });

  it('classifies a managed-prefix worktree with no dispatch record as recordless', async () => {
    createTaskWorktree(proot, 'M001', 'T002');
    const parallel = await resumeParallel();
    expect(parallel.residues.some((r) => r.class === 'recordless-worktree' && r.taskId === 'T002')).toBe(true);
  });

  it("labels an in_progress task without a dispatch record 'inline-or-interrupted'", async () => {
    expect((await prun(['task-update', 'T001', 'in_progress'])).error).toBeUndefined();
    const parallel = await resumeParallel();
    expect(parallel.residues).toHaveLength(1);
    expect(parallel.residues[0]).toMatchObject({ class: 'inline-or-interrupted', taskId: 'T001' });

    const human = await prun(['resume']);
    expect(human.lines.join('\n')).toContain('[inline-or-interrupted]');
  });
});

// The default CommandDeps fallbacks (deps.write ?? console.log,
// deps.root ?? process.cwd()) are only reached when a caller registers the
// command with no overrides -- the real shape a bare `pitway resume`
// invocation takes outside this test file's harness.
describe('pitway resume default CommandDeps fallbacks', () => {
  it('falls back to console.log and process.cwd() when no overrides are given', async () => {
    saveState(root, { schema_version: 1, active_milestone: null, milestones: [] });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cwdBefore = process.cwd();
    process.chdir(root);
    let caught: unknown;
    let calls: unknown[][] = [];
    try {
      const program = buildCli();
      registerResumeCommand(program);
      await program.parseAsync(['node', 'pitway', 'resume']);
    } catch (error) {
      caught = error;
    } finally {
      calls = logSpy.mock.calls;
      process.chdir(cwdBefore);
      logSpy.mockRestore();
    }

    expect(caught).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.[0])).toContain('No active milestone. Run milestone-add to start one.');
  });
});
