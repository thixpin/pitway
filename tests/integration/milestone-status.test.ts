import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveContract, saveTasks, saveUsage, saveVerificationResults } from '../../src/state/store.js';
import { appendTaskVerifyEvidenceRecord } from '../../src/state/journal.js';
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

  it('renders human output with per-task status labels, a task table, and a progress-bar footer', async () => {
    const program = buildCli();
    const lines: string[] = [];
    registerMilestoneStatusCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'milestone-status', 'M001']);

    const output = lines.join('\n');
    expect(output).toContain('Test Milestone');
    expect(output).toContain('T001');
    expect(output).toContain('Completed');
    // UX quick-change: the summary header (Status/Progress/Baseline/Tokens)
    // stays free of any percentage -- only the task table's own Progress
    // column and the racing footer (now carrying a progress bar) are the
    // sanctioned exceptions.
    const header = output.split('\n\n')[0]!;
    expect(header).not.toContain('%');
    expect(output).toMatch(/\| Task \| Status \| Progress \| Execution \|/);
    expect(output).toMatch(/🏎️ \[[█░]{20}\] \d+% · ✅/);
  });

  it("renders every task in the table, in the milestone's own order, with correct status/progress/execution", async () => {
    const program = buildCli();
    const lines: string[] = [];
    registerMilestoneStatusCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'milestone-status', 'M001']);

    const rows = lines
      .join('\n')
      .split('\n')
      .filter((l) => /^\| T\d{3} \|/.test(l));
    // T001 completed, T002 in_progress (never dispatched -> inline), T003
    // waiting (not started -> no execution mode), T004 cancelled (likewise)
    // -- the beforeEach fixture's own tasks, in their declared order.
    expect(rows).toEqual([
      '| T001 | ✓ Completed | 100% | inline |',
      '| T002 | ● In Progress | — | inline |',
      '| T003 | ◌ Waiting | — | — |',
      '| T004 | ✗ Cancelled | — | — |',
    ]);
  });

  it('shows "worktree" execution for a task with a real worktree_integrate journal record', async () => {
    const { appendWorktreeIntegrateRecord } = await import('../../src/state/journal.js');
    appendWorktreeIntegrateRecord(root, {
      id: 'wti-test',
      dispatchId: 'wtd-test',
      milestone: 'M001',
      taskId: 'T002',
      workerSha: 'a'.repeat(40),
      at: new Date().toISOString(),
    });

    const program = buildCli();
    const lines: string[] = [];
    registerMilestoneStatusCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'milestone-status', 'M001']);

    expect(lines.join('\n')).toContain('| T002 | ● In Progress | — | worktree |');
  });

  it('shows "inline" execution for a dispatch that was later discarded and completed inline instead', async () => {
    const { appendWorktreeDispatchRecord } = await import('../../src/state/journal.js');
    // A dispatch attempt whose worktree_dispatch record survives in the
    // append-only journal even though it was never integrated -- the real
    // scenario this milestone's own execution hit live (M017/T002-T006).
    appendWorktreeDispatchRecord(root, {
      id: 'wtd-abandoned',
      milestone: 'M001',
      taskId: 'T002',
      branch: 'pitway/task/M001-T002',
      worktreePath: '.pitway-worktrees/M001-T002',
      createdFrom: git(['rev-parse', 'HEAD'], root).trim(),
      at: new Date().toISOString(),
    });

    const program = buildCli();
    const lines: string[] = [];
    registerMilestoneStatusCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'milestone-status', 'M001']);

    expect(lines.join('\n')).toContain('| T002 | ● In Progress | — | inline |');
  });

  it('renders the progress bar at the minimum band (10%, freshly confirmed) and clamps within 0-100%', async () => {
    saveTasks(root, 'M001', {
      schema_version: 1,
      tasks: [task({ id: 'T001', status: 'ready' }), task({ id: 'T002', status: 'waiting' })],
    });

    const program = buildCli();
    const lines: string[] = [];
    registerMilestoneStatusCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'milestone-status', 'M001']);

    const last = lines.join('\n').split('\n').at(-1)!;
    // 10% of a 20-char bar rounds to 2 filled chars.
    expect(last).toBe('🏎️ [██░░░░░░░░░░░░░░░░░░] 10% · ✅ 0/2 · Next: T001');
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

    // The --json footer field stays the plain, unmodified string
    // computeRacingFooter produces -- machine interface unaffected by the
    // human-mode progress-bar presentation change.
    const view = JSON.parse(await runStatus(['--json'])) as { footer: string | null };
    expect(view.footer).toBe('🏎️ 48% · ✅ 1/2 · Next: T002');

    const output = await runStatus();
    const lines = output.split('\n');
    // The printed human-mode line splices a progress bar between the icon
    // and the percentage; semantic content (percent/count/next) unchanged.
    expect(lines[lines.length - 1]).toBe('🏎️ [██████████░░░░░░░░░░] 48% · ✅ 1/2 · Next: T002');
  });
});

