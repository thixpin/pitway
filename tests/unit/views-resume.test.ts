import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildResumeView } from '../../src/core/views/resume.js';
import { saveContract, saveState, saveTasks, saveVerificationResults } from '../../src/state/store.js';
import type { ContractFrontmatter, Task } from '../../src/state/schemas.js';

// B037: buildResumeView is Core view assembly -- pure state reconstruction
// over .pitway/ plus read-only git, exercised here directly (no commander,
// no rendering). The integration tests in tests/integration/resume.test.ts
// keep covering the CLI surface; this file pins the Core contract.

let root: string;

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

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

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pitway-core-resume-'));
  git(['init', '-q'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  writeFileSync(join(root, 'README.md'), 'seed\n');
  git(['add', 'README.md'], root);
  git(['commit', '-q', '-m', 'init'], root);
  mkdirSync(join(root, '.pitway', 'milestones', 'M001'), { recursive: true });
  writeFileSync(join(root, '.pitway', 'config.yaml'), 'schema_version: 1\n');
  saveVerificationResults(root, 'M001', { schema_version: 1, results: [] });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('buildResumeView (Core)', () => {
  it('returns the inactive shape with every key present when no milestone is active', () => {
    saveState(root, { schema_version: 1, active_milestone: null, milestones: [] });
    expect(buildResumeView(root)).toEqual({
      activeMilestone: null,
      contractStatus: null,
      title: null,
      tasks: [],
      ready: [],
      waiting: [],
      blocked: [],
      inProgress: [],
      nextTask: null,
      pendingQuickChanges: [],
      pendingBacklogItems: [],
      parallel: null,
      footer: null,
    });
  });

  it('groups tasks by status, sorts ready ids, and recommends the lowest ready id', () => {
    saveState(root, { schema_version: 1, active_milestone: 'M001', milestones: ['M001'] });
    saveContract(root, 'M001', { frontmatter: frontmatter('in_progress'), body: '\n' });
    saveTasks(root, 'M001', {
      schema_version: 1,
      tasks: [
        task({ id: 'T004', status: 'ready' }),
        task({ id: 'T002', status: 'ready' }),
        task({ id: 'T001', status: 'completed' }),
        task({ id: 'T003', status: 'waiting', depends_on: ['T002'] }),
        task({ id: 'T005', status: 'blocked' }),
      ],
    });

    const view = buildResumeView(root);
    expect(view.activeMilestone).toBe('M001');
    expect(view.contractStatus).toBe('in_progress');
    expect(view.title).toBe('Test Milestone');
    expect(view.tasks.map((t) => t.id)).toEqual(['T004', 'T002', 'T001', 'T003', 'T005']);
    expect(view.ready).toEqual(['T002', 'T004']);
    expect(view.waiting).toEqual(['T003']);
    expect(view.blocked).toEqual(['T005']);
    expect(view.inProgress).toEqual([]);
    expect(view.nextTask).toBe('T002');
    expect(view.waitingDetails).toEqual([{ id: 'T003', detail: 'waiting on T002' }]);
    expect(view.blockedDetails).toEqual([{ id: 'T005', detail: 'task-update T005 ready' }]);
    expect(view.parallel).toBeNull();
    expect(view.parallelEligible).toBeUndefined();
    expect(view.branch).toBeUndefined();
    expect(view.openReview).toBeUndefined();
  });

  it('prefers an in_progress task as the continuation target over any ready task', () => {
    saveState(root, { schema_version: 1, active_milestone: 'M001', milestones: ['M001'] });
    saveContract(root, 'M001', { frontmatter: frontmatter('in_progress'), body: '\n' });
    saveTasks(root, 'M001', {
      schema_version: 1,
      tasks: [task({ id: 'T001', status: 'ready' }), task({ id: 'T002', status: 'in_progress' })],
    });
    const view = buildResumeView(root);
    expect(view.inProgress).toEqual(['T002']);
    expect(view.nextTask).toBe('T002');
  });

  it('omits waitingDetails/blockedDetails entirely when nothing is waiting or blocked', () => {
    saveState(root, { schema_version: 1, active_milestone: 'M001', milestones: ['M001'] });
    saveContract(root, 'M001', { frontmatter: frontmatter('in_progress'), body: '\n' });
    saveTasks(root, 'M001', { schema_version: 1, tasks: [task({ id: 'T001', status: 'ready' })] });
    const view = buildResumeView(root);
    expect('waitingDetails' in view).toBe(false);
    expect('blockedDetails' in view).toBe(false);
  });

  it('surfaces the tracked branch with a match flag only when the contract records base_branch', () => {
    saveState(root, { schema_version: 1, active_milestone: 'M001', milestones: ['M001'] });
    saveContract(root, 'M001', {
      frontmatter: frontmatter('in_progress', { base_branch: 'main' }),
      body: '\n',
    });
    saveTasks(root, 'M001', { schema_version: 1, tasks: [task({ id: 'T001', status: 'ready' })] });
    const view = buildResumeView(root);
    expect(view.branch).toBeDefined();
    expect(view.branch!.expected).toBe('pitway/M001-test-milestone');
    expect(view.branch!.matches).toBe(view.branch!.actual === view.branch!.expected);
  });

  it('derives the racing footer from Core (null for a draft milestone)', () => {
    saveState(root, { schema_version: 1, active_milestone: 'M001', milestones: ['M001'] });
    saveContract(root, 'M001', { frontmatter: frontmatter('draft'), body: '\n' });
    saveTasks(root, 'M001', { schema_version: 1, tasks: [task({ id: 'T001', status: 'planned' })] });
    expect(buildResumeView(root).footer).toBeNull();

    saveContract(root, 'M001', { frontmatter: frontmatter('in_progress'), body: '\n' });
    saveTasks(root, 'M001', {
      schema_version: 1,
      tasks: [task({ id: 'T001', status: 'completed' }), task({ id: 'T002', status: 'ready', name: 'Next thing' })],
    });
    expect(buildResumeView(root).footer).toBe('🏎️ 48% · ✅ 1/2 · Next: T002 · Next thing');
  });

  it('reports parallel state (empty, no residues) and names parallel-eligible ready pairs under parallel_worktrees', () => {
    writeFileSync(
      join(root, '.pitway', 'config.yaml'),
      'schema_version: 1\nexecution:\n  strategy: parallel_worktrees\n',
    );
    saveState(root, { schema_version: 1, active_milestone: 'M001', milestones: ['M001'] });
    saveContract(root, 'M001', { frontmatter: frontmatter('in_progress'), body: '\n' });
    saveTasks(root, 'M001', {
      schema_version: 1,
      tasks: [
        task({ id: 'T001', status: 'ready', relevant_files: undefined, context_files: ['a.ts'], write_scope: ['a.ts'] }),
        task({ id: 'T002', status: 'ready', relevant_files: undefined, context_files: ['b.ts'], write_scope: ['b.ts'] }),
      ],
    });
    const view = buildResumeView(root);
    expect(view.parallel).toEqual({ activeDispatches: [], residues: [] });
    expect(view.parallelEligible).toEqual(['T001', 'T002']);
  });
});
