import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCli } from '../../src/cli/index.js';
import { registerInitCommand } from '../../src/cli/commands/init.js';
import { registerMilestoneAddCommand } from '../../src/cli/commands/milestone-add.js';
import { registerMilestoneConfirmCommand } from '../../src/cli/commands/milestone-confirm.js';
import { registerTaskUpdateCommand } from '../../src/cli/commands/task-update.js';
import { loadConfig, loadTasks, saveConfig } from '../../src/state/store.js';

// AC001/T001 (M014): the sequential path is byte-identical whether the
// execution block is absent (every pre-M014 config.yaml) or explicitly
// `sequential` -- the same full task lifecycle produces the same commits,
// state, and output either way.

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

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
`;

const RESULT_FIXTURE = `summary: Implemented the thing.
evidence: npm test passed
`;

interface LifecycleOutcome {
  lines: string[];
  commitMessages: string[];
  commitFiles: string[][];
  taskStatus: string;
}

let roots: string[];
let scratch: string;

beforeEach(() => {
  roots = [];
  scratch = mkdtempSync(join(tmpdir(), 'pitway-exec-in-'));
});

afterEach(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

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

// Runs one full lifecycle (init -> add -> confirm -> in_progress -> review ->
// completed with atomic commit) and captures every observable outcome.
async function runLifecycle(explicitSequential: boolean): Promise<LifecycleOutcome> {
  const root = mkdtempSync(join(tmpdir(), 'pitway-exec-'));
  roots.push(root);
  git(['init', '-q'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  writeFileSync(join(root, 'README.md'), 'seed\n');
  git(['add', 'README.md'], root);
  git(['commit', '-q', '-m', 'init'], root);
  await run(['init', '--no-claude'], root);

  if (explicitSequential) {
    const config = loadConfig(root);
    saveConfig(root, { ...config, execution: { strategy: 'sequential' } });
  }

  const contract = join(scratch, 'draft-contract.md');
  const tasks = join(scratch, 'draft-tasks.yaml');
  writeFileSync(contract, CONTRACT_FIXTURE);
  writeFileSync(tasks, TASKS_FIXTURE);
  const lines: string[] = [];
  const collect = async (args: string[]): Promise<void> => {
    const result = await run(args, root);
    expect(result.error).toBeUndefined();
    lines.push(...result.lines);
  };
  await collect(['milestone-add', '--contract', contract, '--tasks', tasks]);
  await collect(['milestone-confirm', 'M001']);
  await collect(['task-update', 'T001', 'in_progress']);
  await collect(['task-update', 'T001', 'review']);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1;\n');
  const result = join(scratch, 'result.yaml');
  const message = join(scratch, 'message.txt');
  writeFileSync(result, RESULT_FIXTURE);
  writeFileSync(message, 'task: complete T001\n');
  await collect(['task-update', 'T001', 'completed', '--result', result, '--message', message]);

  const commitMessages = git(['log', '--format=%B%x00'], root)
    .split('\0')
    .map((m) => m.trim())
    .filter((m) => m.length > 0);
  const commitFiles = commitMessages.map((_, i) =>
    git(['show', '--name-only', '--format=', `HEAD~${i}`], root)
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .sort(),
  );
  const status = loadTasks(root, 'M001').tasks[0]!.status;
  return { lines, commitMessages, commitFiles, taskStatus: status };
}

describe('execution strategy sequential default (M014/T001)', () => {
  it('full lifecycle outcomes are identical with the execution block absent vs explicitly sequential', async () => {
    const absent = await runLifecycle(false);
    const explicit = await runLifecycle(true);

    expect(absent.taskStatus).toBe('completed');
    expect(explicit.taskStatus).toBe('completed');
    expect(explicit.commitMessages).toEqual(absent.commitMessages);
    expect(explicit.commitFiles).toEqual(absent.commitFiles);
    // Output lines embed repo-specific commit SHAs; identical up to those.
    const normalize = (lines: string[]): string[] =>
      lines.map((l) => l.replace(/[0-9a-f]{40}/g, '<sha>'));
    expect(normalize(explicit.lines)).toEqual(normalize(absent.lines));
  });

  it('a config.yaml carrying the execution block round-trips through load/save unchanged', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pitway-exec-'));
    roots.push(root);
    git(['init', '-q'], root);
    git(['config', 'user.email', 'test@example.com'], root);
    git(['config', 'user.name', 'Test'], root);
    writeFileSync(join(root, 'README.md'), 'seed\n');
    git(['add', 'README.md'], root);
    git(['commit', '-q', '-m', 'init'], root);
    await run(['init', '--no-claude'], root);

    const config = loadConfig(root);
    expect(config.execution).toBeUndefined();
    saveConfig(root, { ...config, execution: { strategy: 'parallel_worktrees' } });
    expect(loadConfig(root).execution?.strategy).toBe('parallel_worktrees');
  });
});
