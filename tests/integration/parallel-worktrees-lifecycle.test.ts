import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCli } from '../../src/cli/index.js';
import { registerInitCommand } from '../../src/cli/commands/init.js';
import { registerMilestoneAddCommand } from '../../src/cli/commands/milestone-add.js';
import { registerMilestoneConfirmCommand } from '../../src/cli/commands/milestone-confirm.js';
import { registerTaskDispatchCommand } from '../../src/cli/commands/task-dispatch.js';
import { registerTaskIntegrateCommand } from '../../src/cli/commands/task-integrate.js';
import { registerTaskUpdateCommand } from '../../src/cli/commands/task-update.js';
import { registerTaskVerifyCommand } from '../../src/cli/commands/task-verify.js';
import { loadConfig, loadContract, loadTasks, saveConfig } from '../../src/state/store.js';
import { WORKTREES_DIR } from '../../src/git/worktree.js';

// AC009/T009 (M014): the full parallel lifecycle end-to-end, named after
// M012's branch-isolation-lifecycle convention. Test-only task: any product
// defect found here stops work per the contract-conflict rule.

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

const CONTRACT_FIXTURE = `---
schema_version: 1
id: M999
title: Lifecycle milestone
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

// Two dependency-independent, write-scope-disjoint tasks plus one dependent
// task. Trivially-green verification commands keep the authoritative
// task-verify real without recursing into any actual suite.
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
      strategy: command
      detail: node -e "console.log('1 passed')"
    result: null
    usage: null
  - id: T003
    objective: Dependent task.
    status: planned
    depends_on: [T001, T002]
    acceptance_criteria:
      - It works
    context_files:
      - src/c.ts
    write_scope:
      - src/c.ts
    verification:
      strategy: command
      detail: node -e "console.log('1 passed')"
    result: null
    usage: null
`;

let roots: string[];
let scratch: string;

beforeEach(() => {
  roots = [];
  scratch = mkdtempSync(join(tmpdir(), 'pitway-lifec-in-'));
});

