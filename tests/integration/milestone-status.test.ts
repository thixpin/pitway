import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveContract, saveTasks } from '../../src/state/store.js';
import { buildCli } from '../../src/cli/index.js';
import { registerMilestoneStatusCommand } from '../../src/cli/commands/milestone-status.js';
import type { ContractFrontmatter, Task } from '../../src/state/schemas.js';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

let root: string;

const frontmatter: ContractFrontmatter = {
  schema_version: 1,
  id: 'M001',
  title: 'Test Milestone',
  status: 'in_progress',
  requirement: null,
  confirmed_at: '2026-08-18T00:00:00Z',
  verification_approved_hash: 'sha256:' + 'a'.repeat(64),
  acceptance_criteria: [{ id: 'AC001', text: 'x' }],
  verification: [{ id: 'CT001', criterion: 'AC001', type: 'command', command: 'npm test' }],
};

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
  root = mkdtempSync(join(tmpdir(), 'pitway-mstatus-'));
  git(['init', '-q'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);

  mkdirSync(join(root, '.pitway', 'milestones', 'M001'), { recursive: true });
  saveContract(root, 'M001', { frontmatter, body: '\n# Contract\n' });
  saveTasks(root, 'M001', {
    schema_version: 1,
    tasks: [
      task({ id: 'T001', status: 'completed' }),
      task({ id: 'T002', status: 'in_progress' }),
      task({ id: 'T003', status: 'waiting' }),
      task({ id: 'T004', status: 'cancelled' }),
    ],
  });

  writeFileSync(join(root, 'seed.txt'), 'x\n');
  git(['add', 'seed.txt'], root);
  git(['commit', '-q', '-m', 'workflow: add milestone M001\n\nPitWay-Milestone: M001'], root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('pitway milestone-status', () => {
  it('reports json with deterministic progress excluding cancelled tasks, and the baseline SHA', async () => {
    const program = buildCli();
    const lines: string[] = [];
    registerMilestoneStatusCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'milestone-status', 'M001', '--json']);

    const view = JSON.parse(lines.join('\n'));
    expect(view.id).toBe('M001');
    expect(view.title).toBe('Test Milestone');
    expect(view.status).toBe('in_progress');
    // 1 completed of 3 required (T004 cancelled excluded from both counts)
    expect(view.progress).toEqual({ completed: 1, total: 3 });
    expect(view.baselineSha).toBe(git(['rev-parse', 'HEAD'], root).trim());
    expect(view.tasks).toHaveLength(4);
  });

  it('renders human output with per-task status labels and no percentages', async () => {
    const program = buildCli();
    const lines: string[] = [];
    registerMilestoneStatusCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'milestone-status', 'M001']);

    const output = lines.join('\n');
    expect(output).toContain('Test Milestone');
    expect(output).toContain('T001');
    expect(output).toContain('Completed');
    expect(output).not.toContain('%');
    expect(output).not.toMatch(/\b\d+%/);
  });
});
