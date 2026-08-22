import { describe, expect, it } from 'vitest';
import { checkWriteScope } from '../../src/core/tasks/write-scope-check.js';
import type { Task } from '../../src/state/schemas.js';

// Minimal valid task fixture; individual tests override write_scope/
// relevant_files/context_files as needed via spread.
const baseTask: Task = {
  id: 'T001',
  objective: 'Do the thing.',
  status: 'ready',
  depends_on: [],
  acceptance_criteria: ['It works'],
  write_scope: ['src/a.ts', 'src/b.ts'],
  context_files: ['src/a.ts', 'src/b.ts', 'src/read-only.ts'],
  verification: { strategy: 'tdd', detail: 'npm test' },
  result: null,
  usage: null,
};

describe('checkWriteScope (AC004)', () => {
  it('reports ok with no out-of-scope paths when every write path is within write_scope', () => {
    const result = checkWriteScope(['src/a.ts', 'src/b.ts'], baseTask);
    expect(result).toEqual({ ok: true, outOfScope: [] });
  });

  it('names every write path outside write_scope', () => {
    const result = checkWriteScope(['src/a.ts', 'src/c.ts', 'src/d.ts'], baseTask);
    expect(result.ok).toBe(false);
    expect(result.outOfScope).toEqual(['src/c.ts', 'src/d.ts']);
  });

  it('falls back to legacy relevant_files when write_scope is absent', () => {
    const { write_scope: _write_scope, context_files: _context_files, ...rest } = baseTask;
    const legacyTask: Task = { ...rest, relevant_files: ['src/legacy.ts'] };
    expect(checkWriteScope(['src/legacy.ts'], legacyTask)).toEqual({ ok: true, outOfScope: [] });
    expect(checkWriteScope(['src/other.ts'], legacyTask)).toEqual({
      ok: false,
      outOfScope: ['src/other.ts'],
    });
  });

  it('never validates against context_files: a context_files-listed path not in write_scope is still out of scope', () => {
    // src/read-only.ts is declared in context_files (supplied for reading)
    // but not in write_scope -- the helper must still flag it as an
    // out-of-scope WRITE, proving it does not silently accept context_files
    // membership as a substitute for write_scope membership.
    const result = checkWriteScope(['src/read-only.ts'], baseTask);
    expect(result).toEqual({ ok: false, outOfScope: ['src/read-only.ts'] });
  });

  it('treats an empty write path list as trivially in scope', () => {
    expect(checkWriteScope([], baseTask)).toEqual({ ok: true, outOfScope: [] });
  });

  it('treats a task carrying neither write_scope nor relevant_files as an empty scope: every write is out of scope', () => {
    // The pure helper takes any structured Task value; when both scope styles
    // are absent the boundary is the empty set, so nothing may be written --
    // it must never silently treat "no declaration" as "everything allowed".
    const { write_scope: _write_scope, context_files: _context_files, ...scopeless } = baseTask;
    expect(checkWriteScope(['src/a.ts'], scopeless as Task)).toEqual({
      ok: false,
      outOfScope: ['src/a.ts'],
    });
    expect(checkWriteScope([], scopeless as Task)).toEqual({ ok: true, outOfScope: [] });
  });
});
