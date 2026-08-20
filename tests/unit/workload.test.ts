import { describe, expect, it } from 'vitest';
import { computeWorkloadPercentage } from '../../src/core/milestones/workload.js';

describe('computeWorkloadPercentage (M013/T003/AC003)', () => {
  it('returns exactly 5 for a freshly drafted milestone', () => {
    expect(computeWorkloadPercentage('draft', { completed: 0, total: 0 }, false)).toBe(5);
    expect(computeWorkloadPercentage('draft', { completed: 0, total: 8 }, true)).toBe(5);
  });

  it('returns exactly 10 for a confirmed milestone with 0/N progress', () => {
    expect(computeWorkloadPercentage('confirmed', { completed: 0, total: 8 }, false)).toBe(10);
  });

  it('returns exactly 85 for all-tasks-done, not yet verified', () => {
    expect(computeWorkloadPercentage('in_progress', { completed: 8, total: 8 }, false)).toBe(85);
  });

  it('returns exactly 95 for all-tasks-done and verified, not yet completed', () => {
    expect(computeWorkloadPercentage('review', { completed: 8, total: 8 }, true)).toBe(95);
  });

  it('returns exactly 100 when status is completed, even with verificationPassed: false', () => {
    expect(computeWorkloadPercentage('completed', { completed: 8, total: 8 }, false)).toBe(100);
    expect(computeWorkloadPercentage('completed', { completed: 0, total: 0 }, false)).toBe(100);
  });

  it('no non-completed status/input combination yields 100', () => {
    const statuses: Array<'confirmed' | 'in_progress' | 'review'> = ['confirmed', 'in_progress', 'review'];
    for (const status of statuses) {
      expect(computeWorkloadPercentage(status, { completed: 8, total: 8 }, true)).toBe(95);
    }
  });

  it('scales weighted task execution linearly between confirmed (10) and all-done-unverified (85)', () => {
    expect(computeWorkloadPercentage('in_progress', { completed: 2, total: 8 }, false)).toBe(
      Math.round(10 + (2 / 8) * 75),
    );
    expect(computeWorkloadPercentage('in_progress', { completed: 4, total: 8 }, false)).toBe(
      Math.round(10 + (4 / 8) * 75),
    );
  });

  it('treats a zero-total milestone as 0 task-execution ratio, not a division error', () => {
    expect(computeWorkloadPercentage('confirmed', { completed: 0, total: 0 }, false)).toBe(10);
    expect(computeWorkloadPercentage('confirmed', { completed: 0, total: 0 }, true)).toBe(20);
  });
});
