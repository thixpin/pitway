import { describe, expect, it } from 'vitest';
import { taskSchema } from '../../src/state/schemas.js';

// M029/T003 (AC003): additive-optional driver/model traceability fields --
// stored in PitWay-owned evidence (tasks.yaml), never in Git trailers.

function baseTask() {
  return {
    id: 'T001',
    objective: 'x',
    status: 'waiting',
    depends_on: [],
    acceptance_criteria: ['x'],
    relevant_files: ['src/a.ts'],
    verification: { strategy: 'command' as const, detail: 'npm test' },
    result: null,
    usage: null,
  };
}

describe('taskSchema driver/model fields (M029/T003)', () => {
  it('accepts valid driver and model values', () => {
    const parsed = taskSchema.safeParse({ ...baseTask(), driver: 'opencode', model: 'gpt-5-codex' });
    expect(parsed.success).toBe(true);
  });

  it('accepts absence of both fields (byte-stable old shape)', () => {
    const parsed = taskSchema.safeParse(baseTask());
    expect(parsed.success).toBe(true);
  });

  it('rejects over-length values (cap 80 chars)', () => {
    const long = 'x'.repeat(81);
    expect(taskSchema.safeParse({ ...baseTask(), driver: long }).success).toBe(false);
    expect(taskSchema.safeParse({ ...baseTask(), model: long }).success).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(taskSchema.safeParse({ ...baseTask(), driver: 42 }).success).toBe(false);
    expect(taskSchema.safeParse({ ...baseTask(), model: null }).success).toBe(false);
  });
});
