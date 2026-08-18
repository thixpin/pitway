import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildCli } from '../../src/cli/index.js';
import { registerInitCommand } from '../../src/cli/commands/init.js';
import { registerMilestoneAddCommand } from '../../src/cli/commands/milestone-add.js';
import { registerMilestoneConfirmCommand } from '../../src/cli/commands/milestone-confirm.js';
import { registerTaskUpdateCommand } from '../../src/cli/commands/task-update.js';
import { registerResumeCommand } from '../../src/cli/commands/resume.js';
import { resolveCommitSha } from '../../src/git/trailers.js';
import { loadContract, loadTasks } from '../../src/state/store.js';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

const commitCount = (cwd: string): number => Number(git(['rev-list', '--count', 'HEAD'], cwd).trim());
const headSha = (cwd: string): string => git(['rev-parse', 'HEAD'], cwd).trim();
const headMessage = (cwd: string): string => git(['log', '-1', '--format=%B'], cwd);
const headFiles = (cwd: string): string[] =>
  git(['show', '--name-only', '--format='], cwd)
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .sort();
const stagedFiles = (cwd: string): string => git(['diff', '--cached', '--name-only'], cwd).trim();

const CONTRACT_FIXTURE = `---
schema_version: 1
id: M999
title: Self-hosting readiness
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

Prove the full lifecycle in a real repo.

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

const REQUIREMENT_FIXTURE = '# Requirement\n\nShip the self-hosting readiness scenario.\n';

const MESSAGE_FIXTURE = `task: complete T001

Implemented the greeter.

