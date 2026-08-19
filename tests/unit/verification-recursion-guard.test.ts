import { describe, expect, it } from 'vitest';
import { evaluateRecursionGuard } from '../../src/core/verification/recursion-guard.js';

describe('evaluateRecursionGuard', () => {
  it('extends an empty/undefined guard value with the candidate token', () => {
    const result = evaluateRecursionGuard(undefined, '/repo/a#M001');
    expect(result).toEqual({ decision: 'extend', value: '/repo/a#M001' });

    const resultEmpty = evaluateRecursionGuard('', '/repo/a#M001');
    expect(resultEmpty).toEqual({ decision: 'extend', value: '/repo/a#M001' });
  });

  it('extends by appending when the candidate is not already present', () => {
    const result = evaluateRecursionGuard('/repo/a#M001', '/repo/b#M002');
    expect(result).toEqual({ decision: 'extend', value: '/repo/a#M001,/repo/b#M002' });
  });

  it('refuses an exact repeat of the same repo+milestone token', () => {
    const result = evaluateRecursionGuard('/repo/a#M001', '/repo/a#M001');
    expect(result).toEqual({ decision: 'refuse', token: '/repo/a#M001' });
  });

  it('refuses a repeat even when it is not the most recently added token', () => {
    const result = evaluateRecursionGuard('/repo/a#M001,/repo/b#M002', '/repo/a#M001');
    expect(result.decision).toBe('refuse');
  });

  it('two different repo+milestone tokens do not trip each other', () => {
    // Same repo, different milestone.
    const sameRepoDiffMilestone = evaluateRecursionGuard('/repo/a#M001', '/repo/a#M002');
    expect(sameRepoDiffMilestone.decision).toBe('extend');

    // Different repo, same milestone id string.
    const diffRepoSameMilestone = evaluateRecursionGuard('/repo/a#M001', '/repo/b#M001');
    expect(diffRepoSameMilestone.decision).toBe('extend');
  });

  it('is a pure string function: no I/O, deterministic on plain strings', () => {
    const a = evaluateRecursionGuard('tok1,tok2', 'tok3');
    const b = evaluateRecursionGuard('tok1,tok2', 'tok3');
    expect(a).toEqual(b);
  });
});
