import { describe, expect, it } from 'vitest';
import { canTransitionTask, transitionTask } from '../../src/core/tasks/state-machine.js';
import type { TaskStatus } from '../../src/state/schemas.js';

const ALL_STATUSES: TaskStatus[] = [
  'planned',
  'waiting',
  'ready',
  'in_progress',
  'blocked',
  'review',
  'completed',
  'failed',
  'cancelled',
];

const LEGAL: Array<[TaskStatus, TaskStatus]> = [
  ['planned', 'waiting'],
  ['waiting', 'ready'],
  ['ready', 'in_progress'],
  ['in_progress', 'review'],
  ['review', 'completed'],
  ['in_progress', 'blocked'],
  ['blocked', 'ready'],
  ['in_progress', 'failed'],
  ['failed', 'ready'],
  ['planned', 'cancelled'],
  ['waiting', 'cancelled'],
  ['ready', 'cancelled'],
];

describe('task state machine', () => {
  it.each(LEGAL)('allows %s -> %s', (from, to) => {
    expect(canTransitionTask(from, to)).toBe(true);
    expect(transitionTask(from, to)).toBe(to);
  });

  const legalSet = new Set(LEGAL.map(([from, to]) => `${from}->${to}`));
  const illegal: Array<[TaskStatus, TaskStatus]> = [];
  for (const from of ALL_STATUSES) {
    for (const to of ALL_STATUSES) {
      if (from === to) continue;
      if (!legalSet.has(`${from}->${to}`)) illegal.push([from, to]);
    }
  }

  it.each(illegal)('rejects %s -> %s', (from, to) => {
    expect(canTransitionTask(from, to)).toBe(false);
    expect(() => transitionTask(from, to)).toThrowError(/allowed/);
  });

  it('error message names the allowed target states', () => {
    expect(() => transitionTask('completed', 'in_progress')).toThrowError(/completed/);
  });
});
