import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCli } from '../../src/cli/index.js';
import { registerInitCommand } from '../../src/cli/commands/init.js';
import { registerMilestoneAddCommand } from '../../src/cli/commands/milestone-add.js';
import { registerMilestoneConfirmCommand } from '../../src/cli/commands/milestone-confirm.js';
import { registerTaskUpdateCommand } from '../../src/cli/commands/task-update.js';
import { registerTaskVerifyCommand } from '../../src/cli/commands/task-verify.js';
import { loadTasks } from '../../src/state/store.js';
import type { Task } from '../../src/state/schemas.js';
import type { JournalTaskVerifyEvidence } from '../../src/state/journal.js';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

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

// A portable, deterministic pass command -- relies only on the node binary
// already running this test process, never on npm/vitest being reachable as
// a sub-process command (which the fixture files here have no reason to
// support).
const TASKS_FIXTURE = `schema_version: 1
tasks:
  - id: T001
    objective: First task.
    status: planned
    depends_on: []
    acceptance_criteria:
      - It works
    write_scope:
      - src/a.ts
    verification:
      strategy: command
      detail: "node -e \\"process.exit(0)\\""
    result: null
    usage: null
  - id: T002
    objective: Manual review task.
    status: planned
    depends_on: []
    acceptance_criteria:
      - It works too
    write_scope:
      - src/b.ts
    verification:
      strategy: manual
      detail: A developer confirms this manually.
    result: null
    usage: null
`;

function milestoneDirName(id: string): string {
  const dir = join(root, '.pitway', 'milestones');
  const match = readdirSync(dir).find((e) => e === id || e.startsWith(`${id}-`));
  if (!match) throw new Error(`no milestone directory found for ${id}`);
  return match;
}

const milestoneRelFile = (file: string): string =>
  `.pitway/milestones/${milestoneDirName('M001')}/${file}`;

const tasksPath = (): string => milestoneRelFile('tasks.yaml');

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
  registerTaskUpdateCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerTaskVerifyCommand(program, { root: cwd, write: (s) => lines.push(s) });
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

async function taskVerify(args: string[]): Promise<{ lines: string[]; error?: Error }> {
  return run(['task-verify', ...args, '--json'], root);
}

const task = (id: string): Task => {
  const found = loadTasks(root, 'M001').tasks.find((t) => t.id === id);
  if (!found) throw new Error(`missing task ${id}`);
  return found;
};

async function confirmedMilestone(): Promise<void> {
  const contract = join(root, 'draft-contract.md');
  const tasksFile = join(root, 'draft-tasks.yaml');
  writeFileSync(contract, CONTRACT_FIXTURE);
  writeFileSync(tasksFile, TASKS_FIXTURE);
  const added = await run(['milestone-add', '--contract', contract, '--tasks', tasksFile], root);
  expect(added.error).toBeUndefined();
  rmSync(contract);
  rmSync(tasksFile);
  const confirmed = await run(['milestone-confirm', 'M001'], root);
  expect(confirmed.error).toBeUndefined();
}

function completionFlags(): string[] {
  const result = join(scratch, 'result.yaml');
  const message = join(scratch, 'message.txt');
  writeFileSync(result, RESULT_FIXTURE);
  writeFileSync(message, MESSAGE_FIXTURE);
  return ['--result', result, '--message', message];
}

