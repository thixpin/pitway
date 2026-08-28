import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { accumulateUsage, computeUsageWarning, parseUsageInput } from '../../src/core/tasks/usage.js';
import { TaskUpdateError } from '../../src/core/tasks/update.js';
import { appendWorktreeDispatchRecord } from '../../src/state/journal.js';

// M039/T001 (AC004): --usage parsing, honest accumulation, and the
// dispatched-without---usage warning, exercised directly.

describe('accumulateUsage', () => {
  it('sums every measured field when both sides carry it', () => {
    expect(
      accumulateUsage(
        { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
      ),
    ).toEqual({ input_tokens: 11, output_tokens: 7, total_tokens: 18 });
  });

  it('keeps a field measured on only one side, and omits a field neither side measured', () => {
    expect(accumulateUsage({ total_tokens: 15 }, { input_tokens: 4, total_tokens: 3 })).toEqual({
      input_tokens: 4,
      total_tokens: 18,
    });
    expect(accumulateUsage({ total_tokens: 1 }, { total_tokens: 2 })).toEqual({ total_tokens: 3 });
  });

  it('returns the other side unchanged when either side is null (never estimates)', () => {
    expect(accumulateUsage(null, { total_tokens: 3 })).toEqual({ total_tokens: 3 });
    expect(accumulateUsage({ total_tokens: 3 }, null)).toEqual({ total_tokens: 3 });
    expect(accumulateUsage(null, null)).toBeNull();
  });
});

describe('parseUsageInput', () => {
  it('parses a valid measured-usage JSON object', () => {
    expect(parseUsageInput('{"input_tokens":1,"output_tokens":2,"total_tokens":3}')).toEqual({
      input_tokens: 1,
      output_tokens: 2,
      total_tokens: 3,
    });
  });

  it('refuses malformed JSON with the --usage JSON message', () => {
    expect(() => parseUsageInput('{not json')).toThrow(TaskUpdateError);
    expect(() => parseUsageInput('{not json')).toThrow(/^invalid --usage JSON: /);
  });

  it('refuses a schema violation with the --usage message', () => {
    expect(() => parseUsageInput('{"total_tokens":"lots"}')).toThrow(TaskUpdateError);
    expect(() => parseUsageInput('{"total_tokens":"lots"}')).toThrow(/^invalid --usage: /);
  });
});

describe('computeUsageWarning', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pitway-task-usage-'));
    execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'pipe' });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function dispatch(taskId: string): void {
    appendWorktreeDispatchRecord(root, {
      id: `wtd-${taskId}`,
      milestone: 'M001',
      taskId,
      branch: `pitway/task/M001-${taskId}`,
      worktreePath: join(root, '.pitway-worktrees', `M001-${taskId}`),
      createdFrom: 'a'.repeat(40),
      at: '2026-08-28T00:00:00Z',
    });
  }

  it('returns null when the task was never worktree-dispatched', () => {
    expect(computeUsageWarning(root, 'M001', 'T001', false)).toBeNull();
    dispatch('T002');
    expect(computeUsageWarning(root, 'M001', 'T001', false)).toBeNull();
  });

  it('returns the actionable warning when dispatched and no --usage was supplied', () => {
    dispatch('T001');
    expect(computeUsageWarning(root, 'M001', 'T001', false)).toBe(
      'T001 was completed after a worktree dispatch with no --usage supplied; ' +
        'its usage stays null -> N/A (detection only, never estimated). ' +
        "Forward the dispatched sub-agent's reported usage via --usage on this completing call per dispatch.md step 8 -- " +
        'this cannot be added retroactively once the task is completed; if the usage is genuinely unavailable, null is correct',
    );
  });

  it('returns null whenever --usage was supplied, regardless of dispatch history', () => {
    dispatch('T001');
    expect(computeUsageWarning(root, 'M001', 'T001', true)).toBeNull();
  });
});
