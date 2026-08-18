import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCli } from '../../src/cli/index.js';
import { registerInitCommand } from '../../src/cli/commands/init.js';
import { registerMilestoneAddCommand } from '../../src/cli/commands/milestone-add.js';
import { registerMilestoneConfirmCommand } from '../../src/cli/commands/milestone-confirm.js';
import { registerTaskAmendCommand } from '../../src/cli/commands/task-amend.js';
import { registerTaskUpdateCommand } from '../../src/cli/commands/task-update.js';
import { derivePending } from '../../src/core/journal/operations.js';
import { readJournal, type JournalEntry } from '../../src/state/journal.js';
import { loadTasks } from '../../src/state/store.js';
import type { Task } from '../../src/state/schemas.js';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

const commitCount = (cwd: string): number => Number(git(['rev-list', '--count', 'HEAD'], cwd).trim());
const headFiles = (cwd: string): string[] =>
  git(['show', '--name-only', '--format='], cwd)
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .sort();

let root: string;
let scratch: string;

const CONTRACT_FIXTURE = `---
schema_version: 1
id: M999
title: Amendable milestone
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

- Initial milestone contract.
`;

const TASKS_FIXTURE = `schema_version: 1
tasks:
  - id: T001
    objective: First task.
    status: planned
    depends_on: []
    acceptance_criteria:
      - It works
    relevant_files:
      - src/a.ts
    verification:
      strategy: tdd
      detail: npm test
    result: null
    usage: null
  - id: T002
    objective: Second task.
    status: planned
    depends_on: [T001]
    acceptance_criteria:
      - It also works
    relevant_files:
      - src/b.ts
    verification:
      strategy: tdd
      detail: npm test
    result: null
    usage: null
  - id: T003
    objective: Third task, using context/write scope.
    status: planned
    depends_on: []
    acceptance_criteria:
      - It works too
    context_files:
      - src/c.ts
    write_scope:
      - src/c.ts
    verification:
      strategy: tdd
      detail: npm test
    result: null
    usage: null
`;

const TASKS_PATH = '.pitway/milestones/M001/tasks.yaml';

const MESSAGE_FIXTURE = `task: complete T001

Implemented the first thing.
`;

const RESULT_FIXTURE = `summary: Implemented the thing.
evidence: npm test passed
`;

async function run(args: string[], cwd: string): Promise<{ lines: string[]; error?: Error }> {
  const program = buildCli();
  const lines: string[] = [];
  registerInitCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerMilestoneAddCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerMilestoneConfirmCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerTaskAmendCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerTaskUpdateCommand(program, { root: cwd, write: (s) => lines.push(s) });
  try {
    await program.parseAsync(['node', 'pitway', ...args]);
    return { lines };
  } catch (error) {
    return { lines, error: error as Error };
  }
}

function amendFile(fields: Record<string, unknown>): string {
  const path = join(scratch, `amend-${Date.now()}-${Math.random().toString(36).slice(2)}.yaml`);
  const lines = Object.entries(fields).map(([key, value]) => {
    if (Array.isArray(value)) {
      return `${key}:\n${value.map((v) => `  - ${JSON.stringify(v)}`).join('\n')}`;
    }
    return `${key}: ${JSON.stringify(value)}`;
  });
  writeFileSync(path, `${lines.join('\n')}\n`);
  return path;
}

async function amend(
  taskId: string,
  fields: Record<string, unknown>,
  changeLog = 'Tightened the objective wording.',
  extra: string[] = [],
): Promise<{ lines: string[]; error?: Error }> {
  const file = amendFile(fields);
  return run(['task-amend', taskId, '--file', file, '--change-log', changeLog, '--json', ...extra], root);
}

const task = (id: string): Task => {
  const found = loadTasks(root, 'M001').tasks.find((t) => t.id === id);
  if (!found) throw new Error(`missing task ${id}`);
  return found;
};

function pendingAmendEntries(taskId?: string): JournalEntry[] {
  return derivePending(readJournal(root)).filter(
    (e) => e.type === 'task_amendment' && (taskId === undefined || e.target === taskId),
  );
}