afterEach(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

function makeRun(root: string) {
  return async (args: string[]): Promise<{ lines: string[]; error?: Error }> => {
    const program = buildCli();
    const lines: string[] = [];
    registerInitCommand(program, { root, write: (s) => lines.push(s) });
    registerMilestoneAddCommand(program, { root, write: (s) => lines.push(s) });
    registerMilestoneConfirmCommand(program, { root, write: (s) => lines.push(s) });
    registerTaskDispatchCommand(program, { root, write: (s) => lines.push(s) });
    registerTaskIntegrateCommand(program, { root, write: (s) => lines.push(s) });
    registerTaskUpdateCommand(program, { root, write: (s) => lines.push(s) });
    registerTaskVerifyCommand(program, { root, write: (s) => lines.push(s) });
    try {
      await program.parseAsync(['node', 'pitway', ...args]);
      return { lines };
    } catch (error) {
      return { lines, error: error as Error };
    }
  };
}

interface Repo {
  root: string;
  run: (args: string[]) => Promise<{ lines: string[]; error?: Error }>;
}

async function makeRepo(config: {
  execution?: 'parallel_worktrees';
  branch?: 'milestone';
}): Promise<Repo> {
  const root = mkdtempSync(join(tmpdir(), 'pitway-lifec-'));
  roots.push(root);
  const run = makeRun(root);
  git(['init', '-q'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  writeFileSync(join(root, 'README.md'), 'seed\n');
  git(['add', 'README.md'], root);
  git(['commit', '-q', '-m', 'init'], root);
  await run(['init', '--no-claude']);
  const base = loadConfig(root);
  saveConfig(root, {
    ...base,
    ...(config.branch ? { git: { branch_strategy: 'milestone' as const } } : {}),
    ...(config.execution ? { execution: { strategy: 'parallel_worktrees' as const } } : {}),
  });
  const contract = join(scratch, `contract-${roots.length}.md`);
  const tasks = join(scratch, `tasks-${roots.length}.yaml`);
  writeFileSync(contract, CONTRACT_FIXTURE);
  writeFileSync(tasks, TASKS_FIXTURE);
  const added = await run(['milestone-add', '--contract', contract, '--tasks', tasks]);
  expect(added.error).toBeUndefined();
  const confirmed = await run(['milestone-confirm', 'M001']);
  expect(confirmed.error).toBeUndefined();
  return { root, run };
}

function workerCommit(worktree: string, rel: string, content: string): void {
  mkdirSync(join(worktree, rel, '..'), { recursive: true });
  writeFileSync(join(worktree, rel), content);
  git(['add', '-A'], worktree);
  git(['commit', '-q', '-m', `worker: ${rel}`], worktree);
}

async function completeInMainTree(repo: Repo, id: string): Promise<void> {
  const result = join(scratch, `result-${id}.yaml`);
  const message = join(scratch, `message-${id}.txt`);
  writeFileSync(result, 'summary: Done.\nevidence: node reported 1 passed\n');
  writeFileSync(message, `task: complete ${id}\n`);
  expect((await repo.run(['task-verify', id])).error).toBeUndefined();
  expect((await repo.run(['task-update', id, 'review'])).error).toBeUndefined();
  expect(
    (await repo.run(['task-update', id, 'completed', '--result', result, '--message', message]))
      .error,
  ).toBeUndefined();
}

function dispatchWorktreePath(root: string, id: string): string {
  return join(root, WORKTREES_DIR, `M001-${id}`);
}

// Runs the shared 3-task graph in parallel mode: dispatch both independents,
// worker-commit distinct files, integrate ascending, complete each, then the
// dependent inline.
async function runParallelLifecycle(repo: Repo): Promise<void> {
  expect((await repo.run(['task-dispatch', 'T001'])).error).toBeUndefined();
  expect((await repo.run(['task-dispatch', 'T002'])).error).toBeUndefined();
  workerCommit(dispatchWorktreePath(repo.root, 'T001'), 'src/a.ts', 'export const a = 1;\n');
  workerCommit(dispatchWorktreePath(repo.root, 'T002'), 'src/b.ts', 'export const b = 2;\n');

  // Deterministic driver convention: ascending task id among finished tasks.
  expect((await repo.run(['task-integrate', 'T001'])).error).toBeUndefined();
  await completeInMainTree(repo, 'T001');
  expect((await repo.run(['task-integrate', 'T002'])).error).toBeUndefined();
  await completeInMainTree(repo, 'T002');

  // The dependent task became ready and completes sequentially/inline.
  expect((await repo.run(['task-update', 'T003', 'in_progress'])).error).toBeUndefined();
  mkdirSync(join(repo.root, 'src'), { recursive: true });
  writeFileSync(join(repo.root, 'src', 'c.ts'), 'export const c = 3;\n');
  await completeInMainTree(repo, 'T003');
}

// Runs the same graph fully sequentially (no dispatch) for the structural
// equivalence comparison.
async function runSequentialLifecycle(repo: Repo): Promise<void> {
  for (const [id, rel, content] of [
    ['T001', 'src/a.ts', 'export const a = 1;\n'],
    ['T002', 'src/b.ts', 'export const b = 2;\n'],
    ['T003', 'src/c.ts', 'export const c = 3;\n'],
  ] as const) {
    expect((await repo.run(['task-update', id, 'in_progress'])).error).toBeUndefined();
    mkdirSync(join(repo.root, 'src'), { recursive: true });
    writeFileSync(join(repo.root, rel), content);
    await completeInMainTree(repo, id);
  }
}

interface StructuralState {
  tasks: Array<{
    id: string;
    status: string;
    attempts: number | null;
    hasResult: boolean;
  }>;
}

function structuralState(root: string): StructuralState {
  return {
    tasks: loadTasks(root, 'M001').tasks.map((t) => ({
      id: t.id,
      status: t.status,
      attempts: t.attempts ?? null,
      hasResult: t.result !== null,
    })),
  };
}

describe('parallel worktrees lifecycle (M014/T009/AC009)', () => {
  it('full parallel lifecycle: atomic per-task commits in integration order, no merges, no surviving scaffolding, state structurally equal to sequential', async () => {
    const parallel = await makeRepo({ execution: 'parallel_worktrees' });
    await runParallelLifecycle(parallel);

    // Mainline history: exactly init + init-assets? -> count commits after
    // the baseline: baseline + 3 task commits, in integration order.
    const messages = git(['log', '--format=%s%n%b%n==', parallel.root], parallel.root)
      .split('==')
      .map((m) => m.trim())
      .filter((m) => m.length > 0);
    const taskTrailers = messages
      .map((m) => /PitWay-Task: (T\d{3})/.exec(m)?.[1])
      .filter((t): t is string => t !== undefined);
    // git log is newest-first; integration order was T001, T002, then T003.
    expect(taskTrailers).toEqual(['T003', 'T002', 'T001']);

    // No merge commits anywhere.
    expect(git(['rev-list', '--merges', 'HEAD'], parallel.root).trim()).toBe('');

    // No surviving scaffolding branches or worktree entries.
    expect(git(['branch', '--list', 'pitway/task/*'], parallel.root).trim()).toBe('');
    expect(existsSync(join(parallel.root, WORKTREES_DIR, 'M001-T001'))).toBe(false);
    expect(existsSync(join(parallel.root, WORKTREES_DIR, 'M001-T002'))).toBe(false);

    // Every task completed with the integrated content present.
    for (const rel of ['src/a.ts', 'src/b.ts', 'src/c.ts']) {
      expect(existsSync(join(parallel.root, rel))).toBe(true);
    }

    // Structural equivalence to sequential execution: statuses, attempts,
    // results-present -- never byte equality (evidence embeds timings).
    const sequential = await makeRepo({});
    await runSequentialLifecycle(sequential);
    expect(structuralState(parallel.root)).toEqual(structuralState(sequential.root));
  }, 60000);

  it('conflict path: an out-of-scope worker commit is refused at integrate, main tree byte-identical, worktree preserved', async () => {
    const repo = await makeRepo({ execution: 'parallel_worktrees' });
    expect((await repo.run(['task-dispatch', 'T001'])).error).toBeUndefined();
    const worktree = dispatchWorktreePath(repo.root, 'T001');
    workerCommit(worktree, 'src/a.ts', 'ok\n');
    workerCommit(worktree, 'src/evil.ts', 'outside scope\n');

    const before = git(['status', '--porcelain'], repo.root);
    const result = await repo.run(['task-integrate', 'T001']);
    expect(result.error?.message).toContain('src/evil.ts');
    expect(git(['status', '--porcelain'], repo.root)).toBe(before);
    expect(existsSync(worktree)).toBe(true);
    expect(loadTasks(repo.root, 'M001').tasks.find((t) => t.id === 'T001')?.status).toBe(
      'in_progress',
    );
  });

  it('branch_strategy: milestone interaction: worktrees branch from the milestone branch, completions land there, base branch untouched', async () => {
    const repo = await makeRepo({ execution: 'parallel_worktrees', branch: 'milestone' });
    const milestoneBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'], repo.root).trim();
    expect(milestoneBranch).toMatch(/^pitway\/M001-/);
    const baseBranch = loadContract(repo.root, 'M001').frontmatter.base_branch!;
    const baseBranchSha = git(['rev-parse', baseBranch], repo.root).trim();

    expect((await repo.run(['task-dispatch', 'T001'])).error).toBeUndefined();
    const worktree = dispatchWorktreePath(repo.root, 'T001');
    // The worktree branched from the milestone branch's HEAD.
    expect(git(['merge-base', 'HEAD', 'pitway/task/M001-T001'], repo.root).trim()).toBe(
      git(['rev-parse', 'HEAD'], repo.root).trim(),
    );

    workerCommit(worktree, 'src/a.ts', 'export const a = 1;\n');
    expect((await repo.run(['task-integrate', 'T001'])).error).toBeUndefined();
    await completeInMainTree(repo, 'T001');

    // Completion landed on the milestone branch (assertOnMilestoneBranch
    // held); the base branch is untouched.
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], repo.root).trim()).toBe(milestoneBranch);
    expect(git(['log', '-1', '--format=%B', milestoneBranch], repo.root)).toContain(
      'PitWay-Task: T001',
    );
    expect(git(['rev-parse', baseBranch], repo.root).trim()).toBe(baseBranchSha);
  }, 30000);
});
