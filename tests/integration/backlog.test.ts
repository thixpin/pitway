import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCli, registerAllCommands } from '../../src/cli/index.js';
import { registerBacklogCommand } from '../../src/cli/commands/backlog.js';
import { addBacklogItem, BacklogError, resolveActiveMilestoneStrict } from '../../src/core/backlog/add.js';
import { promoteBacklogItem } from '../../src/core/backlog/promote.js';
import { archiveBacklogItem } from '../../src/core/backlog/archive.js';
import { listBacklogItems } from '../../src/core/backlog/list.js';
import { showBacklogItem } from '../../src/core/backlog/show.js';
import { derivePending } from '../../src/state/journal-operations.js';
import { appendBacklogArchiveRecord, readJournal, type JournalEntry } from '../../src/state/journal.js';
import { loadBacklog } from '../../src/state/store.js';
import { createTaskWorktree } from '../../src/git/worktree.js';
import { WorktreeGuardError } from '../../src/cli/worktree-guard.js';

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

  // T002: decouples backlog add from requiring an active milestone.
  it('succeeds with no active milestone, recording source.milestone: null via a milestone-less journal record (no commit)', async () => {
    await completeTaskT001();
    expect((await run(['verify'], root)).error).toBeUndefined();
    expect((await run(['milestone-complete', 'M001'], root)).error).toBeUndefined();

    const before = commitCount(root);
    const view = addBacklogItem(root, { title: 'Found after completion', reason: 'No milestone active.' });
    expect(view).toEqual({ id: 'B001', status: 'pending' });
    expect(commitCount(root)).toBe(before);

    const item = showBacklogItem(root, 'B001');
    expect(item.source).toEqual({ milestone: null, task: null });

    // A real journal record, not silently untracked -- the dedicated
    // backlog_add_unscoped kind, never a backlog_recording entry (there is
    // no active milestone for an entry-kind record to attach to).
    const unscoped = readJournal(root).filter((r) => r.kind === 'backlog_add_unscoped');
    expect(unscoped).toHaveLength(1);
    expect(unscoped[0]).toMatchObject({ target: 'B001', title: 'Found after completion' });
    expect(pendingBacklogEntries()).toHaveLength(0);
  });
});

