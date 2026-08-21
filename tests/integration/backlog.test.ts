import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCli, registerAllCommands } from '../../src/cli/index.js';
import { addBacklogItem, BacklogError, resolveActiveMilestoneStrict } from '../../src/core/backlog/add.js';
import { promoteBacklogItem } from '../../src/core/backlog/promote.js';
import { archiveBacklogItem } from '../../src/core/backlog/archive.js';
import { listBacklogItems } from '../../src/core/backlog/list.js';
import { showBacklogItem } from '../../src/core/backlog/show.js';
import { derivePending } from '../../src/core/journal/operations.js';
import { readJournal, type JournalEntry } from '../../src/state/journal.js';
import { loadBacklog } from '../../src/state/store.js';

// M018/T002 (AC001-AC005): backlog's core lifecycle, exercised directly
// (no CLI wiring yet -- that's T003) against a real temp git repo, exactly
// the way tests/integration/task-add.test.ts exercises addTask directly
// before its own CLI task existed historically would have.

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

let root: string;
let scratch: string;

const CONTRACT_FIXTURE = `---
schema_version: 1
id: M999
title: Backlog test milestone
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
    command: node -e "console.log('1 passed')"
---

# Contract

## Objective

Example.

## Change Log

- Initial milestone contract.
`;

const TASKS_FIXTURE = `schema_version: 1
tasks:
  - id: T001
    name: First task
    objective: First task.
    status: planned
    depends_on: []
    acceptance_criteria:
      - It works
    context_files:
      - src/a.ts
    write_scope:
      - src/a.ts
    verification:
      strategy: command
      detail: node -e "console.log('1 passed')"
    result: null
    usage: null
`;

async function run(args: string[], cwd: string): Promise<{ lines: string[]; error?: Error }> {
  const program = buildCli();
  const lines: string[] = [];
  registerAllCommands(program, { root: cwd, write: (s) => lines.push(s) });
  try {
    await program.parseAsync(['node', 'pitway', ...args]);
    return { lines };
  } catch (error) {
    return { lines, error: error as Error };
  }
}

async function confirmedMilestone(): Promise<void> {
  const contract = join(root, 'draft-contract.md');
  const tasks = join(root, 'draft-tasks.yaml');
  writeFileSync(contract, CONTRACT_FIXTURE);
  writeFileSync(tasks, TASKS_FIXTURE);
  expect((await run(['milestone-add', '--contract', contract, '--tasks', tasks], root)).error).toBeUndefined();
  rmSync(contract);
  rmSync(tasks);
  expect((await run(['milestone-confirm', 'M001'], root)).error).toBeUndefined();
}

// A second, already-existing, retired (completed) milestone -- direct
// fixture construction, bypassing every command, exactly
// task-add.test.ts's writeRawMilestone technique. Used to prove a backlog
// mutation's journal entry can never be misattributed to it.
function writeRetiredMilestone(id: string): void {
  const dir = join(root, '.pitway', 'milestones', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'contract.md'),
    CONTRACT_FIXTURE.replace('id: M999', `id: ${id}`).replace('status: draft', 'status: completed'),
  );
  writeFileSync(join(dir, 'tasks.yaml'), TASKS_FIXTURE);
}

function pendingBacklogEntries(): JournalEntry[] {
  return derivePending(readJournal(root)).filter((e) => e.type === 'backlog_recording');
}

