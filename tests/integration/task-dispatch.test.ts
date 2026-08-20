import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCli } from '../../src/cli/index.js';
import { registerInitCommand } from '../../src/cli/commands/init.js';
import { registerMilestoneAddCommand } from '../../src/cli/commands/milestone-add.js';
import { registerMilestoneConfirmCommand } from '../../src/cli/commands/milestone-confirm.js';
import { registerTaskDispatchCommand } from '../../src/cli/commands/task-dispatch.js';
import { registerTaskUpdateCommand } from '../../src/cli/commands/task-update.js';
import { loadConfig, loadTasks, saveConfig } from '../../src/state/store.js';
import { readJournal, type JournalWorktreeDispatch } from '../../src/state/journal.js';
import { deriveLiveDispatches } from '../../src/core/tasks/dispatch.js';
import { appendJournalEntry } from '../../src/state/journal.js';
import { WORKTREES_DIR } from '../../src/git/worktree.js';

// AC004/T004 (M014): task-dispatch refusal matrix + happy paths against
// real temp repos.

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

const CONTRACT_FIXTURE = `---
schema_version: 1
id: M999
title: Parallel milestone
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

// T001/T002 are independent with disjoint scopes; T003 overlaps T001;
// T004 depends on T001 (never ready while T001 runs); T005 is legacy-scoped.
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
  - id: T003
    objective: Overlaps the first task.
    status: planned
    depends_on: []
    acceptance_criteria:
      - It works
    context_files:
      - src/a.ts
      - src/c.ts
    write_scope:
      - src/a.ts
      - src/c.ts
    verification:
      strategy: tdd
      detail: npm test
    result: null
    usage: null
  - id: T004
    objective: Depends on the first task.
    status: planned
    depends_on: [T001]
    acceptance_criteria:
      - It works
    context_files:
      - src/d.ts
    write_scope:
      - src/d.ts
    verification:
      strategy: tdd
      detail: npm test
    result: null
    usage: null
  - id: T005
    objective: Legacy-scoped task.
    status: planned
    depends_on: []
    acceptance_criteria:
      - It works
    relevant_files:
      - src/e.ts
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
  registerTaskDispatchCommand(program, { root, write: (s) => lines.push(s) });
  registerTaskUpdateCommand(program, { root, write: (s) => lines.push(s) });
  try {
    await program.parseAsync(['node', 'pitway', ...args]);
    return { lines };
  } catch (error) {
    return { lines, error: error as Error };
  }
}

// The strategy must be in config BEFORE confirmation so the baseline commit
// folds it in -- an uncommitted config.yaml would (correctly) trip the
// clean-tree check at dispatch. Matches the real flow: enabling parallel
// execution is a committed repository policy, not an ad hoc toggle.
async function confirmMilestone(strategy?: 'parallel_worktrees'): Promise<void> {
  if (strategy) {
    saveConfig(root, { ...loadConfig(root), execution: { strategy } });
  }
  const contract = join(scratch, 'contract.md');
  const tasks = join(scratch, 'tasks.yaml');
  writeFileSync(contract, CONTRACT_FIXTURE);
  writeFileSync(tasks, TASKS_FIXTURE);
  expect((await run(['milestone-add', '--contract', contract, '--tasks', tasks])).error).toBeUndefined();
  expect((await run(['milestone-confirm', 'M001'])).error).toBeUndefined();
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'pitway-disp-'));
  scratch = mkdtempSync(join(tmpdir(), 'pitway-disp-in-'));
  git(['init', '-q'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  writeFileSync(join(root, 'README.md'), 'seed\n');
  git(['add', 'README.md'], root);
  git(['commit', '-q', '-m', 'init'], root);
  await run(['init', '--no-claude']);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

describe('pitway task-dispatch (M014/T004)', () => {
  it('dispatches two eligible tasks side by side, each with its own worktree and live record', async () => {
    await confirmMilestone('parallel_worktrees');
    expect((await run(['task-dispatch', 'T001'])).error).toBeUndefined();
    expect((await run(['task-dispatch', 'T002'])).error).toBeUndefined();

    const tasks = loadTasks(root, 'M001').tasks;
    expect(tasks.find((t) => t.id === 'T001')?.status).toBe('in_progress');
    expect(tasks.find((t) => t.id === 'T002')?.status).toBe('in_progress');
    expect(tasks.find((t) => t.id === 'T001')?.attempts).toBe(1);

    expect(existsSync(join(root, WORKTREES_DIR, 'M001-T001'))).toBe(true);
    expect(existsSync(join(root, WORKTREES_DIR, 'M001-T002'))).toBe(true);

    const live = deriveLiveDispatches(readJournal(root), 'M001');
    expect(live.map((d) => d.taskId).sort()).toEqual(['T001', 'T002']);
    const record = live[0]!;
    expect(record.branch).toBe('pitway/task/M001-T001');
    expect(record.createdFrom).toMatch(/^[0-9a-f]{40}$/);
    // The record's createdFrom matches the worktree's actual branch point.
    expect(record.createdFrom).toBe(git(['rev-parse', 'HEAD'], root).trim());
  });

  it('emits the worker handoff envelope as JSON without embedding a context bundle', async () => {
    await confirmMilestone('parallel_worktrees');
    const result = await run(['task-dispatch', 'T001', '--json']);
    expect(result.error).toBeUndefined();
    const view = JSON.parse(result.lines.join('\n')) as Record<string, unknown>;
    expect(view.id).toBe('T001');
    expect(view.branch).toBe('pitway/task/M001-T001');
    expect(String(view.worktreePath)).toContain(`${WORKTREES_DIR}/M001-T001`);
    expect(view.createdFrom).toMatch(/^[0-9a-f]{40}$/);
    expect(view).not.toHaveProperty('contextBundle');
    expect(view).not.toHaveProperty('contract');
  });

  it('refuses a write-scope overlap with a dispatched task, naming the conflict', async () => {
    await confirmMilestone('parallel_worktrees');
    expect((await run(['task-dispatch', 'T001'])).error).toBeUndefined();
    const result = await run(['task-dispatch', 'T003']);
    expect(result.error?.message).toContain('T001');
    expect(result.error?.message).toContain('src/a.ts');
    expect(existsSync(join(root, WORKTREES_DIR, 'M001-T003'))).toBe(false);
  });

  it('refuses overlap with an INLINE in_progress task (no dispatch record involved)', async () => {
    await confirmMilestone('parallel_worktrees');
    expect((await run(['task-update', 'T001', 'in_progress'])).error).toBeUndefined();
    const result = await run(['task-dispatch', 'T003']);
    expect(result.error?.message).toContain('T001');
  });

  it('refuses under sequential strategy with a clear diagnostic', async () => {
    await confirmMilestone();
    const result = await run(['task-dispatch', 'T001']);
    expect(result.error?.message).toContain('parallel_worktrees');
    expect(result.error?.message).toContain('sequential');
    expect(loadTasks(root, 'M001').tasks.find((t) => t.id === 'T001')?.status).toBe('ready');
  });

  it('refuses an ineligible-status task (waiting on a dependency)', async () => {
    await confirmMilestone('parallel_worktrees');
    const result = await run(['task-dispatch', 'T004']);
    expect(result.error?.message).toContain('not ready');
  });

  it('refuses a legacy relevant_files task', async () => {
    await confirmMilestone('parallel_worktrees');
    const result = await run(['task-dispatch', 'T005']);
    expect(result.error?.message).toContain('write_scope');
  });

  it('refuses on a dirty main working tree, leaving the task untouched', async () => {
    await confirmMilestone('parallel_worktrees');
    writeFileSync(join(root, 'README.md'), 'dirtied\n');
    const result = await run(['task-dispatch', 'T001']);
    expect(result.error).toBeDefined();
    expect(loadTasks(root, 'M001').tasks.find((t) => t.id === 'T001')?.status).toBe('ready');
    expect(existsSync(join(root, WORKTREES_DIR, 'M001-T001'))).toBe(false);
  });

  it('refuses while a journal-pending amendment exists for the milestone', async () => {
    await confirmMilestone('parallel_worktrees');
    appendJournalEntry(root, {
      milestone: 'M001',
      type: 'task_amendment',
      operationId: 'op-test-1',
      payload: {},
    });
    const result = await run(['task-dispatch', 'T001']);
    expect(result.error?.message).toContain('journal-pending');
    expect(result.error?.message).toContain('op-test-1');
    expect(loadTasks(root, 'M001').tasks.find((t) => t.id === 'T001')?.status).toBe('ready');
  });

  it('deriveLiveDispatches treats a closing record as ending liveness', async () => {
    await confirmMilestone('parallel_worktrees');
    expect((await run(['task-dispatch', 'T001'])).error).toBeUndefined();
    const dispatch = deriveLiveDispatches(readJournal(root), 'M001')[0]!;
    // Simulate a future closing record shape (kind added by a later task):
    // liveness derivation is forward-compatible via dispatchId reference.
    const closed = deriveLiveDispatches(
      [
        ...readJournal(root),
        {
          kind: 'worktree_integrate',
          dispatchId: dispatch.id,
        } as unknown as JournalWorktreeDispatch,
      ],
      'M001',
    );
    expect(closed).toEqual([]);
  });
});
