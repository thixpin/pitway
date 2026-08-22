import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCli } from '../../src/cli/index.js';
import { registerTaskDiscardCommand as registerTaskDiscardBare } from '../../src/cli/commands/task-discard.js';
import { discardTask, TaskDiscardError } from '../../src/core/tasks/discard.js';
import { saveState } from '../../src/state/store.js';
import { registerInitCommand } from '../../src/cli/commands/init.js';
import { registerMilestoneAddCommand } from '../../src/cli/commands/milestone-add.js';
import { registerMilestoneConfirmCommand } from '../../src/cli/commands/milestone-confirm.js';
import { registerResumeCommand } from '../../src/cli/commands/resume.js';
import { registerTaskDiscardCommand } from '../../src/cli/commands/task-discard.js';
import { registerTaskUpdateCommand } from '../../src/cli/commands/task-update.js';
import { loadConfig, loadTasks, saveConfig } from '../../src/state/store.js';
import { readJournal } from '../../src/state/journal.js';
import { dispatchTask } from '../../src/core/tasks/dispatch.js';
import type { ParallelView } from '../../src/cli/commands/resume.js';

// AC008/T008 (M014): task-discard lifecycle, the single-exit guard on
// task-update, and resume's four-class residue reporting.

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

const CONTRACT_FIXTURE = `---
schema_version: 1
id: M999
title: Discardable milestone
status: draft
requirement: null
confirmed_at: null
verification_approved_hash: null
acceptance_criteria:
  - id: AC001
    text: Behavior holds.
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npm test
---

# Contract

## Objective

Example.

## Change Log
`;

const TASKS_FIXTURE = `schema_version: 1
tasks:
  - id: T001
    objective: First independent task.
    status: planned
    depends_on: []
    acceptance_criteria:
      - It works
    context_files:
      - src/a.ts
    write_scope:
      - src/a.ts
    verification:
      strategy: tdd
      detail: npm test
    result: null
    usage: null
  - id: T002
    objective: Second independent task.
    status: planned
    depends_on: []
    acceptance_criteria:
      - It works
    context_files:
      - src/b.ts
    write_scope:
      - src/b.ts
    verification:
      strategy: tdd
      detail: npm test
    result: null
    usage: null
`;

let root: string;
let scratch: string;

async function run(args: string[]): Promise<{ lines: string[]; error?: Error }> {
  const program = buildCli();
  const lines: string[] = [];
  registerInitCommand(program, { root, write: (s) => lines.push(s) });
  registerMilestoneAddCommand(program, { root, write: (s) => lines.push(s) });
  registerMilestoneConfirmCommand(program, { root, write: (s) => lines.push(s) });
  registerResumeCommand(program, { root, write: (s) => lines.push(s) });
  registerTaskDiscardCommand(program, { root, write: (s) => lines.push(s) });
  registerTaskUpdateCommand(program, { root, write: (s) => lines.push(s) });
  try {
    await program.parseAsync(['node', 'pitway', ...args]);
    return { lines };
  } catch (error) {
    return { lines, error: error as Error };
  }
}