// AC005/AC007 (M013/T006): the on-demand Progress Report.
describe('pitway milestone-status --report (M013/T006)', () => {
  it('renders the full report shape with evidence-honest task labeling and no driver_overhead line', async () => {
    appendTaskVerifyEvidenceRecord(root, {
      id: 'tve-test001',
      milestone: 'M001',
      taskId: 'T001',
      attempts: 1,
      command: 'npm test',
      exitCode: 0,
      evidence: 'verified evidence text',
      durationMs: 100,
      terminationReason: 'exited',
      fingerprint: { entries: [] },
      at: '2026-08-20T00:00:00Z',
    });
    saveTasks(root, 'M001', {
      schema_version: 1,
      tasks: [
        task({
          id: 'T001',
          name: 'Config schema',
          status: 'completed',
          result: { summary: 's', evidence: 'verified evidence text' },
          usage: { total_tokens: 100 },
        }),
        task({
          id: 'T002',
          status: 'completed',
          depends_on: ['T001'],
          result: { summary: 's2', evidence: 'plain evidence, not journal-backed' },
        }),
        task({ id: 'T003', status: 'ready', depends_on: ['T002'] }),
      ],
    });
    saveUsage(root, 'M001', { schema_version: 1, planning: { attempts: 1, total_tokens: 200 }, qa: null });

    const view = JSON.parse(await runStatus(['--report', '--json'])) as {
      mode: string;
      tasks: Array<{ id: string; label: string; statusLabel: string; tokens: number | null }>;
      criticalPath: string[];
      tokenBreakdown: Record<string, unknown>;
    };
    expect(view.mode).toBe('report');
    expect(view.tasks.find((t) => t.id === 'T001')).toMatchObject({
      label: 'Config schema',
      statusLabel: '✓ Completed · verified',
      tokens: 100,
    });
    expect(view.tasks.find((t) => t.id === 'T002')).toMatchObject({ statusLabel: '✓ Completed' });
    expect(view.criticalPath).toEqual(['T003']);
    expect(view.tokenBreakdown).toEqual({ task: 100, planning: 200, qa: null, total: 300, missing: 3 });
    expect('driver_overhead' in view.tokenBreakdown).toBe(false);

    const output = await runStatus(['--report']);
    expect(output).not.toContain('driver_overhead');
    expect(output).toContain('Config schema');
    expect(output).toContain('✓ Completed · verified');
    // B005 (qc-404ee3e9): the report's task list is a table with a Tokens
    // column, aligned with plain milestone-status's own table format.
    expect(output).toContain('| Task | Label | Execution | Status | Tokens |');
    expect(output).toContain('| T001 | Config schema | — | ✓ Completed · verified | 100 |');
    expect(output).toContain('| T002 | ');
    expect(output).toContain('| N/A |');
    const lines = output.split('\n');
    expect(lines[lines.length - 1]).toMatch(/^🏎️ \d+% · ✅/);
  });

  it('falls back to the truncated objective, not a bare id, when name is absent', async () => {
    const longObjective = 'x'.repeat(80);
    saveTasks(root, 'M001', {
      schema_version: 1,
      tasks: [task({ id: 'T001', status: 'ready', objective: longObjective })],
    });
    const view = JSON.parse(await runStatus(['--report', '--json'])) as {
      tasks: Array<{ id: string; label: string }>;
    };
    expect(view.tasks[0]!.label).toBe(`${'x'.repeat(60)}…`);
  });
});

