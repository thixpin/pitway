import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCli } from '../../src/cli/index.js';
import { registerInitCommand } from '../../src/cli/commands/init.js';
import { registerMilestoneAddCommand } from '../../src/cli/commands/milestone-add.js';
import { registerMilestoneConfirmCommand } from '../../src/cli/commands/milestone-confirm.js';
import { registerTaskUpdateCommand } from '../../src/cli/commands/task-update.js';
import { registerTaskVerifyCommand } from '../../src/cli/commands/task-verify.js';
import { loadContract, loadTasks, loadState, saveState, saveContract, saveTasks } from '../../src/state/store.js';
import { runTaskVerify } from '../../src/core/tasks/verify.js';
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
  - id: T003
    objective: Task whose command reports a passCount-only summary line.
    status: planned
    depends_on: []
    acceptance_criteria:
      - It works
    write_scope:
      - src/c.ts
    verification:
      strategy: command
      detail: "node -e \\"console.log('Tests  3 passed (3)'); process.exit(0)\\""
    result: null
    usage: null
  - id: T004
    objective: Task whose command reports a failCount-only summary line and fails.
    status: planned
    depends_on: []
    acceptance_criteria:
      - It works
    write_scope:
      - src/d.ts
    verification:
      strategy: command
      detail: "node -e \\"console.log('Tests  2 failed (2)'); process.exit(1)\\""
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

// Human-format (non --json) invocation -- the only path that renders
// through renderTaskVerifyHuman's icon/counts/typecheck branches.
async function taskVerifyHuman(args: string[]): Promise<{ lines: string[]; error?: Error }> {
  return run(['task-verify', ...args], root);
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

// M017/T004 (AC004): integration proof that a real failing task-verify
// command's recorded evidence names the failing test -- own root/fixture
// since the shared TASKS_FIXTURE's T001 command always passes.
describe('pitway task-verify records a failure summary in evidence (AC004)', () => {
  const FAILING_TASKS_FIXTURE = `schema_version: 1
tasks:
  - id: T001
    objective: A task whose verification command fails.
    status: planned
    depends_on: []
    acceptance_criteria:
      - It works
    write_scope:
      - src/a.ts
    verification:
      strategy: command
      detail: "node -e \\"console.log('FAIL src/a.test.ts > it works'); process.exit(1)\\""
    result: null
    usage: null
`;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'pitway-tver-fail-'));
    scratch = mkdtempSync(join(tmpdir(), 'pitway-tver-fail-in-'));
    git(['init', '-q'], root);
    git(['config', 'user.email', 'test@example.com'], root);
    git(['config', 'user.name', 'Test'], root);
    writeFileSync(join(root, 'README.md'), 'seed\n');
    git(['add', 'README.md'], root);
    git(['commit', '-q', '-m', 'init'], root);
    await run(['init', '--no-claude'], root);
    const contract = join(root, 'draft-contract.md');
    const tasksFile = join(root, 'draft-tasks.yaml');
    writeFileSync(contract, CONTRACT_FIXTURE);
    writeFileSync(tasksFile, FAILING_TASKS_FIXTURE);
    const added = await run(['milestone-add', '--contract', contract, '--tasks', tasksFile], root);
    expect(added.error).toBeUndefined();
    rmSync(contract);
    rmSync(tasksFile);
    const confirmed = await run(['milestone-confirm', 'M001'], root);
    expect(confirmed.error).toBeUndefined();
  });

  it("prefixes the recorded evidence with a failures: summary naming the failing test", async () => {
    expect((await update(['T001', 'in_progress'])).error).toBeUndefined();
    touchFile('src/a.ts', 'export const a = 1;\n');

    const verified = await taskVerify(['T001']);
    expect(verified.error).toBeUndefined();
    const evidence = JSON.parse(verified.lines[0]!) as JournalTaskVerifyEvidence;
    expect(evidence.exitCode).toBe(1);
    expect(evidence.evidence.startsWith('failures: FAIL src/a.test.ts > it works\n')).toBe(true);
    expect(evidence.evidence).toContain('FAIL src/a.test.ts > it works');
  });
});