async function resumeParallel(): Promise<ParallelView> {
  const result = await run(['resume', '--json']);
  expect(result.error).toBeUndefined();
  const view = JSON.parse(result.lines.join('\n')) as { parallel: ParallelView | null };
  expect(view.parallel).not.toBeNull();
  return view.parallel!;
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'pitway-disc-'));
  scratch = mkdtempSync(join(tmpdir(), 'pitway-disc-in-'));
  git(['init', '-q'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  writeFileSync(join(root, 'README.md'), 'seed\n');
  git(['add', 'README.md'], root);
  git(['commit', '-q', '-m', 'init'], root);
  await run(['init', '--no-claude']);
  saveConfig(root, { ...loadConfig(root), execution: { strategy: 'parallel_worktrees' } });
  const contract = join(scratch, 'contract.md');
  const tasks = join(scratch, 'tasks.yaml');
  writeFileSync(contract, CONTRACT_FIXTURE);
  writeFileSync(tasks, TASKS_FIXTURE);
  expect((await run(['milestone-add', '--contract', contract, '--tasks', tasks])).error).toBeUndefined();
  expect((await run(['milestone-confirm', 'M001'])).error).toBeUndefined();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

describe('pitway task-discard (M014/T008)', () => {
  it('discard-then-redispatch: cleanup, failed transition, failed -> ready -> fresh dispatch', async () => {
    const first = dispatchTask(root, 'T001');
    const result = await run(['task-discard', 'T001', '--reason', 'worker went off-scope']);
    expect(result.error).toBeUndefined();

    expect(existsSync(first.worktreePath)).toBe(false);
    expect(git(['branch', '--list', 'pitway/task/M001-T001'], root).trim()).toBe('');
    expect(loadTasks(root, 'M001').tasks.find((t) => t.id === 'T001')?.status).toBe('failed');
    const record = readJournal(root).find((r) => r.kind === 'worktree_discard');
    expect(record).toMatchObject({
      taskId: 'T001',
      dispatchId: first.dispatchId,
      reason: 'worker went off-scope',
    });

    // failed -> ready, then a fresh dispatch works (attempts accumulate).
    expect((await run(['task-update', 'T001', 'ready'])).error).toBeUndefined();
    const second = dispatchTask(root, 'T001');
    expect(existsSync(second.worktreePath)).toBe(true);
    expect(loadTasks(root, 'M001').tasks.find((t) => t.id === 'T001')?.attempts).toBe(2);
  });

  it('requires an explicit --reason', async () => {
    dispatchTask(root, 'T001');
    const result = await run(['task-discard', 'T001']);
    expect(result.error?.message).toContain('--reason');
  });

  it('tolerates an already-vanished worktree, recording discardedSha from the surviving branch', async () => {
    const dispatched = dispatchTask(root, 'T001');
    rmSync(dispatched.worktreePath, { recursive: true, force: true });
    git(['worktree', 'prune'], root);

    const result = await run(['task-discard', 'T001', '--reason', 'crashed dispatch']);
    expect(result.error).toBeUndefined();
    expect(git(['branch', '--list', 'pitway/task/M001-T001'], root).trim()).toBe('');
    expect(loadTasks(root, 'M001').tasks.find((t) => t.id === 'T001')?.status).toBe('failed');
  });

  it('refuses when no milestone is active', () => {
    saveState(root, { schema_version: 1, active_milestone: null, milestones: ['M001'] });
    expect(() => discardTask(root, 'T001', 'reason')).toThrow(TaskDiscardError);
    expect(() => discardTask(root, 'T001', 'reason')).toThrow(/no active milestone/);
  });

  it('refuses under sequential strategy with a clear diagnostic', () => {
    saveConfig(root, { schema_version: 1 });
    expect(() => discardTask(root, 'T001', 'reason')).toThrow(/parallel_worktrees/);
    expect(() => discardTask(root, 'T001', 'reason')).toThrow(/"sequential"/);
  });

  it('refuses an unknown task id, naming the milestone', () => {
    expect(() => discardTask(root, 'T404', 'reason')).toThrow(/unknown task T404 in milestone M001/);
  });

  it('refuses a task with no live dispatch record', () => {
    expect(() => discardTask(root, 'T001', 'reason')).toThrow(/no live worktree dispatch record/);
  });

  it('records discardedSha: null and skips branch deletion when worktree AND branch are both already gone', async () => {
    const dispatched = dispatchTask(root, 'T001');
    rmSync(dispatched.worktreePath, { recursive: true, force: true });
    git(['worktree', 'prune'], root);
    git(['branch', '-D', 'pitway/task/M001-T001'], root);

    const view = discardTask(root, 'T001', 'everything already vanished');
    expect(view.discardedSha).toBeNull();
    expect(view.worktreeRemoved).toBe(false);
    expect(view.status).toBe('failed');
    const record = readJournal(root).find((r) => r.kind === 'worktree_discard');
    expect(record).toMatchObject({ taskId: 'T001', discardedSha: null });
  });

  it('renders the was-already-gone human message and falls back to console.log/process.cwd() with no deps', async () => {
    const dispatched = dispatchTask(root, 'T001');
    rmSync(dispatched.worktreePath, { recursive: true, force: true });
    git(['worktree', 'prune'], root);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cwdBefore = process.cwd();
    process.chdir(root);
    let caught: unknown;
    let calls: unknown[][] = [];
    try {
      const program = buildCli();
      registerTaskDiscardBare(program);
      await program.parseAsync(['node', 'pitway', 'task-discard', 'T001', '--reason', 'crashed dispatch']);
    } catch (error) {
      caught = error;
    } finally {
      // vitest v4: mockRestore() clears recorded calls -- capture first.
      calls = logSpy.mock.calls;
      process.chdir(cwdBefore);
      logSpy.mockRestore();
    }

    expect(caught).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toContain('was already gone');
    expect(calls[0]?.[0]).toContain('failed → ready allows re-dispatch');
  });

  it('renders the removed human message when the worktree exists (worktreeRemoved true)', async () => {
    dispatchTask(root, 'T001');
    const result = await run(['task-discard', 'T001', '--reason', 'off-scope work']);
    expect(result.error).toBeUndefined();
    const text = result.lines.join('\n');
    expect(text).toContain('worktree removed');
    expect(text).toContain('unrecoverable through PitWay');
  });

  it('task-update refuses any direct status change on a live-dispatched task, pointing at the two exits', async () => {
    dispatchTask(root, 'T001');
    for (const target of ['blocked', 'failed', 'review']) {
      const result = await run(['task-update', 'T001', target]);
      expect(result.error?.message).toContain('task-integrate');
      expect(result.error?.message).toContain('task-discard');
    }
    expect(loadTasks(root, 'M001').tasks.find((t) => t.id === 'T001')?.status).toBe('in_progress');
  });
});

describe('pitway resume residue classification (M014/T008)', () => {
  it('reports active dispatches with no residues in the normal case', async () => {
    dispatchTask(root, 'T001');
    const parallel = await resumeParallel();
    expect(parallel.activeDispatches).toHaveLength(1);
    expect(parallel.activeDispatches[0]).toMatchObject({ taskId: 'T001' });
    expect(parallel.residues).toEqual([]);
  });

  it('classifies a vanished worktree (live record, no directory)', async () => {
    const dispatched = dispatchTask(root, 'T001');
    rmSync(dispatched.worktreePath, { recursive: true, force: true });
    const parallel = await resumeParallel();
    expect(parallel.residues).toHaveLength(1);
    expect(parallel.residues[0]).toMatchObject({ class: 'vanished-worktree', taskId: 'T001' });
    expect(parallel.residues[0]!.detail).toContain('task-discard');
  });

  it('classifies a recordless managed-prefix worktree', async () => {
    const { createTaskWorktree } = await import('../../src/git/worktree.js');
    // A worktree created outside dispatch (no journal record).
    createTaskWorktree(root, 'M001', 'T002');
    const parallel = await resumeParallel();
    expect(parallel.residues.some((r) => r.class === 'recordless-worktree' && r.taskId === 'T002')).toBe(true);
  });

  it("classifies 'cleanup pending' (closed dispatch, surviving worktree)", async () => {
    const dispatched = dispatchTask(root, 'T001');
    const { appendWorktreeIntegrateRecord } = await import('../../src/state/journal.js');
    appendWorktreeIntegrateRecord(root, {
      id: 'wti-crash',
      dispatchId: dispatched.dispatchId,
      milestone: 'M001',
      taskId: 'T001',
      workerSha: 'd'.repeat(40),
      at: '2026-08-20T00:00:00Z',
    });
    const parallel = await resumeParallel();
    expect(parallel.residues.some((r) => r.class === 'cleanup-pending' && r.taskId === 'T001')).toBe(true);
  });

  it("classifies an in_progress task without a dispatch record as 'inline or interrupted'", async () => {
    expect((await run(['task-update', 'T001', 'in_progress'])).error).toBeUndefined();
    const parallel = await resumeParallel();
    expect(parallel.residues).toHaveLength(1);
    expect(parallel.residues[0]).toMatchObject({ class: 'inline-or-interrupted', taskId: 'T001' });
  });

  it('sequential repositories report parallel: null and byte-identical human output shape', async () => {
    saveConfig(root, { schema_version: 1 });
    const result = await run(['resume', '--json']);
    expect(result.error).toBeUndefined();
    const view = JSON.parse(result.lines.join('\n')) as Record<string, unknown>;
    expect(view).toHaveProperty('parallel', null);

    const human = await run(['resume']);
    expect(human.lines.join('\n')).not.toContain('Dispatched worktrees');
    expect(human.lines.join('\n')).not.toContain('Worktree residues');
  });
});