const commitCount = (cwd: string): number => Number(git(['rev-list', '--count', 'HEAD'], cwd).trim());

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'pitway-backlog-'));
  scratch = mkdtempSync(join(tmpdir(), 'pitway-backlog-in-'));
  git(['init', '-q'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  writeFileSync(join(root, 'README.md'), 'seed\n');
  git(['add', 'README.md'], root);
  git(['commit', '-q', '-m', 'init'], root);
  await run(['init', '--no-claude'], root);
  await confirmedMilestone();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

async function completeTaskT001(): Promise<void> {
  expect((await run(['task-update', 'T001', 'in_progress'], root)).error).toBeUndefined();
  expect((await run(['task-update', 'T001', 'review'], root)).error).toBeUndefined();
  const result = join(scratch, 'result.yaml');
  const message = join(scratch, 'message.txt');
  writeFileSync(result, 'summary: Done.\nevidence: node reported 1 passed\n');
  writeFileSync(message, 'task: complete T001\n');
  expect(
    (await run(['task-update', 'T001', 'completed', '--result', result, '--message', message], root))
      .error,
  ).toBeUndefined();
}

describe('backlog add', () => {
  it('records source.milestone as the active milestone by default (no --milestone/--task)', () => {
    const view = addBacklogItem(root, { title: 'Stale evidence', reason: 'Found mid-task.' });
    expect(view).toEqual({ id: 'B001', status: 'pending' });
    const item = showBacklogItem(root, 'B001');
    expect(item.source).toEqual({ milestone: 'M001', task: null });
  });

  it('records an explicit --milestone as source.milestone only', () => {
    writeRetiredMilestone('M002');
    addBacklogItem(root, { title: 'X', reason: 'Y', sourceMilestone: 'M002' });
    const item = showBacklogItem(root, 'B001');
    expect(item.source).toEqual({ milestone: 'M002', task: null });
  });

  it('records --task as source.task', () => {
    addBacklogItem(root, { title: 'X', reason: 'Y', sourceTask: 'T001' });
    const item = showBacklogItem(root, 'B001');
    expect(item.source).toEqual({ milestone: 'M001', task: 'T001' });
  });

  it('refuses a blank title', () => {
    expect(() => addBacklogItem(root, { title: '  ', reason: 'Y' })).toThrowError(/--title/);
  });

  it('refuses a blank reason', () => {
    expect(() => addBacklogItem(root, { title: 'X', reason: '  ' })).toThrowError(/--reason/);
  });

  it('refuses a source.task that does not exist in the given milestone', () => {
    expect(() => addBacklogItem(root, { title: 'X', reason: 'Y', sourceTask: 'T099' })).toThrowError(
      /T099/,
    );
  });

  it('refuses a source.milestone that does not exist', () => {
    expect(() => addBacklogItem(root, { title: 'X', reason: 'Y', sourceMilestone: 'M404' })).toThrowError(
      /M404/,
    );
  });

  it('mints sequential B\\d{3} ids', () => {
    addBacklogItem(root, { title: 'One', reason: 'R' });
    addBacklogItem(root, { title: 'Two', reason: 'R' });
    expect(loadBacklog(root).items.map((i) => i.id)).toEqual(['B001', 'B002']);
  });

  it('materializes backlog.yaml with a pending backlog_recording journal entry, no commit', () => {
    const before = commitCount(root);
    addBacklogItem(root, { title: 'X', reason: 'Y' });
    expect(commitCount(root)).toBe(before);
    expect(git(['status', '--porcelain'], root)).toMatch(/backlog\.yaml/);

    const pending = pendingBacklogEntries();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ milestone: 'M001', type: 'backlog_recording', target: 'B001' });
  });
});

describe('backlog: unconditional active-milestone journal attachment (AC004)', () => {
  it('fails clearly with no active milestone (add/promote/archive)', async () => {
    await completeTaskT001();
    expect((await run(['verify'], root)).error).toBeUndefined();
    expect((await run(['milestone-complete', 'M001'], root)).error).toBeUndefined();

    const expectedMessage = /no active milestone; run milestone-add or resume the active one first/;
    expect(() => addBacklogItem(root, { title: 'X', reason: 'Y' })).toThrowError(expectedMessage);
    expect(() => promoteBacklogItem(root, 'B001', { taskId: 'T001' })).toThrowError(expectedMessage);
    expect(() => archiveBacklogItem(root, 'B001', 'reason')).toThrowError(expectedMessage);
  });

  it('a deliberately-supplied --milestone on promote never redirects journal attachment away from the active milestone', () => {
    writeRetiredMilestone('M002');
    addBacklogItem(root, { title: 'X', reason: 'Y' });
    promoteBacklogItem(root, 'B001', { taskId: 'T001', milestoneId: 'M002' });

    const pending = pendingBacklogEntries();
    const promoteEntry = pending.find((e) => e.payload.operation === 'promote');
    expect(promoteEntry?.milestone).toBe('M001');
    expect(promoteEntry?.milestone).not.toBe('M002');

    const item = showBacklogItem(root, 'B001');
    expect(item.promoted_to).toEqual({ milestone: 'M002', task: 'T001' });
  });

  it('resolveActiveMilestoneStrict has no override parameter of any kind', () => {
    expect(resolveActiveMilestoneStrict.length).toBe(1);
  });
});

describe('backlog promote', () => {
  it('requires the referenced task to already exist', () => {
    addBacklogItem(root, { title: 'X', reason: 'Y' });
    expect(() => promoteBacklogItem(root, 'B001', { taskId: 'T099' })).toThrowError(/T099/);
  });

  it('defaults --milestone to the active milestone when omitted', () => {
    addBacklogItem(root, { title: 'X', reason: 'Y' });
    const view = promoteBacklogItem(root, 'B001', { taskId: 'T001' });
    expect(view.promoted_to).toEqual({ milestone: 'M001', task: 'T001' });
  });

  it('records promoted_to and flips status to promoted, with resolved_at set', () => {
    addBacklogItem(root, { title: 'X', reason: 'Y' });
    promoteBacklogItem(root, 'B001', { taskId: 'T001' });
    const item = showBacklogItem(root, 'B001');
    expect(item.status).toBe('promoted');
    expect(item.promoted_to).toEqual({ milestone: 'M001', task: 'T001' });
    expect(item.resolved_at).not.toBeNull();
  });

  it('never creates a task or milestone itself -- the task graph is unchanged after promote', async () => {
    addBacklogItem(root, { title: 'X', reason: 'Y' });
    const status = await run(['milestone-status', 'M001'], root);
    const before = status.lines.join('\n');
    promoteBacklogItem(root, 'B001', { taskId: 'T001' });
    const after = (await run(['milestone-status', 'M001'], root)).lines.join('\n');
    expect(after).toBe(before);
  });

  it('refuses promoting an already-promoted item', () => {
    addBacklogItem(root, { title: 'X', reason: 'Y' });
    promoteBacklogItem(root, 'B001', { taskId: 'T001' });
    expect(() => promoteBacklogItem(root, 'B001', { taskId: 'T001' })).toThrowError(/promoted/);
  });

  it('refuses promoting an unknown backlog item', () => {
    expect(() => promoteBacklogItem(root, 'B404', { taskId: 'T001' })).toThrowError(/B404/);
  });
});

