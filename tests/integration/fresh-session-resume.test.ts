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
import { registerResumeCommand } from '../../src/cli/commands/resume.js';
import { registerMilestoneStatusCommand } from '../../src/cli/commands/milestone-status.js';
import { registerTaskStatusCommand } from '../../src/cli/commands/task-status.js';
import { loadContract, loadState, loadTasks } from '../../src/state/store.js';

// M007/T001/AC001: fresh-session state reconstruction, formalized as a
// regression test (the 2026-08-18 demonstration was historical/manual only).
//
// This repository has no build step yet (M008 is where that lands — see
// M004/T007's finding that Node's native TS loader cannot remap this repo's
// `.js` import specifiers to `.ts` sources, so spawning a real second `node`
// process against the CLI's own entry point is not possible today). The
// strongest proof available without that build step is what this test does:
// every state-reading call below constructs a brand-new `buildCli()` program
// and a brand-new `deps` object, sharing nothing with whatever call created
// the state except the plain `root` path string (exactly what a real second
// process would be handed as its cwd argument) -- so each read genuinely
// reconstructs its view by loading `.pitway/` from disk, not by reusing any
// object, cache, or variable a prior call happened to build.

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

const CONTRACT_FIXTURE = `---
schema_version: 1
id: M001
title: Fresh session resume fixture
status: draft
requirement: null
confirmed_at: null
verification_approved_hash: null
acceptance_criteria:
  - id: AC001
    text: The scenario holds end to end.
verification:
  - id: CT001
    criterion: AC001
    type: command
    command: npm test
---

# Contract

## Objective

Prove fresh-session resume works from \`.pitway/\` alone.

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
      - src/greeter.ts
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
      - src/farewell.ts
    verification:
      strategy: tdd
      detail: npm test
    result: null
    usage: null
`;

const RESULT_FIXTURE = `summary: Implemented the greeter.
evidence: npm test passed
`;

const MESSAGE_FIXTURE = `task: complete T001

Implemented the greeter.
`;

// A fresh program + fresh deps every call -- nothing carried over except the
// plain root path, mirroring what a genuinely new process invocation would
// receive.
async function run(args: string[], cwd: string): Promise<{ lines: string[]; error?: Error }> {
  const program = buildCli();
  const lines: string[] = [];
  const deps = { root: cwd, write: (s: string) => lines.push(s) };
  registerInitCommand(program, deps);
  registerMilestoneAddCommand(program, deps);
  registerMilestoneConfirmCommand(program, deps);
  registerTaskUpdateCommand(program, deps);
  registerResumeCommand(program, deps);
  registerMilestoneStatusCommand(program, deps);
  registerTaskStatusCommand(program, deps);
  try {
    await program.parseAsync(['node', 'pitway', ...args]);
    return { lines };
  } catch (error) {
    return { lines, error: error as Error };
  }
}

function makeRepo(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  git(['init', '-q'], dir);
  git(['config', 'user.email', 'test@example.com'], dir);
  git(['config', 'user.name', 'Test'], dir);
  writeFileSync(join(dir, 'README.md'), 'seed\n');
  git(['add', 'README.md'], dir);
  git(['commit', '-q', '-m', 'init'], dir);
  return dir;
}

let scratch: string;
let root: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'pitway-fsr-in-'));
  root = makeRepo('pitway-fsr-');
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

