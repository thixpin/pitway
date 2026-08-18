import { describe, expect, it } from 'vitest';
import {
  canTransitionMilestone,
  transitionMilestone,
} from '../../src/core/milestones/state-machine.js';
import type { MilestoneStatus } from '../../src/state/schemas.js';

const ALL_STATUSES: MilestoneStatus[] = [
  'draft',
  'confirmed',
  'in_progress',
  'review',
  'completed',
  'cancelled',
];

const LEGAL: Array<[MilestoneStatus, MilestoneStatus]> = [
  ['draft', 'confirmed'],
  ['confirmed', 'in_progress'],
  ['in_progress', 'review'],
  ['review', 'completed'],
  ['review', 'in_progress'],
  ['draft', 'cancelled'],
  ['confirmed', 'cancelled'],
];

describe('milestone state machine', () => {
  it.each(LEGAL)('allows %s -> %s', (from, to) => {
    expect(canTransitionMilestone(from, to)).toBe(true);
    expect(transitionMilestone(from, to)).toBe(to);
  });

  const legalSet = new Set(LEGAL.map(([from, to]) => `${from}->${to}`));
  const illegal: Array<[MilestoneStatus, MilestoneStatus]> = [];
  for (const from of ALL_STATUSES) {
    for (const to of ALL_STATUSES) {
      if (from === to) continue;
      if (!legalSet.has(`${from}->${to}`)) illegal.push([from, to]);
    }
  }

  it.each(illegal)('rejects %s -> %s', (from, to) => {
    expect(canTransitionMilestone(from, to)).toBe(false);
    expect(() => transitionMilestone(from, to)).toThrowError(/allowed/);
  });

  it('error message names the allowed target states', () => {
    expect(() => transitionMilestone('completed', 'draft')).toThrowError(/completed/);
  });
});
