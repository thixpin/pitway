import { describe, expect, it } from 'vitest';
import { resolveReadyTasks } from '../../src/core/tasks/dependencies.js';
import type { Task } from '../../src/state/schemas.js';

const task = (overrides: Partial<Task> & Pick<Task, 'id' | 'status'>): Task => ({
  objective: 'x',
  depends_on: [],
  acceptance_criteria: ['x'],
  relevant_files: [],
  verification: { strategy: 'tdd', detail: 'npm test' },
  result: null,
  usage: null,
  ...overrides,
});

describe('resolveReadyTasks', () => {
  it('promotes a waiting task to ready when it has no dependencies', () => {
    const tasks = [task({ id: 'T001', status: 'waiting', depends_on: [] })];
    const resolved = resolveReadyTasks(tasks);
    expect(resolved.find((t) => t.id === 'T001')?.status).toBe('ready');
  });

  it('promotes a waiting task to ready only when all dependencies are completed', () => {
    const tasks = [
      task({ id: 'T001', status: 'completed', depends_on: [] }),
      task({ id: 'T002', status: 'in_progress', depends_on: [] }),
      task({ id: 'T003', status: 'waiting', depends_on: ['T001', 'T002'] }),
    ];
    const resolved = resolveReadyTasks(tasks);
    expect(resolved.find((t) => t.id === 'T003')?.status).toBe('waiting');
  });

  it('promotes once every dependency completes', () => {
    const tasks = [
      task({ id: 'T001', status: 'completed', depends_on: [] }),
      task({ id: 'T002', status: 'completed', depends_on: [] }),
      task({ id: 'T003', status: 'waiting', depends_on: ['T001', 'T002'] }),
    ];
    const resolved = resolveReadyTasks(tasks);
    expect(resolved.find((t) => t.id === 'T003')?.status).toBe('ready');
  });

  it('leaves non-waiting tasks untouched', () => {
    const tasks = [task({ id: 'T001', status: 'blocked', depends_on: [] })];
    const resolved = resolveReadyTasks(tasks);
    expect(resolved.find((t) => t.id === 'T001')?.status).toBe('blocked');
  });

  it('detects a dependency cycle and names it', () => {
    const tasks = [
      task({ id: 'T001', status: 'waiting', depends_on: ['T002'] }),
      task({ id: 'T002', status: 'waiting', depends_on: ['T001'] }),
    ];
    expect(() => resolveReadyTasks(tasks)).toThrowError(/T001.*T002|T002.*T001/);
  });

  it('reports an unknown dependency reference explicitly', () => {
    const tasks = [task({ id: 'T001', status: 'waiting', depends_on: ['T999'] })];
    expect(() => resolveReadyTasks(tasks)).toThrowError(/T999/);
  });
});
