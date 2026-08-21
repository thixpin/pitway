import { describe, expect, it } from 'vitest';
import { canTransitionBacklogItem, transitionBacklogItem } from '../../src/core/backlog/state-machine.js';
import type { BacklogStatus } from '../../src/state/schemas.js';

const ALL_STATUSES: BacklogStatus[] = ['pending', 'promoted', 'archived'];

const LEGAL: Array<[BacklogStatus, BacklogStatus]> = [
  ['pending', 'promoted'],
  ['pending', 'archived'],
];

describe('backlog item state machine (M018/T002)', () => {
  it.each(LEGAL)('allows %s -> %s', (from, to) => {
    expect(canTransitionBacklogItem(from, to)).toBe(true);
    expect(transitionBacklogItem(from, to)).toBe(to);
  });

  const legalSet = new Set(LEGAL.map(([from, to]) => `${from}->${to}`));
  const illegal: Array<[BacklogStatus, BacklogStatus]> = [];
  for (const from of ALL_STATUSES) {
    for (const to of ALL_STATUSES) {
      if (from === to) continue;
      if (!legalSet.has(`${from}->${to}`)) illegal.push([from, to]);
    }
  }

  it.each(illegal)('rejects %s -> %s (both promoted/archived are terminal)', (from, to) => {
    expect(canTransitionBacklogItem(from, to)).toBe(false);
    expect(() => transitionBacklogItem(from, to)).toThrowError(/allowed/);
  });

  it('error message names the allowed target states', () => {
    expect(() => transitionBacklogItem('promoted', 'archived')).toThrowError(/promoted/);
  });

  it('error message reports "(none — terminal state)" for a terminal status', () => {
    expect(() => transitionBacklogItem('archived', 'pending')).toThrowError(/terminal state/);
  });
});
