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
import { resolveCanonicalGitDir } from '../../src/git/paths.js';
import {
  recordCheckResult,
  runSingleCheck,
  runVerification,
  VerifyError,
} from '../../src/core/verification/run.js';
import {
  loadContract,
  loadState,
  loadTasks,
  loadVerificationRepairs,
  loadVerificationResults,
  saveState,
  saveVerificationRepairs,
} from '../../src/state/store.js';
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

  it('requires --change-log', async () => {
    await readyForRepair();
    const { error } = await run(
      ['verification-repair', 'approve', 'M001', '--file', 'repair-target.txt', '--check', 'CT001', '--json'],
      root,
    );
    expect(error?.message).toMatch(/--change-log/);
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

// CommandDeps.root/write both fall back (process.cwd() / console.log) when
// omitted -- real behavior no other describe block exercises, since every
// other test explicitly supplies both via run()'s deps. Also the only place
// exercising the two human-readable (non --json) renderCommitHuman branches:
// every commitRepair() call above passes --json, so neither the
// "committed" nor the "already-committed" human sentence is ever produced
// elsewhere.
describe('pitway verification-repair CLI wiring (deps.root/deps.write fallbacks, human-readable output)', () => {
  async function runWithDefaultDeps(args: string[]): Promise<{ lines: string[]; error?: Error }> {
    const program = buildCli();
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = ((line: string) => lines.push(line)) as typeof console.log;
    registerVerificationRepairCommand(program, {});
    try {
      await program.parseAsync(['node', 'pitway', ...args]);
      return { lines };
    } catch (error) {
      return { lines, error: error as Error };
    } finally {
      console.log = originalLog;
    }
  }

  it('defaults deps.root to process.cwd() and deps.write to console.log, rendering both commit outcomes as human-readable text', async () => {
    await readyForRepair();
    const originalCwd = process.cwd();
    process.chdir(root);
    try {
      const approved = await runWithDefaultDeps([
        'verification-repair',
        'approve',
        'M001',
        '--file',
        'repair-target.txt',
        '--check',
        'CT001',
        '--change-log',
        'Fix it via default deps.',
      ]);
      expect(approved.error).toBeUndefined();
      expect(approved.lines[0]).toMatch(/Approved verification repair VR001 for M001/);

      writeFileSync(join(root, 'repair-target.txt'), 'FIXED default deps\n');
      const committed = await runWithDefaultDeps(['verification-repair', 'commit', 'M001', 'VR001']);
      expect(committed.error).toBeUndefined();
      expect(committed.lines[0]).toMatch(/^🔧 Committed verification repair VR001 for M001 at /);

      const again = await runWithDefaultDeps(['verification-repair', 'commit', 'M001', 'VR001']);
      expect(again.error).toBeUndefined();
      expect(again.lines[0]).toMatch(/^🔧 Verification repair VR001 already committed at /);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('defaults deps.root to process.cwd() for cancel and renders human-readable output', async () => {
    await readyForRepair();
    await approve(['repair-target.txt'], ['CT001'], 'Investigate via default deps.');
    const originalCwd = process.cwd();
    process.chdir(root);
    try {
      const cancelled = await runWithDefaultDeps(['verification-repair', 'cancel', 'M001', 'VR001']);
      expect(cancelled.error).toBeUndefined();
      expect(cancelled.lines[0]).toBe('🔧 Cancelled verification repair VR001 for M001.');
      expect(repairs().records[0]!.status).toBe('cancelled');
    } finally {
      process.chdir(originalCwd);
    }
  });
});

describe('pitway verification-repair edge validation and ambiguous states', () => {
  it('rejects a whitespace-only --change-log in Core, not just at the CLI flag layer', async () => {
    await readyForRepair();
    const { error } = await approve(['repair-target.txt'], ['CT001'], '   ');
    expect(error?.message).toMatch(/--change-log requires non-empty text/);
    expect(repairs().records).toHaveLength(0);
  });

  it('refuses commit and cancel for an unknown VR id', async () => {
    await readyForRepair();
    const committed = await commitRepair('VR999');
    expect(committed.error?.message).toMatch(/unknown verification repair VR999/);
    const cancelled = await cancelRepair('VR999');
    expect(cancelled.error?.message).toMatch(/unknown verification repair VR999/);
  });

  it('refuses to commit a cancelled VR', async () => {
    await readyForRepair();
    await approve(['repair-target.txt'], ['CT001']);
    expect((await cancelRepair('VR001')).error).toBeUndefined();
    const { error } = await commitRepair('VR001');
    expect(error?.message).toMatch(/cannot commit VR001: status is "cancelled"/);
  });

  it('refuses as ambiguous a VR recorded committed with no matching commit anywhere', async () => {
    await readyForRepair();
    await approve(['repair-target.txt'], ['CT001'], 'Fix it.');
    // Simulate a corrupted local state: the record claims committed but no
    // commit carrying the VR trailers exists in history.
    const record = repairs().records[0]!;
    saveVerificationRepairs(root, 'M001', {
      schema_version: 1,
      records: [{ ...record, status: 'committed' }],
    });
    const { error } = await commitRepair('VR001');
    expect(error?.message).toMatch(/recorded as committed but no matching commit was found/);
  });

  it('cancels the right record when several VRs exist, leaving the others untouched', async () => {
    await readyForRepair();
    await approve(['repair-target.txt'], ['CT001'], 'First rationale.');
    expect((await cancelRepair('VR001')).error).toBeUndefined();
    await approve(['repair-target.txt'], ['CT001'], 'Second rationale.');
    expect((await cancelRepair('VR002')).error).toBeUndefined();

    expect(repairs().records.map((r) => ({ id: r.id, status: r.status }))).toEqual([
      { id: 'VR001', status: 'cancelled' },
      { id: 'VR002', status: 'cancelled' },
    ]);
    expect(repairs().records[0]!.change_log).toBe('First rationale.');
  });

  it('commits a repair on a branch-tracked milestone (base_revision bounds the trailer search)', async () => {
    // branch_strategy: milestone makes milestone-confirm record base_branch/
    // base_revision and work on a dedicated milestone branch -- the bounded
    // since..HEAD search path in findRepairCommit.
    writeFileSync(
      join(root, '.pitway', 'config.yaml'),
      'schema_version: 1\ngit:\n  branch_strategy: milestone\n',
    );
    await readyForRepair();
    expect(loadContract(root, 'M001').frontmatter.base_revision).toBeTruthy();

    await approve(['repair-target.txt'], ['CT001'], 'Branch-tracked fix.');
    writeFileSync(join(root, 'repair-target.txt'), 'FIXED on branch\n');
    const { lines, error } = await commitRepair('VR001');
    expect(error).toBeUndefined();
    expect((JSON.parse(lines[0]!) as { outcome: string }).outcome).toBe('committed');

    // Idempotent re-entry still resolves through the bounded search.
    const again = await commitRepair('VR001');
    expect(again.error).toBeUndefined();
    expect((JSON.parse(again.lines[0]!) as { outcome: string }).outcome).toBe('already-committed');
  });
});

// Core run.ts paths this file's own repositories are the natural home for:
// milestone resolution, the hash gate, the recursion guard's env mechanics,
// and per-check evidence fallbacks for every termination reason.
describe('runVerification / runSingleCheck / recordCheckResult (core paths)', () => {
  const GUARD_ENV_VAR = 'PITWAY_VERIFY_GUARD';

  // Every command check here is cheap and controls its own outcome: CT001
  // fails loudly (summary path), CT002 times out silently, CT003 kills its
  // own shell, CT004 exits nonzero with no output, CT005 stays manual.
  const RUN_CONTRACT = `---
schema_version: 1
id: M999
title: Run coverage milestone
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
    command: node -e "console.log('FAIL boom'); process.exit(1)"
  - id: CT002
    criterion: AC001
    type: command
    command: sleep 5
    timeout_ms: 300
  - id: CT003
    criterion: AC001
    type: command
    command: kill -KILL $$
  - id: CT004
    criterion: AC001
    type: command
    command: node -e "process.exit(3)"
  - id: CT005
    criterion: AC001
    type: manual
    instruction: Check the docs.
---

# Contract

## Objective

Run-path coverage.

## Change Log
`;

  async function addMilestone(contractText: string, confirm: boolean): Promise<void> {
    const contract = join(root, 'draft-contract.md');
    const tasks = join(root, 'draft-tasks.yaml');
    writeFileSync(contract, contractText);
    writeFileSync(tasks, TASKS_FIXTURE);
    const added = await run(['milestone-add', '--contract', contract, '--tasks', tasks], root);
    expect(added.error).toBeUndefined();
    rmSync(contract);
    rmSync(tasks);
    if (confirm) {
      const confirmed = await run(['milestone-confirm', 'M001'], root);
      expect(confirmed.error).toBeUndefined();
    }
  }

  it('refuses when no milestone id is given and none is active', () => {
    expect(() => runVerification(root)).toThrowError(VerifyError);
    expect(() => runVerification(root)).toThrowError(/no active milestone/);
  });

  it('refuses an unconfirmed milestone: no approved verification hash yet', async () => {
    await addMilestone(CONTRACT_FIXTURE, false);
    expect(() => runVerification(root, 'M001')).toThrowError(
      /no approved verification hash recorded/,
    );
  });

  it('refuses when the verification block was edited after approval (hash gate)', async () => {
    await addMilestone(CONTRACT_FIXTURE, true);
    const path = join(root, contractPath());
    writeFileSync(
      path,
      readFileSync(path, 'utf8').replace('repair-target.txt', 'tampered-target.txt'),
    );
    expect(() => runVerification(root, 'M001')).toThrowError(
      /does not match the approved hash .*milestone-confirm M001 --amend/s,
    );
  });

  it('resolves the active milestone by default and reports per-termination-reason evidence fallbacks', async () => {
    await addMilestone(RUN_CONTRACT, true);

    // No explicit milestone id: resolved from state.active_milestone.
    const view = runVerification(root);
    expect(view.id).toBe('M001');
    expect(view.passed).toBe(false);
    expect(view.pending).toEqual(['CT005']);

    const byCheck = new Map(view.results.map((r) => [r.check, r.evidence]));
    // CT001: failing output matching the failure patterns gets the
    // `failures:` summary prepended ahead of the tail-trimmed output.
    expect(byCheck.get('CT001')).toMatch(/^failures: FAIL boom/);
    // CT002-CT004: no output at all, so evidence is the per-reason fallback.
    expect(byCheck.get('CT002')).toBe('(no output; timed out)');
    expect(byCheck.get('CT003')).toBe('(no output; killed by signal)');
    expect(byCheck.get('CT004')).toBe('(no output; exit 3)');

    // Every command outcome was persisted append-only, in contract order.
    const persisted = loadVerificationResults(root, 'M001').results;
    expect(persisted.map((r) => r.check)).toEqual(['CT001', 'CT002', 'CT003', 'CT004']);
    expect(persisted.map((r) => r.termination_reason)).toEqual([
      'exited',
      'timeout',
      'signal',
      'exited',
    ]);
  });

  it('refuses recursive verification of the same repo+milestone via the inherited guard token', async () => {
    await addMilestone(CONTRACT_FIXTURE, true);
    const token = `${resolveCanonicalGitDir(root)}#M001`;
    const previous = process.env[GUARD_ENV_VAR];
    process.env[GUARD_ENV_VAR] = token;
    try {
      expect(() => runVerification(root, 'M001')).toThrowError(
        /already being verified by an ancestor process/,
      );
      // Refused before extending: the guard value is untouched.
      expect(process.env[GUARD_ENV_VAR]).toBe(token);
    } finally {
      if (previous === undefined) delete process.env[GUARD_ENV_VAR];
      else process.env[GUARD_ENV_VAR] = previous;
    }
  });

  it('extends past an unrelated in-flight token and restores it afterwards', async () => {
    await addMilestone(CONTRACT_FIXTURE, true);
    const unrelated = '/elsewhere#M999';
    const previous = process.env[GUARD_ENV_VAR];
    process.env[GUARD_ENV_VAR] = unrelated;
    try {
      seedRepairTarget();
      const view = runSingleCheck(root, 'M001', 'CT001');
      expect(view.status).toBe('pass');
      // The unrelated token survives: restored, not deleted.
      expect(process.env[GUARD_ENV_VAR]).toBe(unrelated);
    } finally {
      if (previous === undefined) delete process.env[GUARD_ENV_VAR];
      else process.env[GUARD_ENV_VAR] = previous;
    }
  });

  it('runSingleCheck refuses an unknown check id and a non-command check', async () => {
    await addMilestone(CONTRACT_FIXTURE, true);
    expect(() => runSingleCheck(root, 'M001', 'CT999')).toThrowError(/unknown check CT999 in M001/);
    expect(() => runSingleCheck(root, 'M001', 'CT002')).toThrowError(
      /CT002 is a manual check; record it with --pass\/--fail/,
    );
  });

  it('recordCheckResult refuses an unknown check, a command check, and empty evidence', async () => {
    await addMilestone(CONTRACT_FIXTURE, true);
    expect(() =>
      recordCheckResult(root, 'M001', { check: 'CT999', status: 'pass', evidence: 'x' }),
    ).toThrowError(/unknown check CT999 in M001/);
    expect(() =>
      recordCheckResult(root, 'M001', { check: 'CT001', status: 'pass', evidence: 'x' }),
    ).toThrowError(/CT001 is a command check; run bare "pitway verify"/);
    expect(() =>
      recordCheckResult(root, 'M001', { check: 'CT002', status: 'pass', evidence: '   ' }),
    ).toThrowError(/requires non-empty --evidence/);
  });
});

// M036/T002: the racing footer on approve/commit/cancel, guarded to the
// active milestone (all three take an explicit milestone argument).
describe('pitway verification-repair racing footer (M036/T002)', () => {
  it('appends the footer for approve/commit against the active milestone', async () => {
    await readyForRepair();
    const approved = await run(
      ['verification-repair', 'approve', 'M001', '--file', 'repair-target.txt', '--check', 'CT001', '--change-log', 'Fix.'],
      root,
    );
    expect(approved.error).toBeUndefined();
    expect(approved.lines[approved.lines.length - 1]).toMatch(/🏎️|🏁|🔧/);

    seedRepairTarget('FIXED AGAIN\n');
    git(['add', 'repair-target.txt'], root);
    const committed = await run(['verification-repair', 'commit', 'M001', 'VR001'], root);
    expect(committed.error).toBeUndefined();
    expect(committed.lines[committed.lines.length - 1]).toMatch(/🏎️|🏁|🔧/);
  });

  it('appends the footer for cancel against the active milestone', async () => {
    await readyForRepair();
    await run(
      ['verification-repair', 'approve', 'M001', '--file', 'repair-target.txt', '--check', 'CT001', '--change-log', 'Fix.'],
      root,
    );
    const cancelled = await run(['verification-repair', 'cancel', 'M001', 'VR001'], root);
    expect(cancelled.error).toBeUndefined();
    expect(cancelled.lines[cancelled.lines.length - 1]).toMatch(/🏎️|🏁|🔧/);
  });

  it('never appends a footer for a milestone other than the active one', async () => {
    await readyForRepair();
    saveState(root, { ...loadState(root), active_milestone: 'M999' });
    const approved = await run(
      ['verification-repair', 'approve', 'M001', '--file', 'repair-target.txt', '--check', 'CT001', '--change-log', 'Fix.'],
      root,
    );
    expect(approved.error).toBeUndefined();
    expect(approved.lines).toHaveLength(1);
  });

  it('never appends a footer line in --json mode', async () => {
    await readyForRepair();
    const { error, lines } = await approve(['repair-target.txt'], ['CT001']);
    expect(error).toBeUndefined();
    expect(lines).toHaveLength(1);
  });
});