// Developer directive (2026-08-20, during M014): footer output separation --
// a permanent single-line status element, never concatenated with body
// output; completed variant stays `🏁 100% · ✅ <t>/<t> · Complete`.
describe('pitway milestone-status footer output separation (M014 driver-output directive)', () => {
  it('renders the running footer blank-line-separated with the name segment, exactly once', async () => {
    saveTasks(root, 'M001', {
      schema_version: 1,
      tasks: [
        task({ id: 'T001', status: 'completed' }),
        task({ id: 'T002', status: 'ready', name: 'task-dispatch command' }),
      ],
    });

    const output = await runStatus();
    const lines = output.split('\n');
    const last = lines[lines.length - 1]!;
    expect(last).toBe('🏎️ [██████████░░░░░░░░░░] 48% · ✅ 1/2 · Next: T002 · task-dispatch command');
    expect(lines[lines.length - 2]).toBe('');
    expect(lines.filter((l) => /\d+% · ✅ \d+\/\d+/.test(l))).toEqual([last]);
  });

  it('renders the completed footer as its own final line with no task-name segment', async () => {
    saveContract(root, 'M001', {
      frontmatter: { ...frontmatter, status: 'completed' },
      body: '\n# Contract\n',
    });
    saveTasks(root, 'M001', {
      schema_version: 1,
      tasks: [
        task({ id: 'T001', status: 'completed', name: 'config gate' }),
        task({ id: 'T002', status: 'completed', name: 'worktree module' }),
      ],
    });

    const output = await runStatus();
    const lines = output.split('\n');
    const last = lines[lines.length - 1]!;
    expect(last).toBe('🏁 [████████████████████] 100% · ✅ 2/2 · Complete');
    expect(lines[lines.length - 2]).toBe('');
    expect(lines.filter((l) => /\d+% · ✅ \d+\/\d+/.test(l))).toEqual([last]);
  });
});

describe('pitway milestone-status baseline resolution edges', () => {
  it('renders Baseline: N/A for a milestone with no trailer commit at all', async () => {
    mkdirSync(join(root, '.pitway', 'milestones', 'M002'), { recursive: true });
    saveVerificationResults(root, 'M002', { schema_version: 1, results: [] });
    saveContract(root, 'M002', {
      frontmatter: { ...frontmatter, id: 'M002', status: 'draft' },
      body: '\n',
    });
    saveTasks(root, 'M002', { schema_version: 1, tasks: [task({ id: 'T001', status: 'planned' })] });
    saveUsage(root, 'M002', { schema_version: 1, planning: null, qa: null });

    const program = buildCli();
    const lines: string[] = [];
    registerMilestoneStatusCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'milestone-status', 'M002']);
    expect(lines.join('\n')).toContain('Baseline: N/A');
  });

  it('bounds the trailer walk to base_revision when the milestone tracks a branch, still resolving the SHA', async () => {
    const base = git(['rev-parse', 'HEAD'], root).trim();
    writeFileSync(join(root, 'work.txt'), 'w\n');
    git(['add', 'work.txt'], root);
    git(['commit', '-q', '-m', 'workflow: baseline M001\n\nPitWay-Milestone: M001'], root);
    const expected = git(['rev-parse', 'HEAD'], root).trim();
    saveContract(root, 'M001', {
      frontmatter: { ...frontmatter, base_branch: 'main', base_revision: base },
      body: '\n',
    });

    const view = JSON.parse(await runStatus(['--json'])) as { baselineSha: string | null };
    expect(view.baselineSha).toBe(expected);
  });
});

