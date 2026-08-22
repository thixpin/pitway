import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCli } from '../../src/cli/index.js';
import { registerInitCommand } from '../../src/cli/commands/init.js';
import { registerMilestoneAddCommand } from '../../src/cli/commands/milestone-add.js';
import { registerMilestoneConfirmCommand } from '../../src/cli/commands/milestone-confirm.js';
import { registerTaskUpdateCommand } from '../../src/cli/commands/task-update.js';
import { loadConfig, loadState, loadTasks, saveConfig, saveState } from '../../src/state/store.js';
import { readJournal } from '../../src/state/journal.js';
import { dispatchTask } from '../../src/core/tasks/dispatch.js';
import { integrateTask, TaskIntegrateError } from '../../src/core/tasks/integrate.js';
import { WORKTREES_DIR } from '../../src/git/worktree.js';

// AC006/T006 (M014): integrate engine driven through the Core function
// directly -- happy paths, refusal matrix, and the sibling-rider proof.

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

const CONTRACT_FIXTURE = `---
schema_version: 1
id: M999
title: Integratable milestone
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
      - src/a.bin
      - src/seeded.ts
    write_scope:
      - src/a.ts
      - src/a.bin
      - src/seeded.ts
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
  registerTaskUpdateCommand(program, { root, write: (s) => lines.push(s) });
  try {
    await program.parseAsync(['node', 'pitway', ...args]);
    return { lines };
  } catch (error) {
    return { lines, error: error as Error };
  }
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'pitway-integ-'));
  scratch = mkdtempSync(join(tmpdir(), 'pitway-integ-in-'));
  git(['init', '-q'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  writeFileSync(join(root, 'README.md'), 'seed\n');
  execFileSync('mkdir', ['-p', join(root, 'src')]);
  writeFileSync(join(root, 'src', 'seeded.ts'), 'export const seeded = 1;\n');
  git(['add', '.'], root);
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

// Simulates a worker: writes files inside the worktree and commits them on
// the scaffolding branch.
function workerCommit(worktree: string, files: Record<string, string | Buffer>, message = 'worker: change'): void {
  for (const [rel, content] of Object.entries(files)) {
    const path = join(worktree, rel);
    execFileSync('mkdir', ['-p', join(path, '..')]);
    writeFileSync(path, content);
  }
  git(['add', '-A'], worktree);
  git(['commit', '-q', '-m', message], worktree);
}

describe('integrateTask engine (M014/T006)', () => {
  it('happy path: applies exactly the diff uncommitted, records the journal entry, cleans up', () => {
    const dispatched = dispatchTask(root, 'T001');
    workerCommit(dispatched.worktreePath, { 'src/a.ts': 'export const a = 1;\n' });

    const view = integrateTask(root, 'T001');
    expect(view.outcome).toBe('integrated');
    expect(view.changedPaths).toEqual(['src/a.ts']);
    expect(view.workerSha).toMatch(/^[0-9a-f]{40}$/);

    // Diff applied, uncommitted, unstaged.
    expect(readFileSync(join(root, 'src', 'a.ts'), 'utf8')).toBe('export const a = 1;\n');
    expect(git(['diff', '--cached', '--name-only'], root).trim()).toBe('');
    const status = git(['status', '--porcelain'], root);
    expect(status).toContain('src/a.ts');

    // Cleanup: worktree and scaffolding branch gone.
    expect(existsSync(dispatched.worktreePath)).toBe(false);
    expect(git(['branch', '--list', 'pitway/task/M001-T001'], root).trim()).toBe('');

    // Journal record closes the dispatch, carrying the worker SHA.
    const record = readJournal(root).find((r) => r.kind === 'worktree_integrate');
    expect(record).toMatchObject({ taskId: 'T001', dispatchId: dispatched.dispatchId, workerSha: view.workerSha });
  });

  it('a multi-commit worker branch integrates as one combined diff', () => {
    const dispatched = dispatchTask(root, 'T001');
    workerCommit(dispatched.worktreePath, { 'src/a.ts': 'v1\n' }, 'worker: first');
    workerCommit(dispatched.worktreePath, { 'src/a.ts': 'v2\n' }, 'worker: second');

    const view = integrateTask(root, 'T001');
    expect(view.changedPaths).toEqual(['src/a.ts']);
    expect(readFileSync(join(root, 'src', 'a.ts'), 'utf8')).toBe('v2\n');
  });

  it('binary files integrate correctly (--binary diff)', () => {
    const dispatched = dispatchTask(root, 'T001');
    const binary = Buffer.from([0, 1, 2, 3, 0, 255, 254]);
    workerCommit(dispatched.worktreePath, { 'src/a.bin': binary });

    integrateTask(root, 'T001');
    expect(readFileSync(join(root, 'src', 'a.bin'))).toEqual(binary);
  });

  it('an in-scope deletion integrates (--no-renames plain listing)', () => {
    const dispatched = dispatchTask(root, 'T001');
    execFileSync('git', ['rm', '-q', 'src/seeded.ts'], { cwd: dispatched.worktreePath });
    git(['commit', '-q', '-m', 'worker: delete'], dispatched.worktreePath);

    const view = integrateTask(root, 'T001');
    expect(view.changedPaths).toEqual(['src/seeded.ts']);
    expect(existsSync(join(root, 'src', 'seeded.ts'))).toBe(false);
  });

  it('refuses an out-of-scope path, naming it, main tree byte-identical, worktree preserved', () => {
    const dispatched = dispatchTask(root, 'T001');
    workerCommit(dispatched.worktreePath, {
      'src/a.ts': 'ok\n',
      'src/z.ts': 'outside\n',
    });

    const before = git(['status', '--porcelain'], root);
    expect(() => integrateTask(root, 'T001')).toThrow(/src\/z\.ts/);
    expect(git(['status', '--porcelain'], root)).toBe(before);
    expect(existsSync(dispatched.worktreePath)).toBe(true);
    expect(existsSync(join(root, 'src', 'a.ts'))).toBe(false);
    expect(loadTasks(root, 'M001').tasks.find((t) => t.id === 'T001')?.status).toBe('in_progress');
  });

  it('refuses a worker change touching .pitway/ state', () => {
    const dispatched = dispatchTask(root, 'T001');
    workerCommit(dispatched.worktreePath, { '.pitway/state.yaml': 'schema_version: 1\ntampered: true\n' });
    expect(() => integrateTask(root, 'T001')).toThrow(/\.pitway\//);
    expect(existsSync(dispatched.worktreePath)).toBe(true);
  });

  it("refuses when the worker committed nothing ('still at the created-from revision')", () => {
    dispatchTask(root, 'T001');
    expect(() => integrateTask(root, 'T001')).toThrow(/committed nothing/);
  });

  it('refuses a task with no live dispatch record, pointing at task-discard', () => {
    expect(() => integrateTask(root, 'T002')).toThrow(/no live worktree dispatch/);
  });

  it('refuses with no active milestone', () => {
    saveState(root, { ...loadState(root), active_milestone: null });
    expect(() => integrateTask(root, 'T001')).toThrow(/no active milestone; nothing to integrate/);
  });

  it("refuses when the execution strategy isn't parallel_worktrees", () => {
    saveConfig(root, { schema_version: 1 });
    expect(() => integrateTask(root, 'T001')).toThrow(/parallel_worktrees/);
    expect(() => integrateTask(root, 'T001')).toThrow(/"sequential"/);
  });

  it('refuses an unknown task id', () => {
    expect(() => integrateTask(root, 'NOPE')).toThrow(/unknown task NOPE in milestone M001/);
  });

  it("refuses when the scaffolding branch is missing while the worktree survives", () => {
    const dispatched = dispatchTask(root, 'T001');
    workerCommit(dispatched.worktreePath, { 'src/a.ts': 'ok\n' });
    execFileSync('git', ['update-ref', '-d', 'refs/heads/pitway/task/M001-T001'], { cwd: root });
    expect(() => integrateTask(root, 'T001')).toThrow(
      /scaffolding branch pitway\/task\/M001-T001 is missing/,
    );
    expect(existsSync(dispatched.worktreePath)).toBe(true);
  });

  it("refuses an empty combined diff (worker's commits change nothing)", () => {
    const dispatched = dispatchTask(root, 'T001');
    git(['commit', '-q', '--allow-empty', '-m', 'worker: empty'], dispatched.worktreePath);
    expect(() => integrateTask(root, 'T001')).toThrow(/nothing to integrate/);
    expect(existsSync(dispatched.worktreePath)).toBe(true);
  });

  it('refuses when the combined diff no longer applies cleanly to a diverged main tree', () => {
    const dispatched = dispatchTask(root, 'T001');
    workerCommit(dispatched.worktreePath, { 'src/seeded.ts': 'worker version\n' });
    writeFileSync(join(root, 'src', 'seeded.ts'), 'main version\n');
    git(['add', 'src/seeded.ts'], root);
    git(['commit', '-q', '-m', 'main diverges'], root);

    expect(() => integrateTask(root, 'T001')).toThrow(/does not apply cleanly/);
    // Nothing was written: only dispatch's own expected tasks.yaml dirt.
    expect(git(['status', '--porcelain', '--', 'src'], root)).toBe('');
    expect(readFileSync(join(root, 'src', 'seeded.ts'), 'utf8')).toBe('main version\n');
    expect(loadTasks(root, 'M001').tasks.find((t) => t.id === 'T001')?.status).toBe('in_progress');
  });

  it('refuses on an unexpectedly dirty main tree', () => {
    const dispatched = dispatchTask(root, 'T001');
    workerCommit(dispatched.worktreePath, { 'src/a.ts': 'ok\n' });
    writeFileSync(join(root, 'README.md'), 'dirtied\n');
    expect(() => integrateTask(root, 'T001')).toThrow(TaskIntegrateError);
    expect(existsSync(dispatched.worktreePath)).toBe(true);
  });

  it('sibling-rider: completing an integrated task while another stays dispatched produces the standard atomic commit', async () => {
    const first = dispatchTask(root, 'T001');
    const second = dispatchTask(root, 'T002');
    workerCommit(first.worktreePath, { 'src/a.ts': 'export const a = 1;\n' });

    integrateTask(root, 'T001');

    const result = join(scratch, 'result.yaml');
    const message = join(scratch, 'message.txt');
    writeFileSync(result, 'summary: Done.\nevidence: tests passed\n');
    writeFileSync(message, 'task: complete T001\n');
    expect((await run(['task-update', 'T001', 'review'])).error).toBeUndefined();
    expect(
      (await run(['task-update', 'T001', 'completed', '--result', result, '--message', message]))
        .error,
    ).toBeUndefined();

    // The completion commit exists with trailers and carries the sibling's
    // in_progress tasks.yaml state as a rider -- findCompletionCommit's
    // parsed comparison already ignores sibling changes.
    const head = git(['log', '-1', '--format=%B'], root);
    expect(head).toContain('PitWay-Task: T001');
    const tasks = loadTasks(root, 'M001').tasks;
    expect(tasks.find((t) => t.id === 'T001')?.status).toBe('completed');
    expect(tasks.find((t) => t.id === 'T002')?.status).toBe('in_progress');
    expect(existsSync(second.worktreePath)).toBe(true);
  });
});
