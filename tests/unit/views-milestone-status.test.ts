import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMilestoneStatusView } from '../../src/core/views/milestone-status.js';
import { taskStatusLabel } from '../../src/core/tasks/status-label.js';
import { taskStatusLabel as cliTaskStatusLabel } from '../../src/cli/format.js';
import { saveContract, saveReviews, saveState, saveTasks, saveUsage, saveVerificationResults } from '../../src/state/store.js';
import { appendWorktreeIntegrateRecord } from '../../src/state/journal.js';
import type { ContractFrontmatter, Task } from '../../src/state/schemas.js';

// B037: buildMilestoneStatusView is Core view assembly, exercised directly.
// tests/integration/milestone-status.test.ts keeps covering the rendered
// CLI surface (table widths, progress bar, --json parity); this file pins
// the Core contract the CLI renders from.

let root: string;

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

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
  root = mkdtempSync(join(tmpdir(), 'pitway-core-mstatus-'));
  git(['init', '-q'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  mkdirSync(join(root, '.pitway', 'milestones', 'M001'), { recursive: true });
  saveVerificationResults(root, 'M001', { schema_version: 1, results: [] });
  saveContract(root, 'M001', { frontmatter, body: '\n# Contract\n' });
  saveTasks(root, 'M001', {
    schema_version: 1,
    tasks: [
      task({ id: 'T001', status: 'completed', name: 'First', usage: { total_tokens: 1500 } }),
      task({ id: 'T002', status: 'in_progress', objective: 'x'.repeat(70) }),
      task({ id: 'T003', status: 'waiting', depends_on: ['T002'] }),
      task({ id: 'T004', status: 'cancelled' }),
    ],
  });
  saveUsage(root, 'M001', { schema_version: 1, planning: { attempts: 1, total_tokens: 200 }, qa: null });
  saveState(root, { schema_version: 1, active_milestone: 'M001', milestones: ['M001'] });
  writeFileSync(join(root, 'seed.txt'), 'x\n');
  git(['add', 'seed.txt'], root);
  git(['commit', '-q', '-m', 'workflow: add milestone M001\n\nPitWay-Milestone: M001'], root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('buildMilestoneStatusView (Core)', () => {
  it('assembles identity, progress, workload, baseline, and next/active tasks', () => {
    const view = buildMilestoneStatusView(root, 'M001');
    expect(view.id).toBe('M001');
    expect(view.title).toBe('Test Milestone');
    expect(view.status).toBe('in_progress');
    expect(view.baselineSha).toBe(git(['rev-parse', 'HEAD'], root).trim());
    // 1 of 3 required (T004 cancelled): 10 + 25 = 35, verification not passed.
    expect(view.progress).toEqual({ completed: 1, total: 3 });
    expect(view.workloadPercent).toBe(35);
    expect(view.activeTask).toBe('T002');
    expect(view.nextTask).toBe('T002');
    expect(view.criticalPath).toEqual(['T002', 'T003']);
    expect(view.footer).toBe('🏎️ 35% · ✅ 1/3 · Next: T002');
  });

  it('labels tasks by name, else objective truncated to 60 chars with an ellipsis', () => {
    const rows = buildMilestoneStatusView(root, 'M001').tasks;
    expect(rows[0]!.label).toBe('First');
    expect(rows[1]!.label).toBe(`${'x'.repeat(60)}…`);
    expect(rows[2]!.label).toBe('x');
  });

  it('carries the presentation status label from Core (verified suffix only with real evidence) and per-task tokens', () => {
    const rows = buildMilestoneStatusView(root, 'M001').tasks;
    expect(rows[0]!.statusLabel).toBe('✓ Completed');
    expect(rows[1]!.statusLabel).toBe('● In Progress');
    expect(rows[3]!.statusLabel).toBe('✗ Cancelled');
    expect(rows.map((r) => r.tokens)).toEqual([1500, null, null, null]);
    // Execution mode: null before in_progress, inline once started with no
    // worktree_integrate record.
    expect(rows.map((r) => r.executionMode)).toEqual(['inline', 'inline', null, null]);
  });

  it('breaks tokens down by category and counts every missing figure', () => {
    saveReviews(root, 'M001', { schema_version: 1, sessions: [] });
    const view = buildMilestoneStatusView(root, 'M001');
    expect(view.tokenBreakdown).toEqual({ task: 1500, planning: 200, qa: null, review: null, total: 1700, missing: 4 });
    expect(view.tokenTotal).toBe(1700);
    expect(view.missingUsageCount).toBe(3);
  });
});

describe('taskStatusLabel lives in Core; cli/format.ts re-exports the same function', () => {
  it('is the identical function object', () => {
    expect(cliTaskStatusLabel).toBe(taskStatusLabel);
  });

  it('maps every task status to its presentation label', () => {
    expect(taskStatusLabel('planned')).toBe('◌ Planned');
    expect(taskStatusLabel('in_progress')).toBe('● In Progress');
    expect(taskStatusLabel('blocked')).toBe('⚠ Blocked');
    expect(taskStatusLabel('completed')).toBe('✓ Completed');
    expect(taskStatusLabel('failed')).toBe('✗ Failed');
  });
});

// M047/T003 (AC003, AC005): M040 Decision 4's bucket mapping is computed,
// never stored; readings are counted, never summed; the field is absent
// when the milestone has no usage and no readings.
describe('buildMilestoneStatusView per-bucket usage (M047/T003)', () => {
  it('maps existing usage onto buckets by execution mode and category, and counts readings without summing', () => {
    // Fixture: T001 usage 1500 (inline -> main), planning 200 (-> main).
    // Make T001 a worktree-integrated task -> its usage maps to worker.
    appendWorktreeIntegrateRecord(root, {
      id: 'wti-1',
      dispatchId: 'wtd-1',
      milestone: 'M001',
      taskId: 'T001',
      workerSha: 'a'.repeat(40),
      at: '2026-08-29T00:00:00Z',
    });
    saveReviews(root, 'M001', {
      schema_version: 1,
      sessions: [
        {
          id: 'rev-a1b2c3',
          status: 'open',
          created_at: '2026-08-29T00:00:00Z',
          roles: ['architect'],
          content_hash: `sha256:${'b'.repeat(64)}`,
          findings: [{ role: 'architect', recorded_at: '2026-08-29T01:00:00Z', findings: [], usage: { total_tokens: 40 } }],
          decision: null,
        },
      ],
    });
    saveUsage(root, 'M001', {
      schema_version: 1,
      planning: { attempts: 1, total_tokens: 200 },
      qa: null,
      readings: [
        { bucket: 'orchestrator', count: 72821, semantics: 'undetermined', recorded_at: '2026-08-29T00:00:00Z' },
        { bucket: 'orchestrator', count: 94451, semantics: 'undetermined', recorded_at: '2026-08-29T00:01:00Z' },
      ],
    });
    const view = buildMilestoneStatusView(root, 'M001');
    expect(view.buckets).toEqual({
      // planning 200 -> main; T002/T003 inline with usage null -> 2 main
      // misses; qa null -> 1 more; T004 is cancelled and counts nowhere.
      main: { measured: 200, missing: 3, readings: 0 },
      orchestrator: { measured: null, missing: 0, readings: 2 },  // two readings, never summed
      // T001 1500 (integrated -> worker) + review 40 -> worker; nothing missing.
      worker: { measured: 1540, missing: 0, readings: 0 },
      auxiliary: { measured: null, missing: 0, readings: 0 },
    });
    expect(JSON.stringify(view)).not.toContain('167272');
  });

  it('maps an inline (non-integrated) task\'s usage to main', () => {
    const view = buildMilestoneStatusView(root, 'M001');
    // Fixture: T001 usage 1500 with no worktree_integrate record -> main; planning 200 -> main.
    // T001 1500 + planning 200 -> main; T002/T003 usage null + qa null -> 3 main misses.
    expect(view.buckets?.main).toEqual({ measured: 1700, missing: 3, readings: 0 });
    expect(view.buckets?.worker).toEqual({ measured: null, missing: 0, readings: 0 });
  });

  it('omits buckets entirely when the milestone has no usage figure and no reading', () => {
    saveTasks(root, 'M001', { schema_version: 1, tasks: [task({ id: 'T001', status: 'ready' })] });
    saveUsage(root, 'M001', { schema_version: 1, planning: null, qa: null });
    const view = buildMilestoneStatusView(root, 'M001');
    expect('buckets' in view).toBe(false);
  });
});