describe('backlog: unconditional active-milestone journal attachment (AC004)', () => {
  it('promote still fails with no active milestone; add and archive are unaffected/succeed (M021/T002, B007; T002 decoupled add)', async () => {
    addBacklogItem(root, { title: 'X', reason: 'Y' });

    await completeTaskT001();
    expect((await run(['verify'], root)).error).toBeUndefined();
    expect((await run(['milestone-complete', 'M001'], root)).error).toBeUndefined();

    const expectedMessage = /no active milestone; run milestone-add or resume the active one first/;
    // backlog promote's active-milestone requirement is unaffected by T002
    // (it targets a task, which is inherently milestone-scoped).
    expect(() => promoteBacklogItem(root, 'B001', { taskId: 'T001' })).toThrowError(expectedMessage);

    // T002: backlog add no longer requires an active milestone -- succeeds,
    // recording source.milestone: null.
    expect(() => addBacklogItem(root, { title: 'X', reason: 'Y' })).not.toThrow();
    expect(showBacklogItem(root, 'B002').source).toEqual({ milestone: null, task: null });

    // B007's own finding, reproduced directly: archive must succeed with no
    // active milestone -- it finalizes an already fully identified item
    // rather than creating new pending state, so add/promote's safety
    // reasoning never applied to it.
    expect(() => archiveBacklogItem(root, 'B001', 'reason')).not.toThrow();
    expect(showBacklogItem(root, 'B001').status).toBe('archived');
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

  it('promotes only the named item, leaving sibling items untouched', () => {
    addBacklogItem(root, { title: 'One', reason: 'R' });
    addBacklogItem(root, { title: 'Two', reason: 'R' });
    promoteBacklogItem(root, 'B001', { taskId: 'T001' });
    expect(showBacklogItem(root, 'B001').status).toBe('promoted');
    expect(showBacklogItem(root, 'B002').status).toBe('pending');
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

  it('refuses archiving an unknown backlog item', () => {
    expect(() => archiveBacklogItem(root, 'B404', 'reason')).toThrowError(/B404 not found/);
  });

  it('archives only the named item, leaving sibling items untouched', () => {
    addBacklogItem(root, { title: 'One', reason: 'R' });
    addBacklogItem(root, { title: 'Two', reason: 'R' });
    archiveBacklogItem(root, 'B001', 'done');
    expect(showBacklogItem(root, 'B001').status).toBe('archived');
    expect(showBacklogItem(root, 'B002').status).toBe('pending');
  });

  it('does not double-journal on retry after a crash between the journal write and the state write (B035)', () => {
    addBacklogItem(root, { title: 'X', reason: 'Y' });
    // Simulate a prior interrupted archive attempt: the journal write
    // landed but the state write (saveBacklog) did not, so the item is
    // still 'pending' in backlog.yaml -- exactly the window a retry (e.g.
    // a quick-change commit's status-check-then-archive guard, M037/T001)
    // would re-enter through.
    appendBacklogArchiveRecord(root, {
      id: 'ba-simulated-crash',
      target: 'B001',
      reason: 'closed by quick-change qc-test',
      at: new Date(0).toISOString(),
    });
    archiveBacklogItem(root, 'B001', 'closed by quick-change qc-test');
    expect(showBacklogItem(root, 'B001').status).toBe('archived');
    const records = readJournal(root).filter(
      (entry) => entry.kind === 'backlog_archive' && entry.target === 'B001',
    );
    expect(records).toHaveLength(1);
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

// M024/T002 (AC003): the CLI wiring's human-render paths (no --json) and
// CommandDeps default fallbacks (no deps object: root falls back to
// process.cwd(), write falls back to console.log) -- exercised through the
// real commander program, mirroring task-verify.test.ts's chdir+spy harness.
describe('backlog CLI human output (no --json)', () => {
  it('add renders the recorded id and status as a human line', async () => {
    const { lines, error } = await run(['backlog', 'add', '--title', 'X', '--reason', 'Y'], root);
    expect(error).toBeUndefined();
    expect(lines[0]).toBe('🔧 B001 recorded as pending.');
    // T001 wired racing footer on backlog add/promote/archive
    expect(lines[1]).toMatch(/🏎️|🏁/);
  });

  it('list renders a table with id, status, source, title columns', async () => {
    addBacklogItem(root, { title: 'First thing', reason: 'Deferred A' });
    addBacklogItem(root, { title: 'Second thing', reason: 'Deferred B' });
    const { lines, error } = await run(['backlog', 'list'], root);
    expect(error).toBeUndefined();
    const outLines = lines.join('\n').split('\n');
    expect(outLines[0]).toBe('| ID | Status | Source | Title |');
    expect(outLines[1]).toMatch(/^\|[-|]+\|$/);
    expect(outLines.slice(2).join('\n')).toContain('B001');
    expect(outLines.slice(2).join('\n')).toContain('First thing');
    expect(outLines.slice(2).join('\n')).toContain('B002');
    expect(outLines.slice(2).join('\n')).toContain('Second thing');
  });

  it('list renders the empty-state line when nothing is recorded', async () => {
    const { lines, error } = await run(['backlog', 'list'], root);
    expect(error).toBeUndefined();
    expect(lines).toEqual(['No backlog items recorded.']);
  });

  it('list --status filters through the CLI, and refuses an unknown status by name', async () => {
    addBacklogItem(root, { title: 'Keep', reason: 'R' });
    addBacklogItem(root, { title: 'Gone', reason: 'R' });
    archiveBacklogItem(root, 'B002', 'done elsewhere');

    const filtered = await run(['backlog', 'list', '--status', 'archived'], root);
    expect(filtered.error).toBeUndefined();
    // T008: active filters echoed in header; T009: table renderer
    const filteredLines = filtered.lines.join('\n').split('\n');
    expect(filteredLines[0]).toBe('Backlog (filtered: status=archived)');
    expect(filteredLines[1]).toBe('| ID | Status | Source | Title |');
    expect(filteredLines.slice(2).join('\n')).toContain('B002');
    expect(filteredLines.slice(2).join('\n')).toContain('archived');
    expect(filteredLines.slice(2).join('\n')).toContain('Gone');

    const bad = await run(['backlog', 'list', '--status', 'bogus'], root);
    expect(bad.error?.message).toMatch(/must be pending, promoted, or archived; got bogus/);
  });

  it('show renders the item with header, source, status and wrapped reason', async () => {
    addBacklogItem(root, { title: 'Thing', reason: 'Why' });
    const { lines, error } = await run(['backlog', 'show', 'B001'], root);
    expect(error).toBeUndefined();
    const text = lines.join('\n');
    expect(text).toContain('B001 [pending] Thing');
    expect(text).toContain('Source: M001');
    expect(text).toContain('Status: pending');
    expect(text).toContain('Why');
  });

  it('promote renders the target milestone/task line', async () => {
    addBacklogItem(root, { title: 'Thing', reason: 'Why' });
    const { lines, error } = await run(['backlog', 'promote', 'B001', '--task', 'T001'], root);
    expect(error).toBeUndefined();
    expect(lines[0]).toBe('🔧 B001 promoted to M001/T001.');
    expect(lines[1]).toMatch(/🏎️|🏁/);
  });

  it('archive renders the archived line', async () => {
    addBacklogItem(root, { title: 'Thing', reason: 'Why' });
    const { lines, error } = await run(['backlog', 'archive', 'B001', '--reason', 'obsolete'], root);
    expect(error).toBeUndefined();
    expect(lines[0]).toBe('🔧 B001 archived.');
    expect(lines[1]).toMatch(/🏎️|🏁/);
  });

  it('add/show honor --json through the CLI wiring too', async () => {
    const added = await run(['backlog', 'add', '--title', 'X', '--reason', 'Y', '--json'], root);
    expect(added.error).toBeUndefined();
    expect(JSON.parse(added.lines[0]!)).toEqual({ id: 'B001', status: 'pending' });

    const shown = await run(['backlog', 'show', 'B001', '--json'], root);
    expect(shown.error).toBeUndefined();
    expect(JSON.parse(shown.lines[0]!)).toMatchObject({ id: 'B001', title: 'X', reason: 'Y' });
  });
});

describe('backlog CLI default deps (no deps object: process.cwd() root, console.log write)', () => {
  async function runDefault(args: string[]): Promise<{ calls: unknown[][]; caught?: unknown }> {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cwdBefore = process.cwd();
    process.chdir(root);
    let caught: unknown;
    let calls: unknown[][] = [];
    try {
      const program = buildCli();
      registerBacklogCommand(program);
      await program.parseAsync(['node', 'pitway', 'backlog', ...args]);
    } catch (error) {
      caught = error;
    } finally {
      calls = logSpy.mock.calls;
      process.chdir(cwdBefore);
      logSpy.mockRestore();
    }
    return { calls, caught };
  }

  it('every subcommand resolves root from process.cwd() and writes via console.log', async () => {
    const added = await runDefault(['add', '--title', 'X', '--reason', 'Y', '--json']);
    expect(added.caught).toBeUndefined();
    expect(added.calls).toHaveLength(1);
    expect(JSON.parse(added.calls[0]?.[0] as string)).toEqual({ id: 'B001', status: 'pending' });

    const listed = await runDefault(['list', '--json']);
    expect(listed.caught).toBeUndefined();
    expect((JSON.parse(listed.calls[0]?.[0] as string) as unknown[])).toHaveLength(1);

    const shown = await runDefault(['show', 'B001', '--json']);
    expect(shown.caught).toBeUndefined();
    expect(JSON.parse(shown.calls[0]?.[0] as string)).toMatchObject({ id: 'B001' });

    const promoted = await runDefault(['promote', 'B001', '--task', 'T001', '--json']);
    expect(promoted.caught).toBeUndefined();
    expect(JSON.parse(promoted.calls[0]?.[0] as string)).toMatchObject({ status: 'promoted' });

    const addedAgain = await runDefault(['add', '--title', 'Z', '--reason', 'W', '--json']);
    expect(addedAgain.caught).toBeUndefined();

    const archived = await runDefault(['archive', 'B002', '--reason', 'done', '--json']);
    expect(archived.caught).toBeUndefined();
    expect(JSON.parse(archived.calls[0]?.[0] as string)).toEqual({ id: 'B002', status: 'archived' });
  });
});

// M018/T003 (AC006): backlog add/promote/archive are state-mutating and
// refused by worktree-guard.ts's existing default-deny mechanism -- no
// code change there was needed, proven directly (mirrors
// tests/integration/worktree-state-guard.test.ts's own coverage style).
describe('backlog CLI worktree guard (AC006)', () => {
  it('refuses backlog add/promote/archive inside a task worktree', async () => {
    const worktree = createTaskWorktree(root, 'M001', 'T001').path;

    const add = await run(['backlog', 'add', '--title', 'X', '--reason', 'Y'], worktree);
    expect(add.error).toBeInstanceOf(WorktreeGuardError);

    const promote = await run(['backlog', 'promote', 'B001', '--task', 'T001'], worktree);
    expect(promote.error).toBeInstanceOf(WorktreeGuardError);

    const archive = await run(['backlog', 'archive', 'B001', '--reason', 'Z'], worktree);
    expect(archive.error).toBeInstanceOf(WorktreeGuardError);
  });

  // Deliberately NOT added to READ_ONLY_COMMANDS, matching quick-change
  // status's own precedent (AC006/Design Decisions) -- backlog inspection
  // stays driver-owned, not a worker capability, so list/show are refused
  // in a worktree too, unlike resume/task-status/milestone-status.
  it('also refuses backlog list/show inside a task worktree (not allowlisted, unlike resume/task-status)', async () => {
    addBacklogItem(root, { title: 'X', reason: 'Y' });
    const worktree = createTaskWorktree(root, 'M001', 'T001').path;

    const list = await run(['backlog', 'list'], worktree);
    expect(list.error).toBeInstanceOf(WorktreeGuardError);

    const show = await run(['backlog', 'show', 'B001'], worktree);
    expect(show.error).toBeInstanceOf(WorktreeGuardError);
  });
});

// M025/T008 (AC010): --milestone and --task filters over source, combinable
// with --status and --json; malformed refuses by name, well-formed but
// nonexistent yields clean empty with active filters echoed; command stays read-only.
describe('backlog list filters: --milestone and --task (M025/T008)', () => {
  it('filters by --milestone alone (human header echoed)', async () => {
    writeRetiredMilestone('M002');
    addBacklogItem(root, { title: 'In M001', reason: 'R' }); // B001 -> M001
    addBacklogItem(root, { title: 'In M002', reason: 'R', sourceMilestone: 'M002' }); // B002 -> M002

    const out = await run(['backlog', 'list', '--milestone', 'M002'], root);
    expect(out.error).toBeUndefined();
    const outLines = out.lines.join('\n').split('\n');
    expect(outLines[0]).toBe('Backlog (filtered: milestone=M002)');
    expect(outLines[1]).toBe('| ID | Status | Source | Title |');
    expect(outLines.slice(2).join('\n')).toContain('B002');
    expect(outLines.slice(2).join('\n')).toContain('In M002');

    // core-level combinable check
    expect(listBacklogItems(root, { milestone: 'M001' }).map((i) => i.id)).toEqual(['B001']);
  });

  it('filters by --task alone (human header echoed)', async () => {
    addBacklogItem(root, { title: 'No task', reason: 'R' }); // B001 -> M001, task null
    addBacklogItem(root, { title: 'With task', reason: 'R', sourceTask: 'T001' }); // B002 -> M001/T001

    const out = await run(['backlog', 'list', '--task', 'T001'], root);
    expect(out.error).toBeUndefined();
    const outLines = out.lines.join('\n').split('\n');
    expect(outLines[0]).toBe('Backlog (filtered: task=T001)');
    expect(outLines[1]).toBe('| ID | Status | Source | Title |');
    expect(outLines.slice(2).join('\n')).toContain('B002');
    expect(outLines.slice(2).join('\n')).toContain('With task');

    expect(listBacklogItems(root, { task: 'T001' }).map((i) => i.id)).toEqual(['B002']);
  });

  it('filters combine: --status + --milestone and --milestone + --task, including no-match empty with header', async () => {
    writeRetiredMilestone('M002');
    addBacklogItem(root, { title: 'Keep pending M001', reason: 'R' }); // B001 pending M001
    addBacklogItem(root, { title: 'Archived M001', reason: 'R' }); // B002 pending M001 -> archived
    archiveBacklogItem(root, 'B002', 'done');
    addBacklogItem(root, { title: 'Pending M002', reason: 'R', sourceMilestone: 'M002' }); // B003 pending M002

    // --status + --milestone: only pending in M001
    const combined = await run(['backlog', 'list', '--status', 'pending', '--milestone', 'M001'], root);
    expect(combined.error).toBeUndefined();
    const combinedLines = combined.lines.join('\n').split('\n');
    expect(combinedLines[0]).toBe('Backlog (filtered: status=pending, milestone=M001)');
    expect(combinedLines[1]).toBe('| ID | Status | Source | Title |');
    expect(combinedLines.slice(2).join('\n')).toContain('B001');
    expect(combinedLines.slice(2).join('\n')).toContain('Keep pending M001');

    // no-match empty: well-formed but nonexistent milestone yields header + empty line
    const empty = await run(['backlog', 'list', '--milestone', 'M999'], root);
    expect(empty.error).toBeUndefined();
    expect(empty.lines.join('\n').split('\n')).toEqual([
      'Backlog (filtered: milestone=M999)',
      'No backlog items recorded.',
    ]);

    // --milestone + --task
    addBacklogItem(root, { title: 'M001 T001', reason: 'R', sourceTask: 'T001' }); // B004 M001/T001
    const both = await run(['backlog', 'list', '--milestone', 'M001', '--task', 'T001'], root);
    expect(both.error).toBeUndefined();
    const bothLines = both.lines.join('\n').split('\n');
    expect(bothLines[0]).toBe('Backlog (filtered: milestone=M001, task=T001)');
    expect(bothLines[1]).toBe('| ID | Status | Source | Title |');
    expect(bothLines.slice(2).join('\n')).toContain('B004');
    expect(bothLines.slice(2).join('\n')).toContain('M001 T001');

    // all three combined, no match -> header lists all three + empty
    const tripleEmpty = await run(
      ['backlog', 'list', '--status', 'archived', '--milestone', 'M002', '--task', 'T001'],
      root,
    );
    expect(tripleEmpty.error).toBeUndefined();
    const tripleLines = tripleEmpty.lines.join('\n').split('\n');
    expect(tripleLines[0]).toBe('Backlog (filtered: status=archived, milestone=M002, task=T001)');
    expect(tripleLines[1]).toBe('No backlog items recorded.');

    // core-level triple filter
    expect(listBacklogItems(root, { status: 'pending', milestone: 'M001', task: 'T001' }).map((i) => i.id)).toEqual([
      'B004',
    ]);
  });

  it('malformed --milestone and --task refuse by name naming valid shape M000/T000, --status bogus still refuses', async () => {
    addBacklogItem(root, { title: 'X', reason: 'Y' });

    const badMilestone = await run(['backlog', 'list', '--milestone', 'bogus'], root);
    expect(badMilestone.error?.message).toMatch(/--milestone.*M000.*bogus/);

    const badTask = await run(['backlog', 'list', '--task', 'bogus'], root);
    expect(badTask.error?.message).toMatch(/--task.*T000.*bogus/);

    const badStatus = await run(['backlog', 'list', '--status', 'bogus'], root);
    expect(badStatus.error?.message).toMatch(/must be pending, promoted, or archived; got bogus/);
  });

  it('well-formed but nonexistent --milestone M999 is a valid empty query (not a refusal) and --task T999 likewise', async () => {
    addBacklogItem(root, { title: 'X', reason: 'Y' });
    const emptyM = await run(['backlog', 'list', '--milestone', 'M999', '--json'], root);
    expect(emptyM.error).toBeUndefined();
    expect(JSON.parse(emptyM.lines[0]!)).toEqual([]);

    const emptyT = await run(['backlog', 'list', '--task', 'T999', '--json'], root);
    expect(emptyT.error).toBeUndefined();
    expect(JSON.parse(emptyT.lines[0]!)).toEqual([]);
  });

  it('JSON output shape unchanged but filtered (array of items)', async () => {
    writeRetiredMilestone('M002');
    addBacklogItem(root, { title: 'A', reason: 'R' }); // M001
    addBacklogItem(root, { title: 'B', reason: 'R', sourceMilestone: 'M002' }); // M002

    const filtered = await run(['backlog', 'list', '--milestone', 'M002', '--json'], root);
    expect(filtered.error).toBeUndefined();
    const parsed = JSON.parse(filtered.lines[0]!) as unknown[];
    expect(parsed).toHaveLength(1);
    expect((parsed[0] as { id: string }).id).toBe('B002');

    const statusFiltered = await run(['backlog', 'list', '--status', 'pending', '--json'], root);
    expect(statusFiltered.error).toBeUndefined();
    expect((JSON.parse(statusFiltered.lines[0]!) as unknown[])).toHaveLength(2);
  });

  it('backlog list with filters remains read-only (no journal/backlog writes)', async () => {
    addBacklogItem(root, { title: 'X', reason: 'Y' });
    const beforeJournal = readJournal(root).length;
    const beforeBacklog = loadBacklog(root).items.length;

    await run(['backlog', 'list', '--milestone', 'M001'], root);
    await run(['backlog', 'list', '--task', 'T001', '--json'], root);
    await run(['backlog', 'list', '--status', 'pending', '--milestone', 'M001', '--json'], root);
    // core-level too
    listBacklogItems(root, { milestone: 'M001' });
    listBacklogItems(root, { task: 'T001' });

    expect(readJournal(root)).toHaveLength(beforeJournal);
    expect(loadBacklog(root).items).toHaveLength(beforeBacklog);
    expect(git(['status', '--porcelain'], root)).not.toMatch(/journal/);
  });

  it('empty backlog with active filter still echoes header', async () => {
    const out = await run(['backlog', 'list', '--milestone', 'M001'], root);
    expect(out.error).toBeUndefined();
    expect(out.lines.join('\n').split('\n')).toEqual([
      'Backlog (filtered: milestone=M001)',
      'No backlog items recorded.',
    ]);
  });
});
