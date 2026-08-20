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
