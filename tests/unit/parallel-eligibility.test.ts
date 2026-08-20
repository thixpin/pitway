import { describe, expect, it } from 'vitest';
import { checkParallelEligibility } from '../../src/core/tasks/parallel-eligibility.js';
import type { Task } from '../../src/state/schemas.js';

// AC002/T002 (M014): pure eligibility for concurrent execution -- candidate
// ready, no transitive dependency either direction, pairwise-disjoint
// declared write scopes. `concurrent` is ALL in_progress tasks, dispatched
// or inline alike.

function task(overrides: Partial<Task> & { id: string }): Task {
  return {
    id: overrides.id,
    objective: `objective for ${overrides.id}`,
    status: 'ready',
    depends_on: [],
    acceptance_criteria: ['works'],
    result: null,
    usage: null,
    ...overrides,
  } as Task;
}

const scoped = (id: string, paths: string[], overrides: Partial<Task> = {}): Task =>
  task({ id, context_files: paths, write_scope: paths, ...overrides });

describe('checkParallelEligibility (M014/T002)', () => {
  it('approves an independent, scope-disjoint pair', () => {
    const candidate = scoped('T002', ['src/b.ts']);
    const running = scoped('T001', ['src/a.ts'], { status: 'in_progress' });
    const result = checkParallelEligibility(candidate, [running], [candidate, running]);
    expect(result).toEqual({ eligible: true });
  });

  it('approves against an empty concurrent set', () => {
    const candidate = scoped('T001', ['src/a.ts']);
    const result = checkParallelEligibility(candidate, [], [candidate]);
    expect(result).toEqual({ eligible: true });
  });

  it('refuses a candidate that is not ready, naming the rule', () => {
    const candidate = scoped('T002', ['src/b.ts'], { status: 'waiting' });
    const result = checkParallelEligibility(candidate, [], [candidate]);
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.rule).toBe('candidate-not-ready');
      expect(result.detail).toContain('waiting');
    }
  });

  it('refuses on a direct dependency relationship, naming the conflicting task', () => {
    const running = scoped('T001', ['src/a.ts'], { status: 'in_progress' });
    const candidate = scoped('T002', ['src/b.ts'], { depends_on: ['T001'] });
    const result = checkParallelEligibility(candidate, [running], [candidate, running]);
    expect(result.eligible).toBe(false);
    if (!result.eligible && result.rule === 'dependency-related') {
      expect(result.conflict).toBe('T001');
    } else {
      expect.fail(`expected dependency-related, got ${JSON.stringify(result)}`);
    }
  });

  it('refuses on a transitive dependency (A -> B -> C, dispatch A, candidate C)', () => {
    const a = scoped('T001', ['src/a.ts'], { status: 'in_progress' });
    const b = scoped('T002', ['src/b.ts'], { depends_on: ['T001'] });
    const c = scoped('T003', ['src/c.ts'], { depends_on: ['T002'] });
    const result = checkParallelEligibility(c, [a], [a, b, c]);
    expect(result.eligible).toBe(false);
    if (!result.eligible && result.rule === 'dependency-related') {
      expect(result.conflict).toBe('T001');
    } else {
      expect.fail(`expected dependency-related, got ${JSON.stringify(result)}`);
    }
  });

  it('refuses on a single overlapping write-scope path, naming task and paths', () => {
    const running = scoped('T001', ['src/shared.ts', 'src/a.ts'], { status: 'in_progress' });
    const candidate = scoped('T002', ['src/shared.ts', 'src/b.ts']);
    const result = checkParallelEligibility(candidate, [running], [candidate, running]);
    expect(result.eligible).toBe(false);
    if (!result.eligible && result.rule === 'write-scope-overlap') {
      expect(result.conflict).toBe('T001');
      expect(result.paths).toEqual(['src/shared.ts']);
    } else {
      expect.fail(`expected write-scope-overlap, got ${JSON.stringify(result)}`);
    }
  });

  it('refuses overlap with an inline in_progress task (no dispatch involved)', () => {
    // The concurrent set is all in_progress tasks -- an inline task's
    // overlap is the same two-writers hazard as a dispatched one's.
    const inline = scoped('T001', ['src/a.ts'], { status: 'in_progress' });
    const candidate = scoped('T002', ['src/a.ts']);
    const result = checkParallelEligibility(candidate, [inline], [candidate, inline]);
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.rule).toBe('write-scope-overlap');
  });

  it('refuses a legacy relevant_files candidate (write boundary undeclared)', () => {
    const running = scoped('T001', ['src/a.ts'], { status: 'in_progress' });
    const candidate = task({ id: 'T002', relevant_files: ['src/b.ts'] });
    const result = checkParallelEligibility(candidate, [running], [candidate, running]);
    expect(result.eligible).toBe(false);
    if (!result.eligible && result.rule === 'write-scope-undeclared') {
      expect(result.conflict).toBe('T002');
    } else {
      expect.fail(`expected write-scope-undeclared, got ${JSON.stringify(result)}`);
    }
  });

  it('refuses when a concurrent task is the one without a declared write_scope', () => {
    const legacyRunning = task({
      id: 'T001',
      status: 'in_progress',
      relevant_files: ['src/a.ts'],
    });
    const candidate = scoped('T002', ['src/b.ts']);
    const result = checkParallelEligibility(candidate, [legacyRunning], [candidate, legacyRunning]);
    expect(result.eligible).toBe(false);
    if (!result.eligible && result.rule === 'write-scope-undeclared') {
      expect(result.conflict).toBe('T001');
    } else {
      expect.fail(`expected write-scope-undeclared, got ${JSON.stringify(result)}`);
    }
  });

  it('refuses a reverse-direction dependency (running task depends on the candidate)', () => {
    // Defense-in-depth: unreachable for well-formed graphs (a ready
    // candidate cannot have an in_progress dependent), but checked anyway.
    const candidate = scoped('T001', ['src/a.ts']);
    const running = scoped('T002', ['src/b.ts'], { status: 'in_progress', depends_on: ['T001'] });
    const result = checkParallelEligibility(candidate, [running], [candidate, running]);
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.rule).toBe('dependency-related');
  });
});
