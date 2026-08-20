import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCli, registerAllCommands } from '../../src/cli/index.js';
import { createTaskWorktree } from '../../src/git/worktree.js';
import { WorktreeGuardError } from '../../src/cli/worktree-guard.js';

// AC005/T005 (M014): fail-closed default-deny -- every command refuses
// inside a task worktree except the read-only allowlist; verify is
// flag-aware. Registered through registerAllCommands so the guard covers
// commands structurally, exactly as production wiring does.

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

const CONTRACT_FIXTURE = `---
schema_version: 1
id: M999
title: Guarded milestone
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
    context_files:
      - src/a.ts
    write_scope:
      - src/a.ts
    verification:
      strategy: tdd
      detail: npm test
    result: null
    usage: null
`;

let root: string;
let scratch: string;
let worktree: string;

async function runAt(cwd: string, args: string[]): Promise<{ lines: string[]; error?: Error }> {
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

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'pitway-guard-'));
  scratch = mkdtempSync(join(tmpdir(), 'pitway-guard-in-'));
  git(['init', '-q'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  writeFileSync(join(root, 'README.md'), 'seed\n');
  git(['add', 'README.md'], root);
  git(['commit', '-q', '-m', 'init'], root);
  await runAt(root, ['init', '--no-claude']);
  const contract = join(scratch, 'contract.md');
  const tasks = join(scratch, 'tasks.yaml');
  writeFileSync(contract, CONTRACT_FIXTURE);
  writeFileSync(tasks, TASKS_FIXTURE);
  expect((await runAt(root, ['milestone-add', '--contract', contract, '--tasks', tasks])).error).toBeUndefined();
  expect((await runAt(root, ['milestone-confirm', 'M001'])).error).toBeUndefined();
  worktree = createTaskWorktree(root, 'M001', 'T001').path;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

describe('worktree state guard (M014/T005)', () => {
  it('refuses task-update inside the worktree, naming task and authoritative root', async () => {
    const result = await runAt(worktree, ['task-update', 'T001', 'in_progress']);
    expect(result.error).toBeInstanceOf(WorktreeGuardError);
    expect(result.error?.message).toContain('M001/T001');
    expect(result.error?.message).toContain('task-update');
  });

  it('refuses task-verify inside the worktree', async () => {
    const result = await runAt(worktree, ['task-verify', 'T001']);
    expect(result.error).toBeInstanceOf(WorktreeGuardError);
  });

  it('refuses milestone-complete inside the worktree', async () => {
    const result = await runAt(worktree, ['milestone-complete', 'M001']);
    expect(result.error).toBeInstanceOf(WorktreeGuardError);
  });

  it('refuses a never-enumerated command (init) -- default-deny covers it structurally', async () => {
    const result = await runAt(worktree, ['init', '--no-claude']);
    expect(result.error).toBeInstanceOf(WorktreeGuardError);
  });

  it('refuses bare verify (it executes commands) but permits verify --status', async () => {
    const bare = await runAt(worktree, ['verify', 'M001']);
    expect(bare.error).toBeInstanceOf(WorktreeGuardError);

    const status = await runAt(worktree, ['verify', 'M001', '--status']);
    expect(status.error).toBeUndefined();
    expect(status.lines.join('\n')).toContain('CT001');
  });

  it('permits task-status --context and resume inside the worktree (stale, read-only convenience)', async () => {
    const context = await runAt(worktree, ['task-status', 'T001', '--context']);
    expect(context.error).toBeUndefined();

    const resume = await runAt(worktree, ['resume']);
    expect(resume.error).toBeUndefined();
  });

  it('leaves every command unchanged in the main repository root', async () => {
    const update = await runAt(root, ['task-update', 'T001', 'in_progress']);
    expect(update.error).toBeUndefined();

    const resume = await runAt(root, ['resume']);
    expect(resume.error).toBeUndefined();
  });
});