describe('pitway milestone-status --report token breakdown', () => {
  it('reports measured planning and qa alongside task usage with a singular missing-usage count', async () => {
    saveTasks(root, 'M001', {
      schema_version: 1,
      tasks: [
        task({ id: 'T001', status: 'completed', usage: { total_tokens: 1000 } }),
        task({ id: 'T002', status: 'in_progress' }),
      ],
    });
    saveUsage(root, 'M001', {
      schema_version: 1,
      planning: { attempts: 1, total_tokens: 200 },
      qa: { attempts: 1, total_tokens: 100 },
    });

    const output = await runStatus(['--report']);
    expect(output).toContain('(1 task missing usage)');
    expect(output).toContain('  task: 1.0k');
    expect(output).toContain('  planning: 200');
    expect(output).toContain('  qa: 100');
    expect(output).toContain('  total: 1.3k');
    expect(output).toContain('  missing: 1');
  });

  it('sums only what was measured when qa is null, reporting qa as N/A', async () => {
    saveTasks(root, 'M001', {
      schema_version: 1,
      tasks: [task({ id: 'T001', status: 'completed', usage: { total_tokens: 500 } })],
    });
    saveUsage(root, 'M001', {
      schema_version: 1,
      planning: { attempts: 1, total_tokens: 200 },
      qa: null,
    });

    const output = await runStatus(['--report']);
    expect(output).toContain('  task: 500');
    expect(output).toContain('  planning: 200');
    expect(output).toContain('  qa: N/A');
    expect(output).toContain('  total: 700');
    // qa alone is the missing source (every task is measured).
    expect(output).toContain('  missing: 1');
  });

  it('sums only what was measured when planning is null, reporting planning as N/A', async () => {
    saveTasks(root, 'M001', {
      schema_version: 1,
      tasks: [task({ id: 'T001', status: 'completed', usage: { total_tokens: 500 } })],
    });
    saveUsage(root, 'M001', {
      schema_version: 1,
      planning: null,
      qa: { attempts: 1, total_tokens: 300 },
    });

    const output = await runStatus(['--report']);
    expect(output).toContain('  task: 500');
    expect(output).toContain('  planning: N/A');
    expect(output).toContain('  qa: 300');
    expect(output).toContain('  total: 800');
  });

  it('renders an empty draft report with (none) critical path, no ready task, and no footer', async () => {
    saveContract(root, 'M001', { frontmatter: { ...frontmatter, status: 'draft' }, body: '\n' });
    saveTasks(root, 'M001', { schema_version: 1, tasks: [] });

    const output = await runStatus(['--report']);
    expect(output).toContain('Critical path: (none)');
    expect(output).toContain('Active: (none)');
    expect(output).toContain('Next: (no ready task)');
    expect(output).not.toMatch(/\d+% · ✅/);
  });
});

// The default CommandDeps fallbacks (deps.write ?? console.log,
// deps.root ?? process.cwd()) are only reached when a caller registers the
// command with no overrides -- the real shape a bare `pitway
// milestone-status` invocation takes outside this test file's harness.
describe('pitway milestone-status default CommandDeps fallbacks', () => {
  it('falls back to console.log and process.cwd() when no overrides are given', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cwdBefore = process.cwd();
    process.chdir(root);
    let caught: unknown;
    let calls: unknown[][] = [];
    try {
      const program = buildCli();
      registerMilestoneStatusCommand(program);
      await program.parseAsync(['node', 'pitway', 'milestone-status', 'M001']);
    } catch (error) {
      caught = error;
    } finally {
      calls = logSpy.mock.calls;
      process.chdir(cwdBefore);
      logSpy.mockRestore();
    }

    expect(caught).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.[0])).toContain('🏁 Milestone M001 — Test Milestone');
  });
});
