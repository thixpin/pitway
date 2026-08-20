import { describe, expect, it } from 'vitest';
import { computeCriticalPath } from '../../src/core/tasks/critical-path.js';
import type { Task, TaskStatus } from '../../src/state/schemas.js';

function task(id: string, status: TaskStatus, dependsOn: string[] = []): Task {
  return {
    id,
    objective: 'x',
    status,
    depends_on: dependsOn,
    acceptance_criteria: ['x'],
    relevant_files: [],
    verification: { strategy: 'tdd', detail: 'npm test' },
    result: null,
    usage: null,
  };
}

describe('computeCriticalPath (M013/T004/AC006)', () => {
  it('returns the exact longest remaining chain, in dependency order', () => {
    // T001 -> T002 -> T003 -> T005 (length 4), a shorter T004 (length 1)
    // branching off T002 alone. T001-T003 are already completed; only
    // T005 itself is not yet completed, but the chain length still counts
    // through the completed predecessors since they were part of the real
    // dependency graph -- except completed/cancelled tasks are excluded
    // from the *returned* set per AC006, so only remaining tasks connected
    // to each other via depends_on form the chain.
    const tasks = [
      task('T001', 'planned'),
      task('T002', 'planned', ['T001']),
      task('T003', 'planned', ['T002']),
      task('T004', 'planned', ['T002']),
      task('T005', 'planned', ['T003']),
    ];
    expect(computeCriticalPath(tasks)).toEqual(['T001', 'T002', 'T003', 'T005']);
  });

  it('excludes completed and cancelled tasks from both the chain and its length', () => {
    const tasks = [
      task('T001', 'completed'),
      task('T002', 'ready', ['T001']),
      task('T003', 'planned', ['T002']),
      task('T004', 'cancelled', ['T002']),
    ];
    // T001 is done; the remaining chain is T002 -> T003 only.
    expect(computeCriticalPath(tasks)).toEqual(['T002', 'T003']);
  });

  it('breaks ties by ascending task id at both branch points and the final endpoint', () => {
    // Two independent chains of equal length 2: T001->T003 and T002->T004.
    const tasks = [
      task('T001', 'planned'),
      task('T002', 'planned'),
      task('T003', 'planned', ['T001']),
      task('T004', 'planned', ['T002']),
    ];
    expect(computeCriticalPath(tasks)).toEqual(['T001', 'T003']);
  });

  it('returns [] when every required task is already completed', () => {
    const tasks = [task('T001', 'completed'), task('T002', 'completed', ['T001'])];
    expect(computeCriticalPath(tasks)).toEqual([]);
  });

  it('returns [] for an empty task list', () => {
    expect(computeCriticalPath([])).toEqual([]);
  });

  it('treats a dependency on a completed task as satisfied, not extending the remaining chain', () => {
    const tasks = [
      task('T001', 'completed'),
      task('T002', 'planned', ['T001']),
    ];
    expect(computeCriticalPath(tasks)).toEqual(['T002']);
  });
});
