import { describe, expect, it } from 'vitest';
import { computeRacingFooter, resolveNextTask } from '../../src/core/milestones/footer.js';
import type { Task, TaskStatus } from '../../src/state/schemas.js';

function task(id: string, status: TaskStatus): Task {
  return {
    id,
    objective: 'x',
    status,
    depends_on: [],
    acceptance_criteria: ['x'],
    relevant_files: [],
    verification: { strategy: 'tdd', detail: 'npm test' },
    result: null,
    usage: null,
  };
}

describe('resolveNextTask (M013/T005/AC004)', () => {
  it('prefers an in_progress task over any ready task', () => {
    const tasks = [task('T002', 'ready'), task('T001', 'in_progress')];
    expect(resolveNextTask(tasks)).toBe('T001');
  });

  it('falls back to the lowest ready task id when nothing is in_progress', () => {
    const tasks = [task('T003', 'ready'), task('T001', 'waiting'), task('T002', 'ready')];
    expect(resolveNextTask(tasks)).toBe('T002');
  });

  it('returns null when nothing is in_progress or ready', () => {
    expect(resolveNextTask([task('T001', 'waiting'), task('T002', 'blocked')])).toBeNull();
  });
});

describe('computeRacingFooter (M013/T005/AC004)', () => {
  it('returns null (not a placeholder string) when status is draft', () => {
    expect(computeRacingFooter('draft', { completed: 0, total: 8 }, false, [])).toBeNull();
  });

  it('renders the running (🏎️) case with the next ready task', () => {
    const tasks = [task('T001', 'completed'), task('T002', 'ready')];
    const footer = computeRacingFooter('in_progress', { completed: 1, total: 8 }, false, tasks);
    expect(footer).toBe('🏎️ 19% · ✅ 1/8 · Next: T002');
  });

  it('renders the blocked (🔧) case naming the lowest blocked task id, taking precedence over running', () => {
    const tasks = [task('T001', 'ready'), task('T003', 'blocked'), task('T002', 'blocked')];
    const footer = computeRacingFooter('in_progress', { completed: 0, total: 8 }, false, tasks);
    expect(footer).toBe('🔧 10% · ✅ 0/8 · Next: T002');
  });

  it('renders the verification-only-remains (🏁) case when every required task is done but not yet verified', () => {
    const tasks = [task('T001', 'completed'), task('T002', 'completed')];
    const footer = computeRacingFooter('in_progress', { completed: 2, total: 2 }, false, tasks);
    expect(footer).toBe('🏁 85% · ✅ 2/2 · Next: verification');
  });

  it('renders the verified-awaiting-completion case naming developer approval', () => {
    const tasks = [task('T001', 'completed'), task('T002', 'completed')];
    const footer = computeRacingFooter('review', { completed: 2, total: 2 }, true, tasks);
    expect(footer).toBe('🏁 95% · ✅ 2/2 · Next: developer approval');
  });

  it('renders the completed (🏁, Complete) case, sharing the icon with verification-only-remains', () => {
    const tasks = [task('T001', 'completed'), task('T002', 'completed')];
    const footer = computeRacingFooter('completed', { completed: 2, total: 2 }, false, tasks);
    expect(footer).toBe('🏁 100% · ✅ 2/2 · Complete');
  });

  it('icon precedence: completed wins over blocked', () => {
    // A completed milestone by definition has no remaining blocked tasks in
    // practice, but the function must still short-circuit on status alone.
    const footer = computeRacingFooter('completed', { completed: 2, total: 2 }, false, [
      task('T001', 'completed'),
    ]);
    expect(footer).toContain('Complete');
  });
});