describe('backlog archive', () => {
  it('flips status to archived and records archived_reason/resolved_at', () => {
    addBacklogItem(root, { title: 'X', reason: 'Y' });
    archiveBacklogItem(root, 'B001', 'No longer relevant.');
    const item = showBacklogItem(root, 'B001');
    expect(item.status).toBe('archived');
    expect(item.archived_reason).toBe('No longer relevant.');
    expect(item.resolved_at).not.toBeNull();
  });

  it('refuses a blank reason', () => {
    addBacklogItem(root, { title: 'X', reason: 'Y' });
    expect(() => archiveBacklogItem(root, 'B001', '  ')).toThrowError(/--reason/);
  });

  it('refuses archiving an already-archived item', () => {
    addBacklogItem(root, { title: 'X', reason: 'Y' });
    archiveBacklogItem(root, 'B001', 'reason');
    expect(() => archiveBacklogItem(root, 'B001', 'again')).toThrowError(/archived/);
  });

  it('refuses archiving an already-promoted item', () => {
    addBacklogItem(root, { title: 'X', reason: 'Y' });
    promoteBacklogItem(root, 'B001', { taskId: 'T001' });
    expect(() => archiveBacklogItem(root, 'B001', 'reason')).toThrowError(/promoted/);
  });
});

describe('backlog list/show (read-only)', () => {
  it('list returns all items with no filter', () => {
    addBacklogItem(root, { title: 'One', reason: 'R' });
    addBacklogItem(root, { title: 'Two', reason: 'R' });
    expect(listBacklogItems(root).map((i) => i.id)).toEqual(['B001', 'B002']);
  });

  it('list filters by status', () => {
    addBacklogItem(root, { title: 'One', reason: 'R' });
    addBacklogItem(root, { title: 'Two', reason: 'R' });
    archiveBacklogItem(root, 'B002', 'reason');
    expect(listBacklogItems(root, 'pending').map((i) => i.id)).toEqual(['B001']);
    expect(listBacklogItems(root, 'archived').map((i) => i.id)).toEqual(['B002']);
  });

  it('show refuses an unknown id', () => {
    expect(() => showBacklogItem(root, 'B404')).toThrowError(BacklogError);
    expect(() => showBacklogItem(root, 'B404')).toThrowError(/B404/);
  });

  it('list/show never write to backlog.yaml or the journal', () => {
    addBacklogItem(root, { title: 'X', reason: 'Y' });
    const beforeJournal = readJournal(root).length;
    listBacklogItems(root);
    showBacklogItem(root, 'B001');
    expect(readJournal(root)).toHaveLength(beforeJournal);
  });
});

describe('backlog dirty-tree/scope integration during an active task (AC005)', () => {
  it('backlog add mid-task does not break that task\'s own clean-tree check on task-update', async () => {
    expect((await run(['task-update', 'T001', 'in_progress'], root)).error).toBeUndefined();
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1;\n');

    addBacklogItem(root, { title: 'Discovered mid-task', reason: 'Out of scope for T001.' });
    expect(git(['status', '--porcelain'], root)).toMatch(/backlog\.yaml/);

    expect((await run(['task-update', 'T001', 'review'], root)).error).toBeUndefined();
    const result = join(scratch, 'result.yaml');
    const message = join(scratch, 'message.txt');
    writeFileSync(result, 'summary: Done.\nevidence: node reported 1 passed\n');
    writeFileSync(message, 'task: complete T001\n');
    const completed = await run(
      ['task-update', 'T001', 'completed', '--result', result, '--message', message],
      root,
    );
    expect(completed.error).toBeUndefined();
  });
});

describe('backlog reconciliation via the existing pending/fold machinery (AC003/AC005)', () => {
  it('reconcilePending checkpoints a pending backlog_recording entry once the next task commit captures backlog.yaml, with no dedicated backlog commit ever created', async () => {
    const before = commitCount(root);
    addBacklogItem(root, { title: 'X', reason: 'Y' });
    expect(commitCount(root)).toBe(before); // no dedicated commit at add time

    await completeTaskT001();

    expect(pendingBacklogEntries()).toHaveLength(0);
    expect(commitCount(root)).toBe(before + 1); // exactly one commit: T001's own completion
  });
});
