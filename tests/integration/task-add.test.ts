import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCli, registerAllCommands } from '../../src/cli/index.js';
import { registerTaskAddCommand } from '../../src/cli/commands/task-add.js';
import { derivePending } from '../../src/core/journal/operations.js';
import { readJournal, type JournalEntry } from '../../src/state/journal.js';
import { loadConfig, loadTasks, saveConfig } from '../../src/state/store.js';
import { WORKTREES_DIR } from '../../src/git/worktree.js';
import type { Task } from '../../src/state/schemas.js';

// M017/T002 (AC002): task-add inserts one new task into a confirmed or
// in_progress milestone. Its primary use is the parallel-dispatch corrective
// pattern -- discovered work landing mid-flight without a new milestone.

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

let root: string;
let scratch: string;

// milestone-add ignores this fixture's own `id:` field and assigns the next
// sequential id (M001 in a fresh repo) -- the M999 placeholder here is never
// what actually lands.
const CONTRACT_FIXTURE = `---
schema_version: 1
id: M999
title: Task-add milestone
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

- Initial milestone contract.
`;

// T001 independent, T002 depends on T001 (stays waiting after confirm), T003
// independent with a disjoint write_scope from T001/T002 (parallel-dispatch
// eligible). All context_files/write_scope style so a later added task can
// share the same scoping convention.
const TASKS_FIXTURE = `schema_version: 1
tasks:
  - id: T001
    name: First task
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
      strategy: command
      detail: node -e "console.log('1 passed')"
    result: null
    usage: null
  - id: T002
    name: Second task
    objective: Second task, depends on the first.
    status: planned
    depends_on: [T001]
    acceptance_criteria:
      - It also works
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
    name: Third task
    objective: Third task, independent, disjoint scope.
    status: planned
    depends_on: []
    acceptance_criteria:
      - It works too
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

async function run(args: string[], cwd: string): Promise<{ lines: string[]; error?: Error }> {
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

function taskDefinitionFile(fields: Record<string, unknown>): string {
  const path = join(scratch, `task-${Date.now()}-${Math.random().toString(36).slice(2)}.yaml`);
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  writeFileSync(path, `${lines.join('\n')}\n`);
  return path;
}

function newTaskFields(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'T004',
    name: 'Fourth task',
    objective: 'Fourth task, added after confirmation.',
    depends_on: [],
    acceptance_criteria: ['It works'],
    context_files: ['src/d.ts'],
    write_scope: ['src/d.ts'],
    verification: { strategy: 'command', detail: 'node -e "console.log(1)"' },
    ...overrides,
  };
}

async function addTaskCmd(
  fields: Record<string, unknown>,
  changeLog = 'Discovered mid-flight, added as follow-on work.',
  milestoneId = 'M001',
): Promise<{ lines: string[]; error?: Error }> {
  const file = taskDefinitionFile(fields);
  return run(['task-add', milestoneId, '--file', file, '--change-log', changeLog, '--json'], root);
}

const task = (id: string, milestoneId = 'M001'): Task => {
  const found = loadTasks(root, milestoneId).tasks.find((t) => t.id === id);
  if (!found) throw new Error(`missing task ${id}`);
  return found;
};

function pendingAddEntries(taskId?: string): JournalEntry[] {
  return derivePending(readJournal(root)).filter(
    (e) => e.type === 'task_amendment' && (taskId === undefined || e.target === taskId),
  );
}

const commitCount = (cwd: string): number => Number(git(['rev-list', '--count', 'HEAD'], cwd).trim());

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

// Direct fixture construction, bypassing every command -- the only way to
// observe draft/review/completed/cancelled milestone status (milestone-add,
// milestone-confirm, and milestone-complete each collapse a transient status
// into the next persisted one within a single write, per
// src/core/milestones/confirm.ts and complete.ts; 'review' in particular is
// never actually resting on disk through any current command path).
function writeRawMilestone(id: string, status: string): void {
  const dir = join(root, '.pitway', 'milestones', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'contract.md'),
    CONTRACT_FIXTURE.replace('id: M999', `id: ${id}`).replace('status: draft', `status: ${status}`),
  );
  writeFileSync(join(dir, 'tasks.yaml'), TASKS_FIXTURE);
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'pitway-tadd-'));
  scratch = mkdtempSync(join(tmpdir(), 'pitway-tadd-in-'));
  git(['init', '-q'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  writeFileSync(join(root, 'README.md'), 'seed\n');
  git(['add', 'README.md'], root);
  git(['commit', '-q', '-m', 'init'], root);
  await run(['init', '--no-claude'], root);
  await confirmedMilestone();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

describe('pitway task-add milestone-status refusals', () => {
  it('refuses a draft milestone, pointing at milestone-add --replace', async () => {
    writeRawMilestone('M002', 'draft');
    const { error } = await addTaskCmd(newTaskFields(), 'Evidence.', 'M002');
    expect(error?.message).toMatch(/draft/);
    expect(error?.message).toMatch(/milestone-add --replace/);
    expect(pendingAddEntries()).toHaveLength(0);
  });

  it('refuses a review-status milestone, pointing at verify / milestone-complete', async () => {
    writeRawMilestone('M002', 'review');
    const { error } = await addTaskCmd(newTaskFields(), 'Evidence.', 'M002');
    expect(error?.message).toMatch(/review/);
    expect(error?.message).toMatch(/verify/);
    expect(error?.message).toMatch(/milestone-complete/);
    expect(pendingAddEntries()).toHaveLength(0);
  });

  it('refuses a completed milestone', async () => {
    writeRawMilestone('M002', 'completed');
    const { error } = await addTaskCmd(newTaskFields(), 'Evidence.', 'M002');
    expect(error?.message).toMatch(/completed/);
    expect(pendingAddEntries()).toHaveLength(0);
  });

  it('refuses a cancelled milestone', async () => {
    writeRawMilestone('M002', 'cancelled');
    const { error } = await addTaskCmd(newTaskFields(), 'Evidence.', 'M002');
    expect(error?.message).toMatch(/cancelled/);
    expect(pendingAddEntries()).toHaveLength(0);
  });

  it('refuses when the contract has no Change Log heading at all', async () => {
    const dir = join(root, '.pitway', 'milestones', 'M002');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      dir + '/contract.md',
      CONTRACT_FIXTURE.replace('id: M999', 'id: M002')
        .replace('status: draft', 'status: in_progress')
        .replace('## Change Log\n\n- Initial milestone contract.\n', ''),
    );
    writeFileSync(dir + '/tasks.yaml', TASKS_FIXTURE);
    const { error } = await addTaskCmd(newTaskFields(), 'Evidence.', 'M002');
    expect(error?.message).toMatch(/Change Log/);
    expect(pendingAddEntries()).toHaveLength(0);
  });

  it('refuses when the Change Log heading is immediately followed by another heading (no entry text)', async () => {
    const dir = join(root, '.pitway', 'milestones', 'M002');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      dir + '/contract.md',
      CONTRACT_FIXTURE.replace('id: M999', 'id: M002')
        .replace('status: draft', 'status: in_progress')
        .replace(
          '## Change Log\n\n- Initial milestone contract.\n',
          '## Change Log\n\n## Appendix\n\n- Not a change log entry.\n',
        ),
    );
    writeFileSync(dir + '/tasks.yaml', TASKS_FIXTURE);
    const { error } = await addTaskCmd(newTaskFields(), 'Evidence.', 'M002');
    expect(error?.message).toMatch(/Change Log/);
    expect(pendingAddEntries()).toHaveLength(0);
  });

  it('refuses when the milestone has no recorded Change Log entry', async () => {
    const dir = join(root, '.pitway', 'milestones', 'M002');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      dir + '/contract.md',
      CONTRACT_FIXTURE.replace('id: M999', 'id: M002')
        .replace('status: draft', 'status: in_progress')
        .replace('## Change Log\n\n- Initial milestone contract.\n', '## Change Log\n'),
    );
    writeFileSync(dir + '/tasks.yaml', TASKS_FIXTURE);
    const { error } = await addTaskCmd(newTaskFields(), 'Evidence.', 'M002');
    expect(error?.message).toMatch(/Change Log/);
    expect(pendingAddEntries()).toHaveLength(0);
  });
});

describe('pitway task-add validation on a confirmed/in_progress milestone', () => {
  it('refuses blank --change-log evidence', async () => {
    const { error } = await addTaskCmd(newTaskFields(), '   ');
    expect(error?.message).toMatch(/--change-log/);
    expect(pendingAddEntries()).toHaveLength(0);
  });

  it('refuses missing --file at the CLI level', async () => {
    const { error } = await run(['task-add', 'M001', '--change-log', 'Evidence.'], root);
    expect(error?.message).toMatch(/--file/);
  });

  it('refuses missing --change-log at the CLI level', async () => {
    const file = taskDefinitionFile(newTaskFields());
    const { error } = await run(['task-add', 'M001', '--file', file], root);
    expect(error?.message).toMatch(/--change-log/);
  });

  it('refuses a missing or empty name', async () => {
    const fields = newTaskFields();
    delete fields.name;
    const { error } = await addTaskCmd(fields);
    expect(error?.message).toMatch(/name/);
    expect(pendingAddEntries()).toHaveLength(0);
  });

  it.each(['status', 'result', 'usage', 'attempts'])(
    'refuses an execution-only field (%s) present in the definition, naming it',
    async (field) => {
      const overrides: Record<string, unknown> = {
        status: 'ready',
        result: null,
        usage: null,
        attempts: 1,
      };
      const { error } = await addTaskCmd(newTaskFields({ [field]: overrides[field] }));
      expect(error?.message).toContain(field);
      expect(pendingAddEntries()).toHaveLength(0);
    },
  );

  it('refuses an unreadable definition file, wrapping the read error', async () => {
    const missing = join(scratch, 'does-not-exist.yaml');
    const { error } = await run(
      ['task-add', 'M001', '--file', missing, '--change-log', 'Evidence.', '--json'],
      root,
    );
    expect(error?.message).toMatch(/task definition/);
    expect(pendingAddEntries()).toHaveLength(0);
  });

  it('refuses malformed YAML in the definition file, naming the file', async () => {
    const bad = join(scratch, 'bad.yaml');
    writeFileSync(bad, 'id: T004\n  broken:\n indent: [unclosed\n');
    const { error } = await run(
      ['task-add', 'M001', '--file', bad, '--change-log', 'Evidence.', '--json'],
      root,
    );
    expect(error?.message).toMatch(/invalid task definition/);
    expect(pendingAddEntries()).toHaveLength(0);
  });

  it('refuses a definition file that is not a YAML object (list)', async () => {
    const list = join(scratch, 'list.yaml');
    writeFileSync(list, '- not\n- an\n- object\n');
    const { error } = await run(
      ['task-add', 'M001', '--file', list, '--change-log', 'Evidence.', '--json'],
      root,
    );
    expect(error?.message).toMatch(/must be a YAML object of task fields/);
    expect(pendingAddEntries()).toHaveLength(0);
  });

  it('refuses a definition failing full task-schema validation (context_files without write_scope)', async () => {
    const fields = newTaskFields({ id: 'T004' });
    delete fields.write_scope;
    const { error } = await addTaskCmd(fields);
    expect(error?.message).toMatch(/invalid new task T004/);
    expect(pendingAddEntries()).toHaveLength(0);
  });

  it('refuses an id that is not the next sequential Tnnn (gap)', async () => {
    const { error } = await addTaskCmd(newTaskFields({ id: 'T099' }));
    expect(error?.message).toMatch(/T004/);
    expect(pendingAddEntries()).toHaveLength(0);
  });

  it('refuses an id that collides with an existing task', async () => {
    const { error } = await addTaskCmd(newTaskFields({ id: 'T001' }));
    expect(error?.message).toMatch(/T004/);
    expect(pendingAddEntries()).toHaveLength(0);
  });

  it('refuses depends_on naming an unknown task', async () => {
    const { error } = await addTaskCmd(newTaskFields({ depends_on: ['T099'] }));
    expect(error?.message).toMatch(/unknown task T099/);
    expect(pendingAddEntries()).toHaveLength(0);
  });

  it('refuses depends_on naming a cancelled task, which would never complete', async () => {
    expect(task('T003').status).toBe('ready');
    expect((await run(['task-update', 'T003', 'cancelled'], root)).error).toBeUndefined();
    const { error } = await addTaskCmd(newTaskFields({ depends_on: ['T003'] }));
    expect(error?.message).toMatch(/cancelled task T003/);
    expect(pendingAddEntries()).toHaveLength(0);
  });
});

describe('pitway task-add ready/waiting outcomes, journal entry, and materialization', () => {
  it('adds a task with no unmet dependencies as ready, materializing tasks.yaml with a pending journal entry, no commit', async () => {
    const before = commitCount(root);
    const { lines, error } = await addTaskCmd(newTaskFields());
    expect(error).toBeUndefined();

    const view = JSON.parse(lines[0]!) as { id: string; milestone: string; operation: string };
    expect(view).toEqual({ id: 'T004', milestone: 'M001', operation: 'add' });

    expect(task('T004').status).toBe('ready');
    expect(commitCount(root)).toBe(before);
    expect(git(['status', '--porcelain'], root)).toMatch(/tasks\.yaml/);

    const pending = pendingAddEntries('T004');
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      milestone: 'M001',
      type: 'task_amendment',
      target: 'T004',
      payload: { operation: 'add', changeLogEvidence: 'Discovered mid-flight, added as follow-on work.' },
    });
  });

  it('adds a task depending on an incomplete task as waiting', async () => {
    expect(task('T002').status).toBe('waiting');
    const { error } = await addTaskCmd(newTaskFields({ depends_on: ['T002'] }));
    expect(error).toBeUndefined();
    expect(task('T004').status).toBe('waiting');
  });
});

describe('pitway task-add interaction with milestone-review (staleness)', () => {
  it('stales an open review session, detected at the next brief/record', async () => {
    const started = await run(['milestone-review', 'start', 'M001', '--roles', 'developer', '--json'], root);
    expect(started.error).toBeUndefined();

    const findings = join(scratch, 'findings.yaml');
    writeFileSync(findings, 'findings: []\n');
    const record1 = await run(
      ['milestone-review', 'record', 'M001', '--role', 'developer', '--file', findings],
      root,
    );
    expect(record1.error).toBeUndefined();

    expect((await addTaskCmd(newTaskFields())).error).toBeUndefined();

    const record2 = await run(
      ['milestone-review', 'record', 'M001', '--role', 'developer', '--file', findings],
      root,
    );
    expect(record2.error).toBeDefined();
    expect(record2.error!.message).toContain('revised');
  });
});

describe('pitway task-add interaction with auto-run (invalidation)', () => {
  it('invalidates an active auto-run authorization', async () => {
    expect((await run(['auto-run', 'enable', 'M001', '--json'], root)).error).toBeUndefined();
    const before = await run(['auto-run', 'status', 'M001', '--json'], root);
    expect(JSON.parse(before.lines.join('\n'))).toMatchObject({ authorized: true });

    expect((await addTaskCmd(newTaskFields())).error).toBeUndefined();

    const after = await run(['auto-run', 'status', 'M001', '--json'], root);
    expect(JSON.parse(after.lines.join('\n'))).toMatchObject({
      authorized: false,
      reason: 'amendment recorded since',
    });
  });
});

describe('pitway task-add: the dispatch rule (inline immediate, dispatch waits for a checkpoint)', () => {
  it('allows inline task-update in_progress on the new task immediately, before any checkpoint', async () => {
    expect((await addTaskCmd(newTaskFields())).error).toBeUndefined();
    const started = await run(['task-update', 'T004', 'in_progress'], root);
    expect(started.error).toBeUndefined();
    expect(task('T004').status).toBe('in_progress');
  });

  it('task-dispatch refuses while the add is pending, then succeeds once a sibling completion commit checkpoints it', async () => {
    saveConfig(root, { ...loadConfig(root), execution: { strategy: 'parallel_worktrees' } });
    git(['add', '.pitway/config.yaml'], root);
    git(['commit', '-q', '-m', 'test: enable parallel_worktrees'], root);
    expect((await addTaskCmd(newTaskFields())).error).toBeUndefined();

    const blocked = await run(['task-dispatch', 'T003'], root);
    expect(blocked.error).toBeDefined();
    expect(blocked.error!.message).toMatch(/pending/);

    // A sibling task's REAL inline completion commit checkpoints the
    // pending task-add entry (T001, independent of T003/T004).
    expect((await run(['task-update', 'T001', 'in_progress'], root)).error).toBeUndefined();
    expect((await run(['task-update', 'T001', 'review'], root)).error).toBeUndefined();
    const result = join(scratch, 'result.yaml');
    const message = join(scratch, 'message.txt');
    writeFileSync(result, 'summary: Done.\nevidence: node reported 1 passed\n');
    writeFileSync(message, 'task: complete T001\n');
    expect(
      (await run(['task-update', 'T001', 'completed', '--result', result, '--message', message], root))
        .error,
    ).toBeUndefined();
    expect(pendingAddEntries('T004')).toHaveLength(0);

    const dispatched = await run(['task-dispatch', 'T003'], root);
    expect(dispatched.error).toBeUndefined();
  });

  it('is safe during a live worktree dispatch: task-integrate applies only the worker diff, main tasks.yaml keeps the inserted task', async () => {
    saveConfig(root, { ...loadConfig(root), execution: { strategy: 'parallel_worktrees' } });
    git(['add', '.pitway/config.yaml'], root);
    git(['commit', '-q', '-m', 'test: enable parallel_worktrees'], root);
    expect((await run(['task-dispatch', 'T003'], root)).error).toBeUndefined();

    // task-add lands on the MAIN tree while T003's worktree is live.
    expect((await addTaskCmd(newTaskFields())).error).toBeUndefined();
    expect(task('T004').status).toBe('ready');

    const worktree = join(root, WORKTREES_DIR, 'M001-T003');
    mkdirSync(join(worktree, 'src'), { recursive: true });
    writeFileSync(join(worktree, 'src', 'c.ts'), 'export const c = 1;\n');
    git(['add', '-A'], worktree);
    git(['commit', '-q', '-m', 'worker: src/c.ts'], worktree);

    const integrated = await run(['task-integrate', 'T003'], root);
    expect(integrated.error).toBeUndefined();

    expect(task('T004').status).toBe('ready');
    expect(pendingAddEntries('T004')).toHaveLength(1);
  });
});

// M020-pattern CommandDeps defaults: registering with no deps at all reaches
// deps.write ?? console.log and deps.root ?? process.cwd(), and the non---json
// invocation renders through renderTaskAddHuman.
describe('pitway task-add default CommandDeps fallbacks and human rendering', () => {
  it('falls back to console.log/process.cwd() and renders the human line without --json', async () => {
    const file = taskDefinitionFile(newTaskFields());
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cwdBefore = process.cwd();
    process.chdir(root);
    let caught: unknown;
    let calls: unknown[][] = [];
    try {
      const program = buildCli();
      registerTaskAddCommand(program);
      await program.parseAsync([
        'node', 'pitway', 'task-add', 'M001', '--file', file, '--change-log', 'Evidence.',
      ]);
    } catch (error) {
      caught = error;
    } finally {
      // vitest v4: mockRestore() clears recorded calls -- capture first.
      calls = logSpy.mock.calls;
      process.chdir(cwdBefore);
      logSpy.mockRestore();
    }

    expect(caught).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toContain('Added task T004 to M001');
    expect(calls[0]?.[0]).toContain('task-dispatch refuses until then');
    expect(task('T004').status).toBe('ready');
  });
});

describe('pitway task-add: resume and milestone-status render with the entry pending', () => {
  it('renders the new task in both resume and milestone-status', async () => {
    expect((await addTaskCmd(newTaskFields())).error).toBeUndefined();

    const resumed = await run(['resume'], root);
    expect(resumed.error).toBeUndefined();
    expect(resumed.lines.join('\n')).toContain('T004');

    const status = await run(['milestone-status', 'M001'], root);
    expect(status.error).toBeUndefined();
    expect(status.lines.join('\n')).toContain('T004');
  });
});
