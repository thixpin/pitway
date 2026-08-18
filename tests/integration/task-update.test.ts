import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { parse } from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCli } from '../../src/cli/index.js';
import { registerInitCommand } from '../../src/cli/commands/init.js';
import { registerMilestoneAddCommand } from '../../src/cli/commands/milestone-add.js';
import { registerMilestoneConfirmCommand } from '../../src/cli/commands/milestone-confirm.js';
import { registerTaskUpdateCommand } from '../../src/cli/commands/task-update.js';
import { loadTasks, saveTasks } from '../../src/state/store.js';
import type { Task } from '../../src/state/schemas.js';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

const commitCount = (cwd: string): number => Number(git(['rev-list', '--count', 'HEAD'], cwd).trim());
const headMessage = (cwd: string): string => git(['log', '-1', '--format=%B'], cwd);
const headFiles = (cwd: string): string[] =>
  git(['show', '--name-only', '--format='], cwd)
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .sort();
const stagedFiles = (cwd: string): string => git(['diff', '--cached', '--name-only'], cwd).trim();

let root: string;
// Flag input files (--result/--message) live outside the repo so they never
// show up as unexpected dirty paths during completion.
let scratch: string;

const CONTRACT_FIXTURE = `---
schema_version: 1
id: M999
title: Executable milestone
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
`;

const TASKS_PATH = '.pitway/milestones/M001/tasks.yaml';