// M020/T002 (AC003): renderTaskVerifyHuman's own branches only render on the
// human (non --json) output path -- these cases drive each real permutation
// (pass/fail icon, counts present/absent/partial, typecheck present/absent)
// through the real CLI, never by importing the unexported renderer directly.
describe('pitway task-verify human-readable rendering (renderTaskVerifyHuman branches)', () => {
  it('renders a passing icon with no counts and no typecheck note', async () => {
    await update(['T001', 'in_progress']);
    touchFile('src/a.ts', 'export const a = 1;\n');

    const { error, lines } = await taskVerifyHuman(['T001']);
    expect(error).toBeUndefined();
    expect(lines[0]).toMatch(/✅ pass/);
    expect(lines[0]).not.toMatch(/passed,/);
    expect(lines[0]).not.toContain('typecheck');
  });

  it('renders a passCount-only summary on a passing run', async () => {
    await update(['T003', 'in_progress']);
    touchFile('src/c.ts', 'export const c = 1;\n');

    const { error, lines } = await taskVerifyHuman(['T003']);
    expect(error).toBeUndefined();
    expect(lines[0]).toMatch(/✅ pass/);
    expect(lines[0]).toContain('(3 passed, 0 failed)');
  });

  it('renders a failCount-only summary on a failing run', async () => {
    await update(['T004', 'in_progress']);
    touchFile('src/d.ts', 'export const d = 1;\n');

    const { error, lines } = await taskVerifyHuman(['T004']);
    expect(error).toBeUndefined();
    expect(lines[0]).toMatch(/❌ fail/);
    expect(lines[0]).toContain('(0 passed, 2 failed)');
  });

  it('appends a typecheck note, passing or failing, alongside the run result', async () => {
    await update(['T001', 'in_progress']);
    touchFile('src/a.ts', 'export const a = 1;\n');

    const passing = await taskVerifyHuman(['T001', '--typecheck', 'node -e "process.exit(0)"']);
    expect(passing.error).toBeUndefined();
    expect(passing.lines[0]).toMatch(/typecheck ✅ pass/);

    const failing = await taskVerifyHuman(['T001', '--typecheck', 'node -e "process.exit(1)"']);
    expect(failing.error).toBeUndefined();
    expect(failing.lines[0]).toMatch(/typecheck ❌ fail/);
  });
});

// M020/T002 (AC003): registerTaskVerifyCommand's own CommandDeps defaults
// (deps.write ?? console.log, deps.root ?? process.cwd()) are only reached
// when a caller registers the command with no overrides at all -- the real
// shape a bare `pitway task-verify` invocation takes outside this test
// file's harness. process.chdir into the fixture root keeps this from ever
// touching the real repository's own .pitway/ state.
describe('pitway task-verify default CommandDeps fallbacks', () => {
  it('falls back to console.log and process.cwd() when no overrides are given', async () => {
    await update(['T001', 'in_progress']);
    touchFile('src/a.ts', 'export const a = 1;\n');

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cwdBefore = process.cwd();
    process.chdir(root);
    let caught: unknown;
    let calls: unknown[][] = [];
    try {
      const program = buildCli();
      registerTaskVerifyCommand(program);
      await program.parseAsync(['node', 'pitway', 'task-verify', 'T001']);
    } catch (error) {
      caught = error;
    } finally {
      calls = logSpy.mock.calls;
      process.chdir(cwdBefore);
      logSpy.mockRestore();
    }

    expect(caught).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toMatch(/✅ pass/);
  });
});

