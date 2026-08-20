import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveContract, saveTasks, saveUsage, saveVerificationResults } from '../../src/state/store.js';
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
  // M013/T005: buildMilestoneStatusView now also derives the racing footer,
  // which reads verification-results.yaml via the shared status helper --
  // present (empty) on every real milestone-add-created milestone.
  saveVerificationResults(root, 'M001', { schema_version: 1, results: [] });
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
  saveUsage(root, 'M001', { schema_version: 1, planning: null, qa: null });

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

  it('renders human output with per-task status labels and no percentages outside the racing footer', async () => {
    const program = buildCli();
    const lines: string[] = [];
    registerMilestoneStatusCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'milestone-status', 'M001']);

    const output = lines.join('\n');
    expect(output).toContain('Test Milestone');
    expect(output).toContain('T001');
    expect(output).toContain('Completed');
    // M013/AC004: the racing footer is the one sanctioned exception to the
    // no-percentages rule (decision 5) -- everything above it stays free of
    // any percentage.
    const [body, footer] = output.split('\n\n🏎️');
    expect(body).not.toContain('%');
    expect(body).not.toMatch(/\b\d+%/);
    expect(footer).toMatch(/^ \d+% ·/);
  });
});

async function runStatus(args: string[] = []): Promise<string> {
  const program = buildCli();
  const lines: string[] = [];
  registerMilestoneStatusCommand(program, { root, write: (s) => lines.push(s) });
  await program.parseAsync(['node', 'pitway', 'milestone-status', 'M001', ...args]);
  return lines.join('\n');
}

describe('pitway milestone-status usage aggregation', () => {
  it('reports a null aggregate with every task unmeasured when nothing is measured', async () => {
    const view = JSON.parse(await runStatus(['--json'])) as {
      aggregate: { totalTokens: number | null; unmeasuredTasks: number };
    };
    expect(view.aggregate).toEqual({ totalTokens: null, unmeasuredTasks: 4 });
    expect(await runStatus()).toContain('Tokens: N/A');
  });

  it('sums measured task usage plus planning plus qa, surfacing unmeasured tasks as N/A', async () => {
    saveTasks(root, 'M001', {
      schema_version: 1,
      tasks: [
        task({ id: 'T001', status: 'completed', usage: { total_tokens: 60000 } }),
        task({ id: 'T002', status: 'in_progress' }),
        task({ id: 'T003', status: 'waiting' }),
      ],
    });
    saveUsage(root, 'M001', {
      schema_version: 1,
      planning: { attempts: 2, total_tokens: 20000 },
      qa: { attempts: 1, total_tokens: 4200 },
    });

    const view = JSON.parse(await runStatus(['--json'])) as {
      aggregate: { totalTokens: number | null; unmeasuredTasks: number };
    };
    expect(view.aggregate).toEqual({ totalTokens: 84200, unmeasuredTasks: 2 });
    expect(await runStatus()).toContain('Tokens: 84.2k (2 tasks N/A)');
  });

  it('renders small totals unabbreviated with a singular N/A count', async () => {
    saveTasks(root, 'M001', {
      schema_version: 1,
      tasks: [
        task({ id: 'T001', status: 'completed', usage: { total_tokens: 500 } }),
        task({ id: 'T002', status: 'completed', usage: { total_tokens: 450 } }),
        task({ id: 'T003', status: 'waiting' }),
      ],
    });
    expect(await runStatus()).toContain('Tokens: 950 (1 task N/A)');
  });

  it('omits the N/A suffix when every task is measured', async () => {
    saveTasks(root, 'M001', {
      schema_version: 1,
      tasks: [task({ id: 'T001', status: 'completed', usage: { total_tokens: 84200 } })],
    });
    const output = await runStatus();
    expect(output).toContain('Tokens: 84.2k');
    expect(output).not.toMatch(/tasks? N\/A/);
  });
});

// AC004 (M013/T005): the racing footer, wired into milestone-status.
describe('pitway milestone-status racing footer (M013/T005)', () => {
  it('is entirely absent (not blank) for a draft milestone', async () => {
    saveContract(root, 'M001', { frontmatter: { ...frontmatter, status: 'draft' }, body: '\n# Contract\n' });
    saveTasks(root, 'M001', { schema_version: 1, tasks: [task({ id: 'T001', status: 'planned' })] });

    const view = JSON.parse(await runStatus(['--json'])) as { footer: string | null };
    expect(view.footer).toBeNull();
    // The footer's own shape (a workload % followed by the count segment) is
    // unique -- unlike a bare 🏁, which also appears in the header line.
    expect(await runStatus()).not.toMatch(/\d+% · ✅/);
  });

  it('renders the footer as the final line once confirmed', async () => {
    saveTasks(root, 'M001', {
      schema_version: 1,
      tasks: [task({ id: 'T001', status: 'completed' }), task({ id: 'T002', status: 'ready' })],
    });

    const view = JSON.parse(await runStatus(['--json'])) as { footer: string | null };
    expect(view.footer).toBe('🏎️ 48% · ✅ 1/2 · Next: T002');

    const output = await runStatus();
    const lines = output.split('\n');
    expect(lines[lines.length - 1]).toBe('🏎️ 48% · ✅ 1/2 · Next: T002');
  });
});
