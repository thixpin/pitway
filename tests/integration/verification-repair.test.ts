import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCli } from '../../src/cli/index.js';
import { registerInitCommand } from '../../src/cli/commands/init.js';
import { registerMilestoneAddCommand } from '../../src/cli/commands/milestone-add.js';
import { registerMilestoneCompleteCommand } from '../../src/cli/commands/milestone-complete.js';
import { registerMilestoneConfirmCommand } from '../../src/cli/commands/milestone-confirm.js';
import { registerTaskUpdateCommand } from '../../src/cli/commands/task-update.js';
import { registerVerificationRepairCommand } from '../../src/cli/commands/verification-repair.js';
import { registerVerifyCommand } from '../../src/cli/commands/verify.js';
import { resolveCommitSha } from '../../src/git/trailers.js';
import { loadTasks, loadVerificationRepairs, loadVerificationResults } from '../../src/state/store.js';
import type { Task } from '../../src/state/schemas.js';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

const commitCount = (cwd: string): number => Number(git(['rev-list', '--count', 'HEAD'], cwd).trim());
const headMessage = (cwd: string): string => git(['log', '-1', '--format=%B'], cwd);
const headFiles = (cwd: string): string[] =>
  git(['show', '--name-only', '--format='], cwd)
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .sort();

let root: string;
let scratch: string;

// CT001 is a real, cheap command check whose pass/fail is controlled purely
// by repair-target.txt's content — no shell-specific test(1)/colon-bearing
// ternary, so it stays a safe plain YAML scalar. CT002 is manual, used both
// as a normal milestone gate and as the non-command-type rejection target.
const CONTRACT_FIXTURE = `---
schema_version: 1
id: M999
title: Repairable milestone
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
    command: node -e "const fs=require('fs'); const ok = fs.existsSync('repair-target.txt') && fs.readFileSync('repair-target.txt','utf8').includes('FIXED'); if (!ok) process.exit(1)"
  - id: CT002
    criterion: AC001
    type: manual
    instruction: Check the docs.
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

const MESSAGE_FIXTURE = `task: complete T001