// Developer directive (2026-08-20, during M014): the footer stays one
// concise line; a task-id gate carries the task's short name as one further
// ` · ` segment when present. Name-less tasks and named gates render
// byte-identically to before; no narration ever joins the footer line.
describe('computeRacingFooter task-name segment', () => {
  const named = (id: string, status: TaskStatus, name: string): Task => ({
    ...task(id, status),
    name,
  });

  it('running case appends the next task name as its own segment', () => {
    const tasks = [
      task('T001', 'completed'),
      named('T002', 'ready', 'git worktree module'),
    ];
    const footer = computeRacingFooter('in_progress', { completed: 1, total: 8 }, false, tasks);
    expect(footer).toBe('🏎️ 19% · ✅ 1/8 · Next: T002 · git worktree module');
  });

  it('blocked case appends the blocked task name as its own segment', () => {
    const tasks = [task('T001', 'ready'), named('T002', 'blocked', 'task-dispatch command')];
    const footer = computeRacingFooter('in_progress', { completed: 0, total: 8 }, false, tasks);
    expect(footer).toBe('🔧 10% · ✅ 0/8 · Next: T002 · task-dispatch command');
  });

  it('a name-less next task renders byte-identically to before (no empty segment)', () => {
    const tasks = [task('T001', 'completed'), task('T002', 'ready')];
    const footer = computeRacingFooter('in_progress', { completed: 1, total: 8 }, false, tasks);
    expect(footer).toBe('🏎️ 19% · ✅ 1/8 · Next: T002');
  });

  it('completed and gate variants carry no task-name segment', () => {
    const tasks = [
      named('T001', 'completed', 'config gate'),
      named('T002', 'completed', 'worktree module'),
    ];
    expect(computeRacingFooter('completed', { completed: 2, total: 2 }, false, tasks)).toBe(
      '🏁 100% · ✅ 2/2 · Complete',
    );
    expect(computeRacingFooter('in_progress', { completed: 2, total: 2 }, false, tasks)).toBe(
      '🏁 85% · ✅ 2/2 · Next: verification',
    );
  });

  it('every variant stays a single line', () => {
    const tasks = [
      task('T001', 'completed'),
      named('T002', 'ready', 'a name with spaces and punctuation, kept verbatim'),
    ];
    const footer = computeRacingFooter('in_progress', { completed: 1, total: 8 }, false, tasks);
    expect(footer).not.toContain('\n');
  });
});

describe('getFooterForActiveMilestone (M025/T001)', () => {
  it('returns null when no active milestone is set and never throws', async () => {
    const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { execFileSync } = await import('node:child_process');
    const { getFooterForActiveMilestone } = await import('../../src/core/milestones/footer.js');
    const { saveState } = await import('../../src/state/store.js');
    const dir = mkdtempSync(join(tmpdir(), 'pitway-footer-unit-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir });
      mkdirSync(join(dir, '.pitway'), { recursive: true });
      writeFileSync(join(dir, '.pitway', 'config.yaml'), 'schema_version: 1\n');
      // minimal state with no active milestone
      saveState(dir, { schema_version: 1, active_milestone: null, milestones: [] });
      expect(getFooterForActiveMilestone(dir)).toBeNull();
      expect(getFooterForActiveMilestone(join(dir, 'nonexistent'))).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null for a draft milestone and a real footer once confirmed', async () => {
    const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { execFileSync } = await import('node:child_process');
    const dir = mkdtempSync(join(tmpdir(), 'pitway-footer-unit2-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
      writeFileSync(join(dir, 'README.md'), 'x\n');
      execFileSync('git', ['add', 'README.md'], { cwd: dir });
      execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
      const { buildCli } = await import('../../src/cli/index.js');
      const { registerInitCommand } = await import('../../src/cli/commands/init.js');
      const { registerMilestoneAddCommand } = await import('../../src/cli/commands/milestone-add.js');
      const { getFooterForActiveMilestone } = await import('../../src/core/milestones/footer.js');
      const prog = buildCli();
      registerInitCommand(prog, { root: dir, write: () => {} });
      await prog.parseAsync(['node', 'pitway', 'init', '--no-claude']);
      const scratch = mkdtempSync(join(tmpdir(), 'pitway-footer-scratch-'));
      const contract = join(scratch, 'c.md');
      const tasks = join(scratch, 't.yaml');
      writeFileSync(contract, `---
schema_version: 1
id: M999
title: Footer unit
status: draft
requirement: null
confirmed_at: null
verification_approved_hash: null
acceptance_criteria:
  - id: AC001
    text: x
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: echo ok
---

# Contract

## Objective

X.

## Change Log
`);
      writeFileSync(tasks, `schema_version: 1
tasks:
  - id: T001
    objective: x
    status: planned
    depends_on: []
    acceptance_criteria: [x]
    relevant_files: []
    verification: { strategy: tdd, detail: npm test }
    result: null
    usage: null
`);
      const prog2 = buildCli();
      registerMilestoneAddCommand(prog2, { root: dir, write: () => {} });
      await prog2.parseAsync(['node', 'pitway', 'milestone-add', '--contract', contract, '--tasks', tasks]);
      expect(getFooterForActiveMilestone(dir)).toBeNull();
      const { registerMilestoneConfirmCommand } = await import('../../src/cli/commands/milestone-confirm.js');
      const prog3 = buildCli();
      registerMilestoneConfirmCommand(prog3, { root: dir, write: () => {} });
      await prog3.parseAsync(['node', 'pitway', 'milestone-confirm', 'M001']);
      const footer = getFooterForActiveMilestone(dir);
      expect(footer).not.toBeNull();
      expect(footer).toMatch(/^🏎️ \d+% · ✅/);
      rmSync(scratch, { recursive: true, force: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