Claude-Session: https://example.com/session/abc
Co-Authored-By: Claude <noreply@anthropic.com>
`;

const RESULT_FIXTURE = `summary: Implemented the greeter.
evidence: npm test passed
`;

const TASKS_PATH = '.pitway/milestones/M001/tasks.yaml';

const EXPECTED_BASELINE_FILES = [
  '.pitway/config.yaml',
  '.pitway/milestones/M001/contract.md',
  '.pitway/milestones/M001/tasks.yaml',
  '.pitway/milestones/M001/usage.yaml',
  '.pitway/milestones/M001/verification-results.yaml',
  '.pitway/requirements/R001.md',
  '.pitway/state.yaml',
].sort();

// Flag/draft input files live outside the repo so they never appear as dirt.
let scratch: string;

async function run(args: string[], cwd: string): Promise<{ lines: string[]; error?: Error }> {
  const program = buildCli();
  const lines: string[] = [];
  const deps = { root: cwd, write: (s: string) => lines.push(s) };
  registerInitCommand(program, deps);
  registerMilestoneAddCommand(program, deps);
  registerMilestoneConfirmCommand(program, deps);
  registerTaskUpdateCommand(program, deps);
  registerResumeCommand(program, deps);
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

async function addDraftMilestone(root: string, withRequirement: boolean): Promise<void> {
  const contract = join(scratch, 'draft-contract.md');
  const tasks = join(scratch, 'draft-tasks.yaml');
  writeFileSync(contract, CONTRACT_FIXTURE);
  writeFileSync(tasks, TASKS_FIXTURE);
  const args = ['milestone-add', '--contract', contract, '--tasks', tasks];
  if (withRequirement) {
    const req = join(scratch, 'req.md');
    writeFileSync(req, REQUIREMENT_FIXTURE);
    args.push('--requirement', req);
  }
  const { error } = await run(args, root);
  expect(error).toBeUndefined();
}

function completionFlags(): string[] {
  const result = join(scratch, 'result.yaml');
  const message = join(scratch, 'message.txt');
  writeFileSync(result, RESULT_FIXTURE);
  writeFileSync(message, MESSAGE_FIXTURE);
  return ['--result', result, '--message', message];
}

function doTaskWork(root: string): void {
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'greeter.ts'), 'export const greet = (): string => "hi";\n');
}

const DIRT = 'unrelated work in progress\n';

function injectDirt(root: string): string {
  const path = join(root, 'unrelated.txt');
  writeFileSync(path, DIRT);
  return path;
}

// The injected file must survive every refusal untouched and untracked —
// proof no command ran a destructive git operation.
function expectDirtIntact(root: string): void {
  expect(readFileSync(join(root, 'unrelated.txt'), 'utf8')).toBe(DIRT);
  expect(git(['status', '--porcelain'], root)).toContain('?? unrelated.txt');
  expect(git(['ls-files', 'unrelated.txt'], root).trim()).toBe('');
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'pitway-shr-in-'));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

// AC021: the full lifecycle runs sequentially in one real temp repo. Every
// state mutation after setup goes through registered commands — the test
// never edits .pitway/ directly.
describe('self-hosting readiness scenario (AC021)', () => {
  let root: string;

  beforeAll(() => {
    root = makeRepo('pitway-shr-');
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('init scaffolds the workspace without committing', async () => {
    const { error } = await run(['init'], root);
    expect(error).toBeUndefined();
    expect(existsSync(join(root, '.pitway', 'config.yaml'))).toBe(true);
    expect(existsSync(join(root, '.pitway', 'state.yaml'))).toBe(true);
    expect(commitCount(root)).toBe(1);
  });

  it('milestone-add --requirement creates M001 as draft with a linked R001', async () => {
    const contract = join(scratch, 'draft-contract.md');
    const tasks = join(scratch, 'draft-tasks.yaml');
    const req = join(scratch, 'req.md');
    writeFileSync(contract, CONTRACT_FIXTURE);
    writeFileSync(tasks, TASKS_FIXTURE);
    writeFileSync(req, REQUIREMENT_FIXTURE);

    const { lines, error } = await run(
      ['milestone-add', '--contract', contract, '--tasks', tasks, '--requirement', req, '--json'],
      root,
    );
    expect(error).toBeUndefined();
    expect(JSON.parse(lines[0]!)).toMatchObject({
      id: 'M001',
      title: 'Self-hosting readiness',
      requirement: 'R001',
    });

    const frontmatter = loadContract(root, 'M001').frontmatter;
    expect(frontmatter.status).toBe('draft');
    expect(frontmatter.requirement).toBe('R001');
    expect(readFileSync(join(root, '.pitway', 'requirements', 'R001.md'), 'utf8')).toBe(
      REQUIREMENT_FIXTURE,
    );
    expect(loadTasks(root, 'M001').tasks.map((t) => [t.id, t.status])).toEqual([
      ['T001', 'planned'],
      ['T002', 'planned'],
    ]);
    const state = readFileSync(join(root, '.pitway', 'state.yaml'), 'utf8');
    expect(state).toContain('active_milestone: M001');
    expect(commitCount(root)).toBe(1);
  });

  it('milestone-confirm commits the exact baseline set with the milestone trailer only', async () => {
    const { lines, error } = await run(['milestone-confirm', 'M001', '--json'], root);
    expect(error).toBeUndefined();
    expect((JSON.parse(lines[0]!) as { outcome: string }).outcome).toBe('committed');

    expect(commitCount(root)).toBe(2);
    expect(headFiles(root)).toEqual(EXPECTED_BASELINE_FILES);
    const message = headMessage(root);
    expect(message.startsWith('workflow: add milestone M001')).toBe(true);
    expect(message).toContain('PitWay-Milestone: M001');
    expect(message).not.toMatch(/PitWay-Task/);
    expect(resolveCommitSha(root, { milestone: 'M001' })).toBe(headSha(root));

    const frontmatter = loadContract(root, 'M001').frontmatter;
    expect(frontmatter.status).toBe('in_progress');
    expect(frontmatter.confirmed_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(frontmatter.verification_approved_hash).toBeTruthy();
    expect(loadTasks(root, 'M001').tasks.map((t) => [t.id, t.status])).toEqual([
      ['T001', 'ready'],
      ['T002', 'waiting'],
    ]);
    expect(git(['status', '--porcelain'], root).trim()).toBe('');
  });

  it('drives T001 ready -> in_progress -> review -> completed; completion commits both trailers', async () => {
    const started = await run(['task-update', 'T001', 'in_progress', '--json'], root);
    expect(started.error).toBeUndefined();
    expect(JSON.parse(started.lines[0]!)).toMatchObject({
      id: 'T001',
      status: 'in_progress',
      attempts: 1,
    });

    // Real work: create the task's declared relevant file before review.
    doTaskWork(root);
    const reviewed = await run(['task-update', 'T001', 'review'], root);
    expect(reviewed.error).toBeUndefined();
    expect(commitCount(root)).toBe(2);

    const completed = await run(
      ['task-update', 'T001', 'completed', ...completionFlags(), '--json'],
      root,
    );
    expect(completed.error).toBeUndefined();
    const view = JSON.parse(completed.lines[0]!) as { outcome: string; commit: string };
    expect(view.outcome).toBe('committed');

    expect(commitCount(root)).toBe(3);
    expect(view.commit).toBe(headSha(root));
    expect(resolveCommitSha(root, { milestone: 'M001', task: 'T001' })).toBe(headSha(root));
    expect(headFiles(root)).toEqual([TASKS_PATH, 'src/greeter.ts'].sort());
    const message = headMessage(root);
    expect(message.startsWith('task: complete T001')).toBe(true);
    expect(message).toContain('PitWay-Milestone: M001');
    expect(message).toContain('PitWay-Task: T001');
    expect(message).not.toMatch(/Claude-Session/);
    expect(git(['status', '--porcelain'], root).trim()).toBe('');

    const t001 = loadTasks(root, 'M001').tasks.find((t) => t.id === 'T001')!;
    expect(t001.status).toBe('completed');
    expect(t001.result).toEqual({ summary: 'Implemented the greeter.', evidence: 'npm test passed' });
  });

  it('resume reconstructs the state from .pitway/ alone', async () => {
    const { lines, error } = await run(['resume', '--json'], root);
    expect(error).toBeUndefined();
    const view = JSON.parse(lines[0]!) as {
      activeMilestone: string;
      contractStatus: string;
      title: string;
      tasks: Array<{ id: string; status: string }>;
      ready: string[];
      waiting: string[];
      nextTask: string | null;
    };
    expect(view.activeMilestone).toBe('M001');
    expect(view.contractStatus).toBe('in_progress');
    expect(view.title).toBe('Self-hosting readiness');
    expect(view.tasks).toEqual([
      { id: 'T001', status: 'completed' },
      // Completion does not auto-promote dependents; T002 stays waiting
      // until an explicit task-update promotes it, and resume reports that.
      { id: 'T002', status: 'waiting' },
    ]);
    expect(view.ready).toEqual([]);
    expect(view.waiting).toEqual(['T002']);
    expect(view.nextTask).toBeNull();
  });
});

describe('dirty-injection refusals at the three git boundaries (AC021)', () => {
  let root: string;

  beforeEach(() => {
    root = makeRepo('pitway-shr-dirty-');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('milestone-confirm refuses unrelated dirt naming the file, creating no commit', async () => {
    await run(['init'], root);
    await addDraftMilestone(root, false);
    injectDirt(root);

    const { error } = await run(['milestone-confirm', 'M001'], root);
    expect(error?.message).toMatch(/unrelated\.txt/);
    expect(loadContract(root, 'M001').frontmatter.status).toBe('draft');
    expect(commitCount(root)).toBe(1);
    expect(stagedFiles(root)).toBe('');
    expectDirtIntact(root);
  });

  it('task-update to in_progress refuses unrelated dirt, writing nothing', async () => {
    await run(['init'], root);
    await addDraftMilestone(root, false);
    await run(['milestone-confirm', 'M001'], root);
    injectDirt(root);

    const { error } = await run(['task-update', 'T001', 'in_progress'], root);
    expect(error?.message).toMatch(/unrelated\.txt/);
    const t001 = loadTasks(root, 'M001').tasks.find((t) => t.id === 'T001')!;
    expect(t001.status).toBe('ready');
    expect(t001.attempts).toBeUndefined();
    expect(commitCount(root)).toBe(2);
    expectDirtIntact(root);
  });

  it('task-update to completed refuses unrelated dirt with nothing staged or committed', async () => {
    await run(['init'], root);
    await addDraftMilestone(root, false);
    await run(['milestone-confirm', 'M001'], root);
    expect((await run(['task-update', 'T001', 'in_progress'], root)).error).toBeUndefined();
    doTaskWork(root);
    expect((await run(['task-update', 'T001', 'review'], root)).error).toBeUndefined();
    injectDirt(root);

    const { error } = await run(['task-update', 'T001', 'completed', ...completionFlags()], root);
    expect(error?.message).toMatch(/unrelated\.txt/);
    const t001 = loadTasks(root, 'M001').tasks.find((t) => t.id === 'T001')!;
    expect(t001.status).toBe('review');
    expect(t001.result).toBeNull();
    expect(stagedFiles(root)).toBe('');
    expect(commitCount(root)).toBe(2);
    expectDirtIntact(root);
  });
});