const MESSAGE_FIXTURE = `task: complete T001

Implemented the first thing.

Claude-Session: https://example.com/session/abc
Co-Authored-By: Claude <noreply@anthropic.com>
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
  registerTaskUpdateCommand(program, { root: cwd, write: (s) => lines.push(s) });
  try {
    await program.parseAsync(['node', 'pitway', ...args]);
    return { lines };
  } catch (error) {
    return { lines, error: error as Error };
  }
}

async function update(args: string[]): Promise<{ lines: string[]; error?: Error }> {
  return run(['task-update', ...args], root);
}

const task = (id: string): Task => {
  const found = loadTasks(root, 'M001').tasks.find((t) => t.id === id);
  if (!found) throw new Error(`missing task ${id}`);
  return found;
};

function editTask(id: string, transform: (t: Task) => Task): void {
  const file = loadTasks(root, 'M001');
  saveTasks(root, 'M001', {
    schema_version: file.schema_version,
    tasks: file.tasks.map((t) => (t.id === id ? transform(t) : t)),
  });
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

async function inReview(): Promise<void> {
  expect((await update(['T001', 'in_progress'])).error).toBeUndefined();
  expect((await update(['T001', 'review'])).error).toBeUndefined();
}

function completionFlags(): string[] {
  const result = join(scratch, 'result.yaml');
  const message = join(scratch, 'message.txt');
  writeFileSync(result, RESULT_FIXTURE);
  writeFileSync(message, MESSAGE_FIXTURE);
  return ['--result', result, '--message', message];
}

function touchRelevantFile(): void {
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1;\n');
}

function installFailingHook(): string {
  const hook = join(root, '.git', 'hooks', 'pre-commit');
  writeFileSync(hook, '#!/bin/sh\nexit 1\n');
  chmodSync(hook, 0o755);
  return hook;
}

// Completes T001 (review -> completed) with a dirty relevant file.
async function completeT001(extra: string[] = []): Promise<{ lines: string[]; error?: Error }> {
  touchRelevantFile();
  return update(['T001', 'completed', ...completionFlags(), ...extra, '--json']);
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'pitway-tupd-'));
  scratch = mkdtempSync(join(tmpdir(), 'pitway-tupd-in-'));
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

describe('pitway task-update transitions (AC013)', () => {
  it('refuses an illegal transition naming the allowed targets, writing nothing', async () => {
    const before = commitCount(root);
    const { error } = await update(['T001', 'completed']);
    expect(error?.message).toMatch(/cannot transition task from "ready" to "completed"/);
    expect(error?.message).toMatch(/in_progress, cancelled/);
    expect(task('T001').status).toBe('ready');
    expect(commitCount(root)).toBe(before);
  });

  it('refuses an unknown status value', async () => {
    const { error } = await update(['T001', 'done']);
    expect(error?.message).toMatch(/done/);
    expect(task('T001').status).toBe('ready');
  });

  it('refuses an unknown task id', async () => {
    const { error } = await update(['T009', 'in_progress']);
    expect(error?.message).toMatch(/T009/);
  });
});

describe('pitway task-update to in_progress (AC014)', () => {
  it('increments attempts at the execution-start boundary', async () => {
    const { lines, error } = await update(['T001', 'in_progress', '--json']);
    expect(error).toBeUndefined();
    expect(JSON.parse(lines[0]!)).toMatchObject({ id: 'T001', status: 'in_progress', attempts: 1 });
    expect(task('T001').attempts).toBe(1);
    expect(commitCount(root)).toBe(2);
  });

  it('increments deterministically across the retry cycle', async () => {
    await update(['T001', 'in_progress']);
    await update(['T001', 'failed']);
    await update(['T001', 'ready']);
    const { error } = await update(['T001', 'in_progress']);
    expect(error).toBeUndefined();
    expect(task('T001').attempts).toBe(2);
  });

  it('allows a dirty tasks.yaml but refuses any other dirty path, writing nothing', async () => {
    appendFileSync(join(root, TASKS_PATH), '# annotation\n');
    writeFileSync(join(root, 'wip.txt'), 'wip\n');
    const { error } = await update(['T001', 'in_progress']);
    expect(error?.message).toMatch(/wip\.txt/);
    expect(error?.message).not.toMatch(/tasks\.yaml/);
    expect(task('T001').status).toBe('ready');
    expect(task('T001').attempts).toBeUndefined();

    rmSync(join(root, 'wip.txt'));
    const retry = await update(['T001', 'in_progress']);
    expect(retry.error).toBeUndefined();
    expect(task('T001').attempts).toBe(1);
  });
});

describe('pitway task-update non-committing transitions (AC017)', () => {
  it('failed, blocked, review, and cancelled write tasks.yaml only and never commit', async () => {
    const before = commitCount(root);
    await update(['T001', 'in_progress']);
    for (const status of ['blocked', 'ready', 'in_progress', 'failed', 'ready', 'in_progress', 'review']) {
      const { error } = await update(['T001', status]);
      expect(error).toBeUndefined();
    }
    expect(task('T001').status).toBe('review');
    const { error } = await update(['T002', 'cancelled']);
    expect(error).toBeUndefined();
    expect(task('T002').status).toBe('cancelled');
    expect(commitCount(root)).toBe(before);
    expect(stagedFiles(root)).toBe('');
  });
});

describe('pitway task-update to completed (AC015, AC016)', () => {
  beforeEach(async () => {
    await inReview();
  });

  it('refuses without --result and --message, writing nothing', async () => {
    const { error } = await update(['T001', 'completed']);
    expect(error?.message).toMatch(/--result/);
    expect(error?.message).toMatch(/--message/);
    expect(task('T001').status).toBe('review');
    expect(commitCount(root)).toBe(2);
  });

  it('refuses a result file missing evidence, writing nothing', async () => {
    const result = join(scratch, 'result.yaml');
    const message = join(scratch, 'message.txt');
    writeFileSync(result, 'summary: Only a summary.\n');
    writeFileSync(message, MESSAGE_FIXTURE);
    const { error } = await update(['T001', 'completed', '--result', result, '--message', message]);
    expect(error?.message).toMatch(/evidence/);
    expect(task('T001').status).toBe('review');
    expect(commitCount(root)).toBe(2);
  });

  it('refuses dirty paths outside relevant_files plus tasks.yaml; nothing staged, committed, or written', async () => {
    touchRelevantFile();
    writeFileSync(join(root, 'wip.txt'), 'wip\n');
    const flags = completionFlags();
    const { error } = await update(['T001', 'completed', ...flags]);
    expect(error?.message).toMatch(/wip\.txt/);
    expect(task('T001').status).toBe('review');
    expect(task('T001').result).toBeNull();
    expect(stagedFiles(root)).toBe('');
    expect(commitCount(root)).toBe(2);
  });

  it('commits the dirty subset with both trailers and a metadata-stripped message', async () => {
    const { lines, error } = await completeT001(['--usage', '{"input_tokens":10,"output_tokens":5,"total_tokens":15}']);
    expect(error).toBeUndefined();
    const view = JSON.parse(lines[0]!) as { outcome: string; commit: string; status: string };
    expect(view.status).toBe('completed');
    expect(view.outcome).toBe('committed');

    const t = task('T001');
    expect(t.status).toBe('completed');
    expect(t.result).toEqual({ summary: 'Implemented the thing.', evidence: 'npm test passed' });
    expect(t.usage).toEqual({ input_tokens: 10, output_tokens: 5, total_tokens: 15 });
    expect(t.attempts).toBe(1);

    expect(commitCount(root)).toBe(3);
    expect(view.commit).toBe(git(['rev-parse', 'HEAD'], root).trim());
    expect(headFiles(root)).toEqual([TASKS_PATH, 'src/a.ts'].sort());
    const message = headMessage(root);
    expect(message.startsWith('task: complete T001')).toBe(true);
    expect(message).toContain('Implemented the first thing.');
    expect(message).toContain('PitWay-Milestone: M001');
    expect(message).toContain('PitWay-Task: T001');
    expect(message).not.toMatch(/Claude-Session/);
    expect(message).not.toMatch(/noreply@anthropic\.com/);
    expect(git(['status', '--porcelain'], root).trim()).toBe('');
  });

  it('accumulates --usage onto prior measured usage and leaves absent data null', async () => {
    editTask('T001', (t) => ({ ...t, usage: { input_tokens: 3, total_tokens: 100 } }));
    const { error } = await completeT001(['--usage', '{"total_tokens":50}']);
    expect(error).toBeUndefined();
    expect(task('T001').usage).toEqual({ input_tokens: 3, total_tokens: 150 });
  });

  it('keeps usage null when no --usage is measured', async () => {
    const { error } = await completeT001();
    expect(error).toBeUndefined();
    expect(task('T001').usage).toBeNull();
  });

  it('promotes a waiting dependent to ready within the same completion commit (AC010)', async () => {
    expect(task('T002').status).toBe('waiting');
    const before = commitCount(root);
    const { error } = await completeT001();
    expect(error).toBeUndefined();
    expect(task('T001').status).toBe('completed');
    expect(task('T002').status).toBe('ready');
    expect(commitCount(root)).toBe(before + 1);
    // The promotion landed in the exact same commit as the completion, not a
    // separate one: the committed tasks.yaml at HEAD already shows T002 ready.
    const committed = parse(
      git(['show', `HEAD:${TASKS_PATH}`], root),
    ) as { tasks: Array<{ id: string; status: string }> };
    expect(committed.tasks.find((t) => t.id === 'T002')?.status).toBe('ready');
  });
});

describe('pitway task-update completion re-entry (AC018)', () => {
  beforeEach(async () => {
    await inReview();
  });

  it('is idempotent once the completion commit landed, needing no flags', async () => {
    const first = await completeT001();
    expect(first.error).toBeUndefined();
    const sha = (JSON.parse(first.lines[0]!) as { commit: string }).commit;

    const again = await update(['T001', 'completed', '--json']);
    expect(again.error).toBeUndefined();
    expect(JSON.parse(again.lines[0]!)).toMatchObject({ outcome: 'already-committed', commit: sha });
    expect(commitCount(root)).toBe(3);
  });

  it('ignores sibling task changes when matching the completion commit', async () => {
    const first = await completeT001();
    expect(first.error).toBeUndefined();
    const sha = (JSON.parse(first.lines[0]!) as { commit: string }).commit;
    // AC010: completing T001 already auto-promoted T002 to ready in that
    // same commit.
    expect(task('T002').status).toBe('ready');

    // A sibling transition dirties tasks.yaml after the completion commit.
    expect((await update(['T002', 'in_progress'])).error).toBeUndefined();
    const again = await update(['T001', 'completed', '--json']);
    expect(again.error).toBeUndefined();
    expect(JSON.parse(again.lines[0]!)).toMatchObject({ outcome: 'already-committed', commit: sha });
    expect(task('T002').status).toBe('in_progress');
    expect(commitCount(root)).toBe(3);
  });

  it('resumes the pending commit after a hook failure, requiring --message and ignoring resupplied --result/--usage', async () => {
    const hook = installFailingHook();
    const { error } = await completeT001(['--usage', '{"total_tokens":15}']);
    expect(error).toBeDefined();
    expect(task('T001').status).toBe('completed');
    expect(task('T001').result?.summary).toBe('Implemented the thing.');
    expect(commitCount(root)).toBe(2);
    rmSync(hook);

    const bare = await update(['T001', 'completed']);
    expect(bare.error?.message).toMatch(/--message/);

    const result = join(scratch, 'result2.yaml');
    const message = join(scratch, 'message2.txt');
    writeFileSync(result, 'summary: A different summary.\nevidence: other\n');
    writeFileSync(message, MESSAGE_FIXTURE);
    const resumed = await update([
      'T001', 'completed', '--message', message, '--result', result,
      '--usage', '{"total_tokens":999}', '--json',
    ]);
    expect(resumed.error).toBeUndefined();
    expect(JSON.parse(resumed.lines[0]!)).toMatchObject({ outcome: 'committed' });
    expect(commitCount(root)).toBe(3);
    // Persisted result and usage stand; resupplied values were ignored.
    expect(task('T001').result?.summary).toBe('Implemented the thing.');
    expect(task('T001').usage).toEqual({ total_tokens: 15 });
    expect(headFiles(root)).toEqual([TASKS_PATH, 'src/a.ts'].sort());
  });

  it('refuses with a diagnostic when the commit exists but the local task is not completed', async () => {
    await completeT001();
    editTask('T001', (t) => ({ ...t, status: 'review', result: null }));
    const outcome = await completeT001();
    expect(outcome.error?.message).toMatch(/ambiguous/i);
    expect(commitCount(root)).toBe(3);
  });

  it('refuses with a diagnostic when the committed record does not match the persisted result', async () => {
    await completeT001();
    editTask('T001', (t) => ({ ...t, result: { summary: 'Rewritten afterwards.', evidence: 'other' } }));
    const { error } = await update(['T001', 'completed']);
    expect(error?.message).toMatch(/ambiguous/i);
    expect(commitCount(root)).toBe(3);
  });
});