describe('fresh-session resume (M007/T001/AC001)', () => {
  it('reconstructs a confirmed milestone with a completed task from .pitway/ alone', async () => {
    // --- Set-up phase: build real state via real commands and real commits.
    expect((await run(['init'], root)).error).toBeUndefined();

    const contract = join(scratch, 'draft-contract.md');
    const tasks = join(scratch, 'draft-tasks.yaml');
    writeFileSync(contract, CONTRACT_FIXTURE);
    writeFileSync(tasks, TASKS_FIXTURE);
    expect(
      (await run(['milestone-add', '--contract', contract, '--tasks', tasks], root)).error,
    ).toBeUndefined();
    expect((await run(['milestone-confirm', 'M001'], root)).error).toBeUndefined();
    expect((await run(['task-update', 'T001', 'in_progress'], root)).error).toBeUndefined();

    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'greeter.ts'), 'export const greet = (): string => "hi";\n');
    expect((await run(['task-update', 'T001', 'review'], root)).error).toBeUndefined();

    const result = join(scratch, 'result.yaml');
    const message = join(scratch, 'message.txt');
    writeFileSync(result, RESULT_FIXTURE);
    writeFileSync(message, MESSAGE_FIXTURE);
    expect(
      (
        await run(
          ['task-update', 'T001', 'completed', '--result', result, '--message', message],
          root,
        )
      ).error,
    ).toBeUndefined();

    // Working tree must be fully clean -- proof no state lives outside
    // committed/tracked `.pitway/` files that a fresh checkout would miss.
    expect(git(['status', '--porcelain'], root).trim()).toBe('');

    // --- Fresh-session phase: three independent, freshly-constructed reads,
    // none sharing any object with the set-up phase or with each other.
    const resumed = await run(['resume', '--json'], root);
    expect(resumed.error).toBeUndefined();
    const resumeView = JSON.parse(resumed.lines[0]!) as {
      activeMilestone: string;
      contractStatus: string;
      tasks: Array<{ id: string; status: string }>;
      ready: string[];
      nextTask: string | null;
    };
    expect(resumeView.activeMilestone).toBe('M001');
    expect(resumeView.contractStatus).toBe('in_progress');
    expect(resumeView.tasks).toEqual([
      { id: 'T001', status: 'completed' },
      { id: 'T002', status: 'ready' },
    ]);
    expect(resumeView.ready).toEqual(['T002']);
    expect(resumeView.nextTask).toBe('T002');

    const milestoneStatus = await run(['milestone-status', 'M001', '--json'], root);
    expect(milestoneStatus.error).toBeUndefined();
    const msView = JSON.parse(milestoneStatus.lines[0]!) as {
      id: string;
      status: string;
      progress: { completed: number; total: number };
      tasks: Array<{ id: string; status: string }>;
    };
    expect(msView.id).toBe('M001');
    expect(msView.status).toBe('in_progress');
    expect(msView.progress).toEqual({ completed: 1, total: 2 });
    expect(msView.tasks).toEqual([
      { id: 'T001', status: 'completed' },
      { id: 'T002', status: 'ready' },
    ]);

    const taskStatusT001 = await run(['task-status', 'T001', '--json'], root);
    expect(taskStatusT001.error).toBeUndefined();
    const t001View = JSON.parse(taskStatusT001.lines[0]!) as {
      id: string;
      status: string;
      result: { summary: string; evidence: string } | null;
    };
    expect(t001View.id).toBe('T001');
    expect(t001View.status).toBe('completed');
    expect(t001View.result).toEqual({
      summary: 'Implemented the greeter.',
      evidence: 'npm test passed',
    });

    const taskStatusT002 = await run(['task-status', 'T002', '--json'], root);
    expect(taskStatusT002.error).toBeUndefined();
    const t002View = JSON.parse(taskStatusT002.lines[0]!) as { id: string; status: string };
    expect(t002View.id).toBe('T002');
    expect(t002View.status).toBe('ready');

    // Cross-check every fresh CLI view against an independent, equally fresh
    // direct load of the same on-disk files -- two different code paths
    // (CLI view-builders and raw state-store loaders) agreeing proves the
    // reconstruction is disk-driven, not an artifact of one call path's own
    // internal caching (there is none, but this makes that explicit).
    const state = loadState(root);
    expect(state.active_milestone).toBe('M001');
    const diskContract = loadContract(root, 'M001');
    expect(diskContract.frontmatter.status).toBe('in_progress');
    const diskTasks = loadTasks(root, 'M001');
    expect(diskTasks.tasks.map((t) => ({ id: t.id, status: t.status }))).toEqual([
      { id: 'T001', status: 'completed' },
      { id: 'T002', status: 'ready' },
    ]);
  });
});