async function confirmedMilestone(): Promise<void> {
  const contract = join(root, 'draft-contract.md');
  const tasks = join(root, 'draft-tasks.yaml');
  writeFileSync(contract, CONTRACT_FIXTURE);
  writeFileSync(tasks, TASKS_FIXTURE);
  const added = await run(['milestone-add', '--contract', contract, '--tasks', tasks], root);
  expect(added.error).toBeUndefined();
  rmSync(contract);
  rmSync(tasks);
  const confirmed = await run(['milestone-confirm', 'M001'], root);
  expect(confirmed.error).toBeUndefined();
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'pitway-tamend-'));
  scratch = mkdtempSync(join(tmpdir(), 'pitway-tamend-in-'));
  git(['init', '-q'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  writeFileSync(join(root, 'README.md'), 'seed\n');
  git(['add', 'README.md'], root);
  git(['commit', '-q', '-m', 'init'], root);
  await run(['init'], root);
  await confirmedMilestone();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

describe('pitway task-amend validation (AC1)', () => {
  it('refuses an unknown task id, writing nothing', async () => {
    const before = commitCount(root);
    const { error } = await amend('T009', { objective: 'Whatever.' });
    expect(error?.message).toMatch(/T009/);
    expect(commitCount(root)).toBe(before);
    expect(pendingAmendEntries()).toHaveLength(0);
  });

  it('refuses an amendment file containing an immutable field, naming it', async () => {
    const { error } = await amend('T001', { status: 'completed' });
    expect(error?.message).toMatch(/status/);
    expect(task('T001').status).toBe('ready');
    expect(pendingAmendEntries()).toHaveLength(0);
  });

  it('refuses an amendment file containing depends_on, naming it', async () => {
    const { error } = await amend('T001', { depends_on: [] });
    expect(error?.message).toMatch(/depends_on/);
    expect(pendingAmendEntries()).toHaveLength(0);
  });

  it('refuses a merge that violates the context_files/write_scope combination rule', async () => {
    const { error } = await amend('T003', { write_scope: ['src/c.ts', 'src/d.ts'] });
    expect(error?.message).toMatch(/write_scope/);
    expect(error?.message).toMatch(/src\/d\.ts/);
    expect(task('T003').write_scope).toEqual(['src/c.ts']);
    expect(pendingAmendEntries()).toHaveLength(0);
  });

  it('refuses a merge that combines relevant_files with context_files, naming the ambiguity', async () => {
    const { error } = await amend('T001', { context_files: ['src/a.ts'] });
    expect(error?.message).toMatch(/relevant_files/);
    expect(pendingAmendEntries()).toHaveLength(0);
  });

  it('refuses blank --change-log evidence', async () => {
    const file = amendFile({ objective: 'Reworded.' });
    const { error } = await run(
      ['task-amend', 'T001', '--file', file, '--change-log', '   '],
      root,
    );
    expect(error?.message).toMatch(/--change-log/);
    expect(pendingAmendEntries()).toHaveLength(0);
  });

  it('refuses an unreadable amendment file', async () => {
    const missing = join(scratch, 'does-not-exist.yaml');
    const { error } = await run(
      ['task-amend', 'T001', '--file', missing, '--change-log', 'Evidence.'],
      root,
    );
    expect(error?.message).toMatch(/task amendment/);
    expect(pendingAmendEntries()).toHaveLength(0);
  });

  it('refuses missing --file at the CLI level', async () => {
    const { error } = await run(['task-amend', 'T001', '--change-log', 'Evidence.'], root);
    expect(error?.message).toMatch(/--file/);
  });

  it('refuses missing --change-log at the CLI level', async () => {
    const file = amendFile({ objective: 'Reworded.' });
    const { error } = await run(['task-amend', 'T001', '--file', file], root);
    expect(error?.message).toMatch(/--change-log/);
  });

  it("refuses when the milestone's contract has no recorded Change Log entry", async () => {
    const contractPath = join(root, '.pitway', 'milestones', 'M001', 'contract.md');
    writeFileSync(contractPath, readFileSync(contractPath, 'utf8').replace(/## Change Log[\s\S]*$/, '## Change Log\n'));
    const { error } = await amend('T001', { objective: 'Reworded.' });
    expect(error?.message).toMatch(/Change Log/);
    expect(pendingAmendEntries()).toHaveLength(0);
  });
});

describe('pitway task-amend approval + journal + materialize (AC2, AC3, AC4)', () => {
  it('records a task_amendment journal entry and immediately materializes tasks.yaml, with no commit of its own', async () => {
    const before = commitCount(root);
    const { lines, error } = await amend('T001', { objective: 'Reworded objective.' }, 'Reworded per developer feedback.');
    expect(error).toBeUndefined();

    const view = JSON.parse(lines[0]!) as { id: string; milestone: string; operation: string };
    expect(view).toEqual({ id: 'T001', milestone: 'M001', operation: 'amend' });

    // AC4: a read immediately after reflects the amended task, before any
    // checkpoint commit exists.
    expect(task('T001').objective).toBe('Reworded objective.');
    expect(commitCount(root)).toBe(before);
    expect(git(['status', '--porcelain'], root)).toMatch(/tasks\.yaml/);

    const pending = pendingAmendEntries('T001');
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      milestone: 'M001',
      type: 'task_amendment',
      target: 'T001',
      payload: {
        changeLogEvidence: 'Reworded per developer feedback.',
        fields: { objective: 'Reworded objective.' },
      },
    });
    expect(typeof pending[0]!.operationId).toBe('string');
    expect(pending[0]!.operationId.length).toBeGreaterThan(0);
  });

  it('leaves omitted fields unchanged (shallow merge)', async () => {
    const { error } = await amend('T001', { objective: 'Only objective changes.' });
    expect(error).toBeUndefined();
    expect(task('T001').relevant_files).toEqual(['src/a.ts']);
    expect(task('T001').acceptance_criteria).toEqual(['It works']);
  });
});

describe('pitway task-amend idempotency and ambiguity (AC5)', () => {
  it('re-running the same pending amendment is a harmless re-materialize: no second journal entry', async () => {
    const file = amendFile({ objective: 'Reworded objective.' });
    const first = await run(
      ['task-amend', 'T001', '--file', file, '--change-log', 'Evidence.', '--json'],
      root,
    );
    expect(first.error).toBeUndefined();
    const second = await run(
      ['task-amend', 'T001', '--file', file, '--change-log', 'Evidence.', '--json'],
      root,
    );
    expect(second.error).toBeUndefined();
    expect(pendingAmendEntries('T001')).toHaveLength(1);
    expect(task('T001').objective).toBe('Reworded objective.');
  });

  it('refuses a second, differently-fielded amendment while the first is still pending', async () => {
    const first = await amend('T001', { objective: 'First rewording.' });
    expect(first.error).toBeUndefined();

    const { error } = await amend('T001', { objective: 'Second, conflicting rewording.' });
    expect(error?.message).toMatch(/ambiguous/i);
    expect(pendingAmendEntries('T001')).toHaveLength(1);
    expect(task('T001').objective).toBe('First rewording.');
  });

  it('is a no-op once the amendment is already fully materialized and no longer pending', async () => {
    const fields = { objective: 'Reworded objective.' };
    const file = amendFile(fields);
    const applied = await run(
      ['task-amend', 'T001', '--file', file, '--change-log', 'Evidence.'],
      root,
    );
    expect(applied.error).toBeUndefined();

    // Simulate the checkpoint commit + reconciliation a real completion would
    // perform (mirrors milestone-confirm.test.ts's checkpointPendingContract).
    git(['add', TASKS_PATH], root);
    git(['commit', '-m', 'workflow: simulate checkpoint\n\nPitWay-Milestone: M001'], root);
    const { reconcilePending } = await import('../../src/state/journal.js');
    reconcilePending(root, 'M001');
    expect(pendingAmendEntries('T001')).toHaveLength(0);

    const before = commitCount(root);
    const again = await run(
      ['task-amend', 'T001', '--file', file, '--change-log', 'Evidence.'],
      root,
    );
    expect(again.error).toBeUndefined();
    expect(pendingAmendEntries('T001')).toHaveLength(0);
    expect(commitCount(root)).toBe(before);
    expect(task('T001').objective).toBe('Reworded objective.');
  });

  it('folds into the next checkpoint commit and reconciles the journal marker (matching T004 mechanics)', async () => {
    const { error: amendError } = await amend('T001', { objective: 'Reworded before completion.' });
    expect(amendError).toBeUndefined();
    expect(pendingAmendEntries('T001')).toHaveLength(1);

    expect((await run(['task-update', 'T001', 'in_progress'], root)).error).toBeUndefined();
    expect((await run(['task-update', 'T001', 'review'], root)).error).toBeUndefined();

    const result = join(scratch, 'result.yaml');
    const message = join(scratch, 'message.txt');
    writeFileSync(result, RESULT_FIXTURE);
    writeFileSync(message, MESSAGE_FIXTURE);
    const { error } = await run(
      ['task-update', 'T001', 'completed', '--result', result, '--message', message],
      root,
    );
    expect(error).toBeUndefined();

    expect(task('T001').objective).toBe('Reworded before completion.');
    expect(task('T001').status).toBe('completed');
    expect(headFiles(root)).toContain(TASKS_PATH);
    expect(git(['status', '--porcelain'], root).trim()).toBe('');
    expect(pendingAmendEntries('T001')).toHaveLength(0);
  });
});
