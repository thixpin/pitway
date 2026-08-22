import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCli } from '../../src/cli/index.js';
import { registerInitCommand } from '../../src/cli/commands/init.js';
import { registerMilestoneAddCommand } from '../../src/cli/commands/milestone-add.js';
import { registerMilestoneConfirmCommand } from '../../src/cli/commands/milestone-confirm.js';
import { registerTaskIntegrateCommand } from '../../src/cli/commands/task-integrate.js';
import { registerTaskUpdateCommand } from '../../src/cli/commands/task-update.js';
import { registerTaskVerifyCommand } from '../../src/cli/commands/task-verify.js';
import { loadConfig, saveConfig } from '../../src/state/store.js';
import { appendWorktreeIntegrateRecord, readJournal } from '../../src/state/journal.js';
import { dispatchTask } from '../../src/core/tasks/dispatch.js';
import { integrateTask } from '../../src/core/tasks/integrate.js';
import { applyDiff, computeRangeDiff } from '../../src/git/apply.js';

// AC006/AC007 (M014/T007): CLI wiring, idempotent crash-window re-runs, and
// evidence parity for the post-integration authoritative task-verify.

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

const CONTRACT_FIXTURE = `---
schema_version: 1
id: M999
title: Recoverable milestone
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

// The verification detail is a trivially-green command so the authoritative
// task-verify runs for real (recording evidence) without recursing into any
// actual suite.
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
      strategy: command
      detail: node -e "console.log('1 passed')"
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
  registerTaskIntegrateCommand(program, { root, write: (s) => lines.push(s) });
  registerTaskUpdateCommand(program, { root, write: (s) => lines.push(s) });
  registerTaskVerifyCommand(program, { root, write: (s) => lines.push(s) });
  try {
    await program.parseAsync(['node', 'pitway', ...args]);
    return { lines };
  } catch (error) {
    return { lines, error: error as Error };
  }
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'pitway-recov-'));
  scratch = mkdtempSync(join(tmpdir(), 'pitway-recov-in-'));
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

function workerCommit(worktree: string, content: string): string {
  writeFileSync(join(worktree, 'src', 'a.ts'), content);
  git(['add', '-A'], worktree);
  git(['commit', '-q', '-m', 'worker: change'], worktree);
  return git(['rev-parse', 'HEAD'], worktree).trim();
}

function setupWorktreeSrc(worktree: string): void {
  execFileSync('mkdir', ['-p', join(worktree, 'src')]);
}

describe('task-integrate CLI + crash recovery (M014/T007)', () => {
  it('happy path through the CLI emits the integrate view and next-steps guidance', async () => {
    const dispatched = dispatchTask(root, 'T001');
    setupWorktreeSrc(dispatched.worktreePath);
    workerCommit(dispatched.worktreePath, 'export const a = 1;\n');

    const result = await run(['task-integrate', 'T001', '--json']);
    expect(result.error).toBeUndefined();
    const view = JSON.parse(result.lines.join('\n')) as Record<string, unknown>;
    expect(view.outcome).toBe('integrated');
    expect(view.changedPaths).toEqual(['src/a.ts']);
  });

  it('crash window A (applied, unrecorded): re-run recovers -- records + cleans up, never refuses', async () => {
    const dispatched = dispatchTask(root, 'T001');
    setupWorktreeSrc(dispatched.worktreePath);
    const workerSha = workerCommit(dispatched.worktreePath, 'export const a = 1;\n');

    // Simulate the crash: the diff landed in the main tree but no journal
    // record and no cleanup happened.
    const diff = computeRangeDiff(root, dispatched.createdFrom, workerSha);
    applyDiff(root, diff);

    const view = integrateTask(root, 'T001');
    expect(view.outcome).toBe('recovered');
    expect(view.workerSha).toBe(workerSha);
    // The applied content is intact, exactly once.
    expect(readFileSync(join(root, 'src', 'a.ts'), 'utf8')).toBe('export const a = 1;\n');
    // Record landed, worktree/branch cleaned up.
    expect(readJournal(root).some((r) => r.kind === 'worktree_integrate')).toBe(true);
    expect(existsSync(dispatched.worktreePath)).toBe(false);
    expect(git(['branch', '--list', 'pitway/task/M001-T001'], root).trim()).toBe('');
  });

  it('crash window B (recorded, worktree surviving): re-run completes cleanup only', async () => {
    const dispatched = dispatchTask(root, 'T001');
    setupWorktreeSrc(dispatched.worktreePath);
    const workerSha = workerCommit(dispatched.worktreePath, 'export const a = 1;\n');

    // Simulate: apply + record happened, cleanup did not.
    const diff = computeRangeDiff(root, dispatched.createdFrom, workerSha);
    applyDiff(root, diff);
    appendWorktreeIntegrateRecord(root, {
      id: 'wti-crash',
      dispatchId: dispatched.dispatchId,
      milestone: 'M001',
      taskId: 'T001',
      workerSha,
      at: '2026-08-20T00:00:00Z',
    });

    const view = integrateTask(root, 'T001');
    expect(view.outcome).toBe('cleanup-completed');
    expect(existsSync(dispatched.worktreePath)).toBe(false);
    expect(git(['branch', '--list', 'pitway/task/M001-T001'], root).trim()).toBe('');
    // No duplicate integrate record was appended.
    expect(readJournal(root).filter((r) => r.kind === 'worktree_integrate')).toHaveLength(1);
  });

  it('a vanished worktree refuses, pointing at task-discard', async () => {
    const dispatched = dispatchTask(root, 'T001');
    rmSync(dispatched.worktreePath, { recursive: true, force: true });
    const result = await run(['task-integrate', 'T001']);
    expect(result.error?.message).toContain('task-discard');
  });

  it('AC007 evidence parity: post-integration main-tree task-verify records evidence like a sequential task, then review -> completed commits atomically', async () => {
    const dispatched = dispatchTask(root, 'T001');
    setupWorktreeSrc(dispatched.worktreePath);
    workerCommit(dispatched.worktreePath, 'export const a = 1;\n');
    integrateTask(root, 'T001');

    // Authoritative verify runs in the main tree while still in_progress.
    const verify = await run(['task-verify', 'T001']);
    expect(verify.error).toBeUndefined();
    const evidence = readJournal(root).filter((r) => r.kind === 'task_verify_evidence');
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({ taskId: 'T001', attempts: 1 });

    // Then the unchanged completion path produces the one atomic commit.
    const result = join(scratch, 'result.yaml');
    const message = join(scratch, 'message.txt');
    writeFileSync(result, 'summary: Done.\nevidence: node reported 1 passed\n');
    writeFileSync(message, 'task: complete T001\n');
    expect((await run(['task-update', 'T001', 'review'])).error).toBeUndefined();
    expect(
      (await run(['task-update', 'T001', 'completed', '--result', result, '--message', message]))
        .error,
    ).toBeUndefined();
    const head = git(['log', '-1', '--format=%B'], root);
    expect(head).toContain('PitWay-Milestone: M001');
    expect(head).toContain('PitWay-Task: T001');
    const committed = git(['show', '--name-only', '--format='], root);
    expect(committed).toContain('src/a.ts');
  });

  it('renders the default-outcome human message (no --json)', async () => {
    const dispatched = dispatchTask(root, 'T001');
    setupWorktreeSrc(dispatched.worktreePath);
    workerCommit(dispatched.worktreePath, 'export const a = 1;\n');

    const result = await run(['task-integrate', 'T001']);
    expect(result.error).toBeUndefined();
    const text = result.lines.join('\n');
    expect(text).toContain('Integrated T001');
    expect(text).toContain('task-verify T001');
  });

  it("renders the 'recovered' human message (no --json)", async () => {
    const dispatched = dispatchTask(root, 'T001');
    setupWorktreeSrc(dispatched.worktreePath);
    const workerSha = workerCommit(dispatched.worktreePath, 'export const a = 1;\n');

    const diff = computeRangeDiff(root, dispatched.createdFrom, workerSha);
    applyDiff(root, diff);

    const result = await run(['task-integrate', 'T001']);
    expect(result.error).toBeUndefined();
    const text = result.lines.join('\n');
    expect(text).toContain('was already applied (crash-window re-run)');
  });

  it("renders the 'cleanup-completed' human message (no --json)", async () => {
    const dispatched = dispatchTask(root, 'T001');
    setupWorktreeSrc(dispatched.worktreePath);
    const workerSha = workerCommit(dispatched.worktreePath, 'export const a = 1;\n');

    const diff = computeRangeDiff(root, dispatched.createdFrom, workerSha);
    applyDiff(root, diff);
    appendWorktreeIntegrateRecord(root, {
      id: 'wti-crash-human',
      dispatchId: dispatched.dispatchId,
      milestone: 'M001',
      taskId: 'T001',
      workerSha,
      at: '2026-08-20T00:00:00Z',
    });

    const result = await run(['task-integrate', 'T001']);
    expect(result.error).toBeUndefined();
    const text = result.lines.join('\n');
    expect(text).toContain('integration was already recorded');
  });

  it('falls back to console.log and process.cwd() when write/root deps are omitted', async () => {
    const dispatched = dispatchTask(root, 'T001');
    setupWorktreeSrc(dispatched.worktreePath);
    workerCommit(dispatched.worktreePath, 'export const a = 1;\n');

    const program = buildCli();
    registerTaskIntegrateCommand(program);
    const originalCwd = process.cwd();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    let calls: unknown[][];
    try {
      process.chdir(root);
      await program.parseAsync(['node', 'pitway', 'task-integrate', 'T001', '--json']);
    } finally {
      process.chdir(originalCwd);
      // mockRestore() also clears recorded calls (vitest v4), so capture
      // them before restoring.
      calls = logSpy.mock.calls;
      logSpy.mockRestore();
    }
    expect(calls).toHaveLength(1);
    const view = JSON.parse(calls[0]![0] as string) as Record<string, unknown>;
    expect(view.outcome).toBe('integrated');
  });
});

// M024/T005 gate widening: gitWithInput's stderr-empty arm -- when git
// cannot be spawned at all, the GitError carries the spawn error's own
// message instead of a stderr dump. Real behavioral case via PATH removal.
describe('git/apply error fallback (M024/T005)', () => {
  it('falls back to the spawn error message when git cannot be executed', () => {
    const dispatched = dispatchTask(root, 'T001');
    const originalPath = process.env.PATH;
    process.env.PATH = '/nonexistent';
    try {
      expect(() => computeRangeDiff(root, dispatched.createdFrom, 'HEAD')).toThrow(/spawnSync git ENOENT/);
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
    }
  });
});
