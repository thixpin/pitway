import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCli } from '../../src/cli/index.js';
import { registerBacklogCommand } from '../../src/cli/commands/backlog.js';
import { registerInitCommand } from '../../src/cli/commands/init.js';
import { registerMilestoneAddCommand } from '../../src/cli/commands/milestone-add.js';
import { registerMilestoneConfirmCommand } from '../../src/cli/commands/milestone-confirm.js';
import { registerTaskUpdateCommand } from '../../src/cli/commands/task-update.js';
import { registerResumeCommand } from '../../src/cli/commands/resume.js';
import { registerMilestoneStatusCommand } from '../../src/cli/commands/milestone-status.js';
import { registerTaskStatusCommand } from '../../src/cli/commands/task-status.js';
import { loadConfig, loadContract, loadState, loadTasks, saveConfig, saveReviews } from '../../src/state/store.js';
import { appendJournalEntry } from '../../src/state/journal.js';
import { dispatchTask } from '../../src/core/tasks/dispatch.js';

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
  registerBacklogCommand(program, deps);
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

    // M018/T004: a backlog item added mid-task, riding along in T001's own
    // completion commit below (AC005) -- proves pendingBacklogItems survives
    // a fresh, independently-constructed resume read, same discipline as
    // every other field this test proves.
    expect(
      (await run(['backlog', 'add', '--title', 'Discovered mid-task', '--reason', 'Out of scope.'], root))
        .error,
    ).toBeUndefined();

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
      tasks: Array<{ id: string; name: string | null; status: string }>;
      ready: string[];
      nextTask: string | null;
      pendingBacklogItems: Array<{ id: string; title: string }>;
    };
    expect(resumeView.activeMilestone).toBe('M001');
    expect(resumeView.contractStatus).toBe('in_progress');
    // M013/AC002: resume's task list also carries an additive-optional
    // name field, null (id-fallback) for every task in this fixture.
    expect(resumeView.tasks).toEqual([
      { id: 'T001', name: null, status: 'completed' },
      { id: 'T002', name: null, status: 'ready' },
    ]);
    expect(resumeView.ready).toEqual(['T002']);
    expect(resumeView.nextTask).toBe('T002');
    // M018/T004: the backlog item added mid-task above, folded into T001's
    // own completion commit, still reads back correctly from a fresh process.
    expect(resumeView.pendingBacklogItems).toEqual([{ id: 'B001', title: 'Discovered mid-task' }]);

    const milestoneStatus = await run(['milestone-status', 'M001', '--json'], root);
    expect(milestoneStatus.error).toBeUndefined();
    const msView = JSON.parse(milestoneStatus.lines[0]!) as {
      id: string;
      status: string;
      progress: { completed: number; total: number };
      tasks: Array<{
        id: string;
        label: string;
        executionMode: 'inline' | 'worktree' | null;
        statusLabel: string;
        tokens: number | null;
      }>;
    };
    expect(msView.id).toBe('M001');
    expect(msView.status).toBe('in_progress');
    expect(msView.progress).toEqual({ completed: 1, total: 2 });
    expect(msView.tasks).toEqual([
      { id: 'T001', label: 'First task.', executionMode: 'inline', statusLabel: '✓ Completed', tokens: null },
      { id: 'T002', label: 'Second task.', executionMode: null, statusLabel: '◌ Ready', tokens: null },
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

// M044/T002 (AC002): Orchestrator restart recovery in the persistent-per-
// milestone identity mode (M040 Decision 2). A milestone mid-execution --
// one task in_progress, one dispatched under parallel_worktrees, one
// pending journal entry, one open review session -- must re-orient a
// brand-new process from `pitway resume` output ALONE to the exact next
// action protocol-orchestrator.md prescribes: continue the in_progress
// task. Modelled on M041's two real restarts (docs/evidence/M041/
// split-role-dogfood.md section 4). Every recovery input the assertion
// relies on is a named resume field.
const RECOVERY_CONTRACT = CONTRACT_FIXTURE.replace('Fresh session resume fixture', 'Orchestrator restart recovery fixture');
const RECOVERY_TASKS = `schema_version: 1
tasks:
  - id: T001
    name: Inline task
    objective: Runs inline in the main tree.
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
      detail: npm test
    result: null
    usage: null
  - id: T002
    name: Dispatched task
    objective: Runs in a worktree.
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
      detail: npm test
    result: null
    usage: null
  - id: T003
    name: Waiting task
    objective: Waits on T001.
    status: planned
    depends_on: [T001]
    acceptance_criteria:
      - It works
    context_files:
      - src/c.ts
    write_scope:
      - src/c.ts
    verification:
      strategy: command
      detail: npm test
    result: null
    usage: null
`;

describe('Orchestrator restart recovery from resume alone (M044/T002)', () => {
  it('re-orients a fresh process to the in_progress task while a dispatch, a pending journal entry, and an open review are all live', async () => {
    expect((await run(['init', '--no-claude'], root)).error).toBeUndefined();
    saveConfig(root, { ...loadConfig(root), execution: { strategy: 'parallel_worktrees' } });
    const contract = join(scratch, 'contract.md');
    const tasks = join(scratch, 'tasks.yaml');
    writeFileSync(contract, RECOVERY_CONTRACT);
    writeFileSync(tasks, RECOVERY_TASKS);
    expect((await run(['milestone-add', '--contract', contract, '--tasks', tasks], root)).error).toBeUndefined();
    expect((await run(['milestone-confirm', 'M001'], root)).error).toBeUndefined();

    // The Orchestrator's last actions before the "restart": start T001
    // inline, dispatch T002 to a worktree, record a pending usage entry
    // (immediate-write, no commit of its own), open a review session.
    expect((await run(['task-update', 'T001', 'in_progress'], root)).error).toBeUndefined();
    const dispatched = dispatchTask(root, 'T002');
    appendJournalEntry(root, {
      milestone: 'M001',
      type: 'usage_recording',
      operationId: 'op-usage-restart-1',
      payload: { category: 'planning', total_tokens: 1 },
    });
    saveReviews(root, 'M001', {
      schema_version: 1,
      sessions: [
        {
          id: 'rev-a1b2c3d4',
          status: 'open',
          created_at: '2026-08-29T00:00:00Z',
          roles: ['architect'],
          content_hash: `sha256:${'c'.repeat(64)}`,
          findings: [],
          decision: null,
        },
      ],
    });

    // Restart: a brand-new program + deps, sharing only the root path.
    const fresh = await run(['resume', '--json'], root);
    expect(fresh.error).toBeUndefined();
    const view = JSON.parse(fresh.lines.join('\n'));

    // Recovery inputs, each a named resume field:
    expect(view.activeMilestone).toBe('M001');                         // which milestone
    expect(view.contractStatus).toBe('in_progress');                   // its state
    expect(view.branch?.matches).toBe(true);                           // on the milestone branch
    // Both are in_progress; only the dispatch record (below) tells the
    // worktree task apart from the interrupted inline one.
    expect(view.inProgress).toEqual(['T001', 'T002']);
    expect(view.waiting).toEqual(['T003']);
    expect(view.waitingDetails).toEqual([{ id: 'T003', detail: 'waiting on T001' }]);
    expect(view.parallel.activeDispatches).toEqual([                   // the live worktree dispatch
      { taskId: 'T002', branch: 'pitway/task/M001-T002', worktreePath: dispatched.worktreePath },
    ]);
    // The interrupted inline task is NAMED as a residue: in_progress with no
    // dispatch record -- the exact signal a restarted Orchestrator reads.
    expect(view.parallel.residues).toEqual([
      expect.objectContaining({ class: 'inline-or-interrupted', taskId: 'T001' }),
    ]);
    expect(view.openReview).toMatchObject({ milestone: 'M001', sessionId: 'rev-a1b2c3d4', pendingCount: 1 });
    // The exact next action: continue T001 (in_progress beats ready).
    expect(view.nextTask).toBe('T001');

    // The pending journal entry never blocks re-orientation; resume tolerates
    // its dirt (M044/T001 audit gap G1: it is not LISTED -- asserted here so
    // a future additive field is a deliberate change, not drift).
    expect(view).not.toHaveProperty('pendingJournal');

    const human = await run(['resume'], root);
    const out = human.lines.join('\n');
    expect(out).toContain('Continue: T001');
    expect(out).toContain('🏎️ Dispatched worktrees');
    expect(out).toContain('📜 Open review rev-a1b2c3d4 (M001)');
    // No git mutation of any kind happened during re-orientation.
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], root).trim()).toBe(view.branch.expected);
    rmSync(dispatched.worktreePath, { recursive: true, force: true });
  });
});