Implemented the first thing.
`;

const RESULT_FIXTURE = `summary: Implemented the thing.
evidence: npm test passed
`;

function milestoneDirName(id: string): string {
  const dir = join(root, '.pitway', 'milestones');
  const match = readdirSync(dir).find((e) => e === id || e.startsWith(`${id}-`));
  if (!match) throw new Error(`no milestone directory found for ${id}`);
  return match;
}

const milestoneRelFile = (file: string): string =>
  `.pitway/milestones/${milestoneDirName('M001')}/${file}`;

const contractPath = (): string => milestoneRelFile('contract.md');
const tasksYamlPath = (): string => milestoneRelFile('tasks.yaml');
const verificationResultsPath = (): string => milestoneRelFile('verification-results.yaml');
const verificationRepairsPath = (): string => milestoneRelFile('verification-repairs.yaml');

async function run(args: string[], cwd: string): Promise<{ lines: string[]; error?: Error }> {
  const program = buildCli();
  const lines: string[] = [];
  registerInitCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerMilestoneAddCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerMilestoneConfirmCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerMilestoneCompleteCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerTaskUpdateCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerVerifyCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerVerificationRepairCommand(program, { root: cwd, write: (s) => lines.push(s) });
  try {
    await program.parseAsync(['node', 'pitway', ...args]);
    return { lines };
  } catch (error) {
    return { lines, error: error as Error };
  }
}

async function readyMilestone(): Promise<void> {
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

async function completeT001(): Promise<void> {
  expect((await run(['task-update', 'T001', 'in_progress'], root)).error).toBeUndefined();
  expect((await run(['task-update', 'T001', 'review'], root)).error).toBeUndefined();
  const result = join(scratch, 'result.yaml');
  const message = join(scratch, 'message.txt');
  writeFileSync(result, RESULT_FIXTURE);
  writeFileSync(message, MESSAGE_FIXTURE);
  const { error } = await run(
    ['task-update', 'T001', 'completed', '--result', result, '--message', message],
    root,
  );
  expect(error).toBeUndefined();
}

function seedRepairTarget(content = 'FIXED\n'): void {
  writeFileSync(join(root, 'repair-target.txt'), content);
}

async function recordBaselineChecks(): Promise<void> {
  const verifyResult = await run(['verify', 'M001'], root);
  expect(verifyResult.error).toBeUndefined();
  const record = await run(
    ['verify', 'M001', '--check', 'CT002', '--pass', '--evidence', 'docs reviewed'],
    root,
  );
  expect(record.error).toBeUndefined();
}

// Full baseline: in_progress milestone, T001 completed via a real
// task-update commit, repair-target.txt present and committed with a
// passing CT001, CT002 recorded pass, working tree clean — a fully
// gate-satisfied state ready for a verification-repair approve/commit cycle.
async function readyForRepair(): Promise<void> {
  await readyMilestone();
  await completeT001();
  seedRepairTarget();
  git(['add', 'repair-target.txt'], root);
  git(['commit', '-q', '-m', 'test: seed repair target'], root);
  await recordBaselineChecks();
  // verify writes verification-results.yaml directly, uncommitted; fold it
  // into a plain test-setup commit so every repair test starts from a
  // genuinely clean tree.
  git(['add', verificationResultsPath()], root);
  git(['commit', '-q', '-m', 'test: seed baseline check results'], root);
  expect(git(['status', '--porcelain'], root).trim()).toBe('');
}

async function approve(
  files: string[],
  checks: string[],
  changeLog = 'Fix the regression.',
  milestone = 'M001',
): Promise<{ lines: string[]; error?: Error }> {
  const args = ['verification-repair', 'approve', milestone];
  for (const f of files) args.push('--file', f);
  for (const c of checks) args.push('--check', c);
  args.push('--change-log', changeLog, '--json');
  return run(args, root);
}

async function commitRepair(vrId: string, milestone = 'M001'): Promise<{ lines: string[]; error?: Error }> {
  return run(['verification-repair', 'commit', milestone, vrId, '--json'], root);
}

async function cancelRepair(vrId: string, milestone = 'M001'): Promise<{ lines: string[]; error?: Error }> {
  return run(['verification-repair', 'cancel', milestone, vrId, '--json'], root);
}

function repairs(): ReturnType<typeof loadVerificationRepairs> {
  return loadVerificationRepairs(root, 'M001');
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'pitway-vrepair-'));
  scratch = mkdtempSync(join(tmpdir(), 'pitway-vrepair-in-'));
  git(['init', '-q'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  writeFileSync(join(root, 'README.md'), 'seed\n');
  git(['add', 'README.md'], root);
  git(['commit', '-q', '-m', 'init'], root);
  await run(['init'], root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

describe('pitway verification-repair approve validation', () => {
  it('rejects an empty --file list', async () => {
    await readyForRepair();
    const { error } = await approve([], ['CT001']);
    expect(error?.message).toMatch(/--file/);
    expect(repairs().records).toHaveLength(0);
  });

  it('rejects a duplicate --file path', async () => {
    await readyForRepair();
    const { error } = await approve(['repair-target.txt', 'repair-target.txt'], ['CT001']);
    expect(error?.message).toMatch(/duplicate/i);
    expect(repairs().records).toHaveLength(0);
  });

  it('rejects a --file path resolving outside the repository', async () => {
    await readyForRepair();
    const { error } = await approve(['../outside.txt'], ['CT001']);
    expect(error?.message).toMatch(/outside the repository/);
    expect(repairs().records).toHaveLength(0);
  });

  it('rejects an empty --check list', async () => {
    await readyForRepair();
    const { error } = await approve(['repair-target.txt'], []);
    expect(error?.message).toMatch(/--check/);
    expect(repairs().records).toHaveLength(0);
  });

  it('rejects a duplicate --check id', async () => {
    await readyForRepair();
    const { error } = await approve(['repair-target.txt'], ['CT001', 'CT001']);
    expect(error?.message).toMatch(/duplicate/i);
    expect(repairs().records).toHaveLength(0);
  });

  it('rejects an unknown --check id', async () => {
    await readyForRepair();
    const { error } = await approve(['repair-target.txt'], ['CT999']);
    expect(error?.message).toMatch(/CT999/);
    expect(repairs().records).toHaveLength(0);
  });

  it('rejects a --check id that is not a command-type check', async () => {
    await readyForRepair();
    const { error } = await approve(['repair-target.txt'], ['CT002']);
    expect(error?.message).toMatch(/CT002/);
    expect(error?.message).toMatch(/command/i);
    expect(repairs().records).toHaveLength(0);
  });

  it.each([
    ['contract.md', () => contractPath()],
    ['tasks.yaml', () => tasksYamlPath()],
    ['verification-results.yaml', () => verificationResultsPath()],
    ['state.yaml', () => '.pitway/state.yaml'],
  ])('rejects %s as a declared --file target', async (_label, path) => {
    await readyForRepair();
    const { error } = await approve([path()], ['CT001']);
    expect(error?.message).toMatch(/not a valid repair target/);
    expect(repairs().records).toHaveLength(0);
  });

  it('refuses when the milestone is not in_progress', async () => {
    const contract = join(root, 'draft-contract.md');
    const tasks = join(root, 'draft-tasks.yaml');
    writeFileSync(contract, CONTRACT_FIXTURE);
    writeFileSync(tasks, TASKS_FIXTURE);
    await run(['milestone-add', '--contract', contract, '--tasks', tasks], root);
    rmSync(contract);
    rmSync(tasks);
    const { error } = await approve(['repair-target.txt'], ['CT001']);
    expect(error?.message).toMatch(/not in_progress/);
  });

  it('refuses when a non-cancelled task is not completed, naming it', async () => {
    await readyMilestone();
    const { error } = await approve(['repair-target.txt'], ['CT001']);
    expect(error?.message).toMatch(/T001/);
  });

  it('refuses a second approve while one VR is already pending', async () => {
    await readyForRepair();
    const first = await approve(['repair-target.txt'], ['CT001'], 'First attempt.');
    expect(first.error).toBeUndefined();
    const view = JSON.parse(first.lines[0]!) as { id: string };
    expect(view.id).toBe('VR001');

    const second = await approve(['repair-target.txt'], ['CT001'], 'Second attempt.');
    expect(second.error?.message).toMatch(/VR001/);
    expect(second.error?.message).toMatch(/pending/);
    expect(repairs().records).toHaveLength(1);
  });

  it('allocates a durable VR id and persists status pending, uncommitted', async () => {
    await readyForRepair();
    const before = commitCount(root);
    const { lines, error } = await approve(
      ['repair-target.txt'],
      ['CT001'],
      'Fixes the regression found post-completion.',
    );
    expect(error).toBeUndefined();
    const view = JSON.parse(lines[0]!) as { id: string; milestone: string; status: string };
    expect(view).toMatchObject({ id: 'VR001', milestone: 'M001', status: 'pending' });

    expect(commitCount(root)).toBe(before);
    expect(git(['status', '--porcelain'], root)).toMatch(/verification-repairs\.yaml/);
    const record = repairs().records[0]!;
    expect(record).toMatchObject({
      id: 'VR001',
      files: ['repair-target.txt'],
      checks: ['CT001'],
      change_log: 'Fixes the regression found post-completion.',
      status: 'pending',
    });
  });
});

describe('pitway verification-repair commit', () => {
  it('refuses on unexpected dirt outside the approved scope, staging and committing nothing', async () => {
    await readyForRepair();
    await approve(['repair-target.txt'], ['CT001']);
    writeFileSync(join(root, 'repair-target.txt'), 'FIXED and more\n');
    writeFileSync(join(root, 'stray.txt'), 'unrelated\n');

    const before = commitCount(root);
    const { error } = await commitRepair('VR001');
    expect(error?.message).toMatch(/stray\.txt/);
    expect(commitCount(root)).toBe(before);
    expect(repairs().records[0]!.status).toBe('pending');
  });

  it('refuses and leaves the VR pending when a rerun check fails', async () => {
    await readyForRepair();
    await approve(['repair-target.txt'], ['CT001'], 'Attempted fix.');
    writeFileSync(join(root, 'repair-target.txt'), 'still broken\n');

    const before = commitCount(root);
    const { error } = await commitRepair('VR001');
    expect(error?.message).toMatch(/CT001/);
    expect(commitCount(root)).toBe(before);
    expect(repairs().records[0]!.status).toBe('pending');
    // Append-only: the failing rerun's result is still recorded.
    const results = loadVerificationResults(root, 'M001').results;
    expect(results[results.length - 1]).toMatchObject({ check: 'CT001', status: 'fail' });
  });

  it('succeeds and atomically commits the VR record, corrected file, and fresh verification results', async () => {
    await readyForRepair();
    await approve(['repair-target.txt'], ['CT001'], 'Attempted fix.');
    writeFileSync(join(root, 'repair-target.txt'), 'still broken\n');
    expect((await commitRepair('VR001')).error).toBeDefined();

    // Now actually fix it, and retry the same VR.
    writeFileSync(join(root, 'repair-target.txt'), 'FIXED for real\n');
    const { lines, error } = await commitRepair('VR001');
    expect(error).toBeUndefined();
    const view = JSON.parse(lines[0]!) as { id: string; outcome: string; commit: string };
    expect(view.id).toBe('VR001');
    expect(view.outcome).toBe('committed');
    expect(view.commit).toBe(git(['rev-parse', 'HEAD'], root).trim());

    expect(headFiles(root)).toEqual(
      ['repair-target.txt', verificationRepairsPath(), verificationResultsPath()].sort(),
    );
    const message = headMessage(root);
    expect(message).toContain('PitWay-Milestone: M001');
    expect(message).toContain('PitWay-Verification-Repair: VR001');
    expect(git(['status', '--porcelain'], root).trim()).toBe('');

    expect(repairs().records[0]!.status).toBe('committed');
    const results = loadVerificationResults(root, 'M001').results;
    expect(results[results.length - 1]).toMatchObject({ check: 'CT001', status: 'pass' });
  });

  it('retries cleanly against the still-pending VR after a failed attempt, without allocating a new id', async () => {
    await readyForRepair();
    await approve(['repair-target.txt'], ['CT001']);
    const duringPending = await approve(['repair-target.txt'], ['CT001']);
    expect(duringPending.error?.message).toMatch(/pending/);

    writeFileSync(join(root, 'repair-target.txt'), 'FIXED again\n');
    const { error } = await commitRepair('VR001');
    expect(error).toBeUndefined();
    expect(repairs().records).toHaveLength(1);
  });

  it('re-entry after the commit landed is idempotent: same outcome, no new commit', async () => {
    await readyForRepair();
    await approve(['repair-target.txt'], ['CT001']);
    writeFileSync(join(root, 'repair-target.txt'), 'FIXED again\n');
    expect((await commitRepair('VR001')).error).toBeUndefined();

    const before = commitCount(root);
    const { lines, error } = await commitRepair('VR001');
    expect(error).toBeUndefined();
    const view = JSON.parse(lines[0]!) as { outcome: string; commit: string };
    expect(view.outcome).toBe('already-committed');
    expect(view.commit).toBe(git(['rev-parse', 'HEAD'], root).trim());
    expect(commitCount(root)).toBe(before);
  });

  it('self-heals when the commit landed but the local status never reached committed', async () => {
    await readyForRepair();
    await approve(['repair-target.txt'], ['CT001']);
    writeFileSync(join(root, 'repair-target.txt'), 'FIXED once more\n');
    expect((await commitRepair('VR001')).error).toBeUndefined();
    expect(repairs().records[0]!.status).toBe('committed');

    // Simulate the interruption: the commit is real and already carries the
    // committed record, but the local file is reverted to still say
    // pending — mirrors a crash between the commit landing and the local
    // status flip persisting.
    const committedRecord = repairs().records[0]!;
    const { saveVerificationRepairs } = await import('../../src/state/store.js');
    saveVerificationRepairs(root, 'M001', {
      schema_version: 1,
      records: [{ ...committedRecord, status: 'pending' }],
    });
    expect(repairs().records[0]!.status).toBe('pending');

    const before = commitCount(root);
    const { lines, error } = await commitRepair('VR001');
    expect(error).toBeUndefined();
    const view = JSON.parse(lines[0]!) as { outcome: string };
    expect(view.outcome).toBe('already-committed');
    expect(commitCount(root)).toBe(before); // no new commit
    expect(repairs().records[0]!.status).toBe('committed'); // self-healed
  });

  it('refuses as ambiguous when a matching-trailer commit exists whose content diverges from the persisted record', async () => {
    await readyForRepair();
    await approve(['repair-target.txt'], ['CT001'], 'Original rationale.');
    const originalRecord = repairs().records[0]!;

    // Fabricate a rogue commit carrying both trailers but a different
    // verification-repairs.yaml record than what is currently persisted.
    const { saveVerificationRepairs } = await import('../../src/state/store.js');
    saveVerificationRepairs(root, 'M001', {
      schema_version: 1,
      records: [{ ...originalRecord, change_log: 'Tampered rationale.', status: 'committed' }],
    });
    git(['add', verificationRepairsPath()], root);
    git(
      ['commit', '-q', '-m', 'fix: rogue\n\nPitWay-Milestone: M001\nPitWay-Verification-Repair: VR001'],
      root,
    );

    // Restore the on-disk record back to what approve legitimately produced.
    saveVerificationRepairs(root, 'M001', { schema_version: 1, records: [originalRecord] });

    const { error } = await commitRepair('VR001');
    expect(error?.message).toMatch(/ambiguous/i);
    expect(error?.message).toMatch(/inspect manually/);
  });

  it('never touches a historical task\'s own commit or persisted result', async () => {
    await readyForRepair();
    const t001Sha = resolveCommitSha(root, { milestone: 'M001', task: 'T001' });
    expect(t001Sha).toBeDefined();
    const t001Before = loadTasks(root, 'M001').tasks.find((t) => t.id === 'T001') as Task;

    await approve(['repair-target.txt'], ['CT001'], 'Post-completion fix.');
    writeFileSync(join(root, 'repair-target.txt'), 'FIXED after completion\n');
    const { error } = await commitRepair('VR001');
    expect(error).toBeUndefined();

    expect(resolveCommitSha(root, { milestone: 'M001', task: 'T001' })).toBe(t001Sha);
    expect(loadTasks(root, 'M001').tasks.find((t) => t.id === 'T001')).toEqual(t001Before);
  });
});

describe('pitway verification-repair cancel', () => {
  it('cancels a pending VR', async () => {
    await readyForRepair();
    await approve(['repair-target.txt'], ['CT001']);
    const { lines, error } = await cancelRepair('VR001');
    expect(error).toBeUndefined();
    const view = JSON.parse(lines[0]!) as { id: string; status: string };
    expect(view).toMatchObject({ id: 'VR001', status: 'cancelled' });
    expect(repairs().records[0]!.status).toBe('cancelled');
  });

  it('refuses to cancel a VR that is not pending', async () => {
    await readyForRepair();
    await approve(['repair-target.txt'], ['CT001']);
    writeFileSync(join(root, 'repair-target.txt'), 'FIXED yet again\n');
    expect((await commitRepair('VR001')).error).toBeUndefined();

    const { error } = await cancelRepair('VR001');
    expect(error?.message).toMatch(/not pending/);
  });

  it('allows approving a new VR after cancelling the pending one', async () => {
    await readyForRepair();
    await approve(['repair-target.txt'], ['CT001'], 'First rationale.');
    expect((await cancelRepair('VR001')).error).toBeUndefined();

    const { lines, error } = await approve(['repair-target.txt'], ['CT001'], 'Second rationale.');
    expect(error).toBeUndefined();
    const view = JSON.parse(lines[0]!) as { id: string };
    expect(view.id).toBe('VR002'); // durable ids, never reused
    expect(repairs().records.map((r) => r.status)).toEqual(['cancelled', 'pending']);
  });
});

describe('pitway milestone-complete gate on pending verification repairs', () => {
  it('refuses milestone-complete while pending, succeeds once the VR is committed', async () => {
    await readyForRepair();
    await approve(['repair-target.txt'], ['CT001'], 'Fix the regression.');

    const blocked = await run(['milestone-complete', 'M001'], root);
    expect(blocked.error?.message).toMatch(/VR001/);
    expect(blocked.error?.message).toMatch(/pending/);

    writeFileSync(join(root, 'repair-target.txt'), 'FIXED before completion\n');
    expect((await commitRepair('VR001')).error).toBeUndefined();

    const { error } = await run(['milestone-complete', 'M001'], root);
    expect(error).toBeUndefined();
  });

  it('refuses milestone-complete while pending, succeeds once the VR is cancelled', async () => {
    await readyForRepair();
    await approve(['repair-target.txt'], ['CT001'], 'Investigate a false alarm.');

    const blocked = await run(['milestone-complete', 'M001'], root);
    expect(blocked.error?.message).toMatch(/pending/);

    expect((await cancelRepair('VR001')).error).toBeUndefined();
    const { error } = await run(['milestone-complete', 'M001'], root);
    expect(error).toBeUndefined();
    // The cancelled repair's uncommitted status write rides along in the
    // completion commit rather than being left permanently dirty.
    expect(headFiles(root)).toContain(verificationRepairsPath());
    expect(git(['status', '--porcelain'], root).trim()).toBe('');
  });
});

describe('pitway verification-repair structurally refuses reserved targets', () => {
  it('rejects contract.md/tasks.yaml/state.yaml even when passed alongside a valid file', async () => {
    await readyForRepair();
    const { error } = await approve(['repair-target.txt', tasksYamlPath()], ['CT001']);
    expect(error?.message).toMatch(/tasks\.yaml/);
    expect(repairs().records).toHaveLength(0);
  });
});