function touchFile(rel: string, content: string): void {
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, rel), content);
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'pitway-tver-'));
  scratch = mkdtempSync(join(tmpdir(), 'pitway-tver-in-'));
  git(['init', '-q'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  writeFileSync(join(root, 'README.md'), 'seed\n');
  git(['add', 'README.md'], root);
  git(['commit', '-q', '-m', 'init'], root);
  // --no-claude: this file exercises task-verify + task-update, not Claude
  // Code asset installation (covered by tests/integration/init.test.ts).
  await run(['init', '--no-claude'], root);
  await confirmedMilestone();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

// (a) Primary, most load-bearing case: the real, mandatory lifecycle
// in_progress -> task-verify -> review -> completed, driven entirely through
// the real CLI dispatch. This is the direct regression test for the
// architecture-review CRITICAL finding that blocked earlier drafts of this
// milestone: a fingerprint or dirty-path check that included .pitway/ state
// would always refuse here, because `review` rewrites tasks.yaml between
// task-verify and completion. It doesn't -- proven end-to-end below.
describe('pitway task-verify end-to-end lifecycle (primary regression)', () => {
  it('survives the review-state tasks.yaml rewrite between task-verify and completion', async () => {
    expect((await update(['T001', 'in_progress'])).error).toBeUndefined();
    touchFile('src/a.ts', 'export const a = 1;\n');

    const verified = await taskVerify(['T001']);
    expect(verified.error).toBeUndefined();
    const evidence = JSON.parse(verified.lines[0]!) as JournalTaskVerifyEvidence;
    expect(evidence.taskId).toBe('T001');
    expect(evidence.exitCode).toBe(0);
    expect(evidence.terminationReason).toBe('exited');
    expect(evidence.fingerprint.entries).toEqual([
      expect.objectContaining({ path: 'src/a.ts', state: 'present' }),
    ]);

    // review rewrites tasks.yaml (AC017: never commits, but the file's bytes
    // change) -- this must never touch the recorded evidence.
    expect((await update(['T001', 'review'])).error).toBeUndefined();
    expect(task('T001').status).toBe('review');

    const completed = await update(['T001', 'completed', ...completionFlags(), '--json']);
    expect(completed.error).toBeUndefined();
    const view = JSON.parse(completed.lines[0]!) as { outcome: string; status: string };
    expect(view.status).toBe('completed');
    expect(view.outcome).toBe('committed');
    expect(task('T001').status).toBe('completed');
    expect(task('T001').result).toEqual({
      summary: 'Implemented the thing.',
      evidence: evidence.evidence,
    });
    expect(git(['status', '--porcelain'], root).trim()).toBe('');
  });
});

// (b) task-verify refuses on a manual/review-strategy task.
describe('pitway task-verify refuses a non-command/tdd task', () => {
  it('refuses a manual-strategy task with a clear, non-zero-exit error', async () => {
    expect((await update(['T002', 'in_progress'])).error).toBeUndefined();
    const { error } = await taskVerify(['T002']);
    expect(error).toBeDefined();
    expect(error?.message).toMatch(/strategy is "manual"/);
    expect(task('T002').status).toBe('in_progress');
  });
});

// (c) A passing task-verify run's evidence is accepted implicitly by
// `task-update completed` with no --evidence flag.
describe('pitway task-update accepts a passing task-verify record implicitly', () => {
  it('replaces --result\'s evidence text with the captured evidence, unprompted', async () => {
    await update(['T001', 'in_progress']);
    touchFile('src/a.ts', 'export const a = 1;\n');
    const verified = await taskVerify(['T001']);
    expect(verified.error).toBeUndefined();
    const evidence = JSON.parse(verified.lines[0]!) as JournalTaskVerifyEvidence;

    await update(['T001', 'review']);
    const { error } = await update(['T001', 'completed', ...completionFlags()]);
    expect(error).toBeUndefined();
    expect(task('T001').result).toEqual({
      summary: 'Implemented the thing.',
      evidence: evidence.evidence,
    });
  });
});

// (d) A real source-code change inside write_scope made after task-verify
// but before completion causes completion to refuse (fingerprint mismatch),
// not fall through silently.
describe('pitway task-update refuses completion after a post-verify write_scope edit', () => {
  it('refuses with a fingerprint mismatch naming the changed path', async () => {
    await update(['T001', 'in_progress']);
    touchFile('src/a.ts', 'export const a = 1;\n');
    const verified = await taskVerify(['T001']);
    expect(verified.error).toBeUndefined();

    touchFile('src/a.ts', 'export const a = 2; // changed after verify\n');
    await update(['T001', 'review']);
    const { error } = await update(['T001', 'completed', ...completionFlags()]);
    expect(error?.message).toMatch(/fingerprint mismatch/);
    expect(error?.message).toMatch(/src\/a\.ts/);
    expect(task('T001').status).toBe('review');
    expect(task('T001').result).toBeNull();
  });
});

// (e) A mismatched attempts count (task retried after verify) causes
// completion to refuse the same way.
describe('pitway task-update refuses completion after a post-verify retry', () => {
  it('refuses with an attempt mismatch', async () => {
    await update(['T001', 'in_progress']);
    const verified = await taskVerify(['T001']);
    expect(verified.error).toBeUndefined();

    expect((await update(['T001', 'failed'])).error).toBeUndefined();
    expect((await update(['T001', 'ready'])).error).toBeUndefined();
    expect((await update(['T001', 'in_progress'])).error).toBeUndefined();
    expect(task('T001').attempts).toBe(2);
    expect((await update(['T001', 'review'])).error).toBeUndefined();

    const { error } = await update(['T001', 'completed', ...completionFlags()]);
    expect(error?.message).toMatch(/attempt mismatch/);
    expect(task('T001').status).toBe('review');
    expect(task('T001').result).toBeNull();
  });
});

// (f) An explicit --evidence <id> correctly selects that specific record and
// still applies the same validation.
describe('pitway task-update accepts an explicit --evidence id', () => {
  it('selects the named record and applies identical validation', async () => {
    await update(['T001', 'in_progress']);
    touchFile('src/a.ts', 'export const a = 1;\n');
    const verified = await taskVerify(['T001']);
    expect(verified.error).toBeUndefined();
    const evidence = JSON.parse(verified.lines[0]!) as JournalTaskVerifyEvidence;

    await update(['T001', 'review']);
    const { error } = await update([
      'T001', 'completed', ...completionFlags(), '--evidence', evidence.id,
    ]);
    expect(error).toBeUndefined();
    expect(task('T001').result).toEqual({
      summary: 'Implemented the thing.',
      evidence: evidence.evidence,
    });
  });

  it('still refuses an unknown explicit evidence id', async () => {
    await update(['T001', 'in_progress']);
    touchFile('src/a.ts', 'export const a = 1;\n');
    await update(['T001', 'review']);
    const { error } = await update([
      'T001', 'completed', ...completionFlags(), '--evidence', 'tve-does-not-exist',
    ]);
    expect(error?.message).toMatch(/unknown evidence id/i);
    expect(task('T001').status).toBe('review');
  });
});

// (g) --result/--message alone still work exactly as before when no
// task_verify_evidence record exists for the task at all (regression: this
// milestone is additive-only).
describe('pitway task-update completion without any task-verify record', () => {
  it('still works via --result/--message alone, unchanged (additive-only regression)', async () => {
    await update(['T001', 'in_progress']);
    touchFile('src/a.ts', 'export const a = 1;\n');
    await update(['T001', 'review']);
    const { error } = await update(['T001', 'completed', ...completionFlags()]);
    expect(error).toBeUndefined();
    expect(task('T001').result).toEqual({
      summary: 'Implemented the thing.',
      evidence: 'npm test passed',
    });
    expect(git(['show', '--name-only', '--format=', 'HEAD'], root).split('\n').filter(Boolean).sort()).toEqual(
      [tasksPath(), 'src/a.ts'].sort(),
    );
  });
});