// M024/T005 gate widening: the guard and diagnostic branches the full-suite
// coverage run exposed -- each a real behavioral case, no production change.
describe('pitway task-verify guard and diagnostic branches (M024/T005)', () => {
  it('refuses with no active milestone', () => {
    saveState(root, { ...loadState(root), active_milestone: null });
    expect(() => runTaskVerify(root, 'T001')).toThrow(
      /no active milestone; run milestone-add first/,
    );
  });

  it('refuses an unknown task id', () => {
    expect(() => runTaskVerify(root, 'NOPE')).toThrow(/task NOPE not found/);
  });

  it('refuses a declared path resolving outside the repository', async () => {
    const tasksFile = loadTasks(root, 'M001');
    const t = tasksFile.tasks.find((x) => x.id === 'T001');
    t!.write_scope = ['../outside/a.ts'];
    saveTasks(root, 'M001', tasksFile);
    await update(['T001', 'in_progress']);
    expect(() => runTaskVerify(root, 'T001')).toThrow(/resolves outside the repository/);
  });

  it('refuses when git check-ignore fails outright (root is not a repository)', () => {
    // A plain directory with valid .pitway state but no git repo: every
    // earlier guard passes, then check-ignore exits non-0/1 and the verify
    // engine must surface that as its own diagnostic.
    const bare = mkdtempSync(join(tmpdir(), 'pitway-tver-nogit-'));
    try {
      mkdirSync(join(bare, '.pitway', 'milestones', 'M001'), { recursive: true });
      saveState(bare, { schema_version: 1, active_milestone: 'M001', milestones: ['M001'] });
      saveContract(bare, 'M001', loadContract(root, 'M001'));
      const tasksFile = loadTasks(root, 'M001');
      tasksFile.tasks.find((x) => x.id === 'T001')!.status = 'in_progress';
      saveTasks(bare, 'M001', tasksFile);
      expect(() => runTaskVerify(bare, 'T001')).toThrow(/git check-ignore failed/);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it('names modified unexpected dirt in the refusal diagnostic', async () => {
    await update(['T001', 'in_progress']);
    writeFileSync(join(root, 'README.md'), 'dirtied\n');
    try {
      expect(() => runTaskVerify(root, 'T001')).toThrow(/unrelated dirty changes.*\(modified\)/s);
    } finally {
      git(['checkout', '--', 'README.md'], root);
    }
  });

  it('names deleted unexpected dirt in the refusal diagnostic', async () => {
    await update(['T001', 'in_progress']);
    rmSync(join(root, 'README.md'));
    try {
      expect(() => runTaskVerify(root, 'T001')).toThrow(/unrelated dirty changes.*\(deleted\)/s);
    } finally {
      git(['checkout', '--', 'README.md'], root);
    }
  });

  it('names staged-added unexpected dirt in the refusal diagnostic', async () => {
    await update(['T001', 'in_progress']);
    touchFile('stray-added.ts', 'x\n');
    git(['add', 'stray-added.ts'], root);
    try {
      expect(() => runTaskVerify(root, 'T001')).toThrow(/unrelated dirty changes.*\(added\)/s);
    } finally {
      git(['rm', '-q', '--cached', 'stray-added.ts'], root);
      rmSync(join(root, 'stray-added.ts'));
    }
  });

  it('names staged-renamed unexpected dirt in the refusal diagnostic', async () => {
    await update(['T001', 'in_progress']);
    git(['mv', 'README.md', 'RENAMED.md'], root);
    try {
      expect(() => runTaskVerify(root, 'T001')).toThrow(/unrelated dirty changes.*\(renamed\)/s);
    } finally {
      git(['mv', 'RENAMED.md', 'README.md'], root);
    }
  });

  it('records the task\'s real attempts count in the evidence record', async () => {
    const tasksFile = loadTasks(root, 'M001');
    const t = tasksFile.tasks.find((x) => x.id === 'T003');
    t!.attempts = 2;
    saveTasks(root, 'M001', tasksFile);
    await update(['T003', 'in_progress']);
    const expectedAttempts = loadTasks(root, 'M001').tasks.find((x) => x.id === 'T003')!.attempts;

    const view = runTaskVerify(root, 'T003');
    expect(view.exitCode).toBe(0);
    expect(expectedAttempts).not.toBeNull();
    expect(view.attempts).toBe(expectedAttempts);
  });
});
