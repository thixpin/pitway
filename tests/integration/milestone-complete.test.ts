import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCli } from '../../src/cli/index.js';
import { registerInitCommand } from '../../src/cli/commands/init.js';
import { registerMilestoneAddCommand } from '../../src/cli/commands/milestone-add.js';
import { registerMilestoneCompleteCommand } from '../../src/cli/commands/milestone-complete.js';
import { registerMilestoneConfirmCommand } from '../../src/cli/commands/milestone-confirm.js';
import { registerTaskUpdateCommand } from '../../src/cli/commands/task-update.js';
import { registerVerifyCommand } from '../../src/cli/commands/verify.js';
import { loadConfig, loadContract, loadState, saveConfig } from '../../src/state/store.js';
import { deterministicBranchName } from '../../src/core/milestones/confirm.js';
import { recordUsage } from '../../src/core/metrics/aggregate.js';
import { derivePending } from '../../src/core/journal/operations.js';
import { readJournal } from '../../src/state/journal.js';

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

// Cheap fixture commands only — never npm (running the real contract's
// commands from inside the test suite would recurse).
const CONTRACT_FIXTURE = `---
schema_version: 1
id: M999
title: Completable milestone
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
    command: echo hello
  - id: CT002
    criterion: AC001
    type: command
    command: echo ok
  - id: CT003
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
  - id: T002
    objective: Second task.
    status: planned
    depends_on: [T001]
    acceptance_criteria:
      - It also works
    relevant_files:
      - src/b.ts
    verification:
      strategy: tdd
      detail: npm test
    result: null
    usage: null
`;

// The naturally dirty completion set: contract.md (status write), tasks.yaml
// (task completion), verification-results.yaml (verify), state.yaml (active
// milestone cleared). usage.yaml is expected too but only staged when dirty.
function milestoneDirName(id: string): string {
  const dir = join(root, '.pitway', 'milestones');
  const match = readdirSync(dir).find((e) => e === id || e.startsWith(`${id}-`));
  if (!match) throw new Error(`no milestone directory found for ${id}`);
  return match;
}

const milestoneRelFile = (file: string): string =>
  `.pitway/milestones/${milestoneDirName('M001')}/${file}`;

const expectedCompletionFiles = (): string[] =>
  [
    milestoneRelFile('contract.md'),
    milestoneRelFile('tasks.yaml'),
    milestoneRelFile('verification-results.yaml'),
    '.pitway/state.yaml',
  ].sort();

async function run(args: string[], cwd: string): Promise<{ lines: string[]; error?: Error }> {
  const program = buildCli();
  const lines: string[] = [];
  registerInitCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerMilestoneAddCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerMilestoneConfirmCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerMilestoneCompleteCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerVerifyCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerTaskUpdateCommand(program, { root: cwd, write: (s) => lines.push(s) });
  try {
    await program.parseAsync(['node', 'pitway', ...args]);
    return { lines };
  } catch (error) {
    return { lines, error: error as Error };
  }
}

async function confirmed(): Promise<void> {
  const contract = join(root, 'draft-contract.md');
  const tasks = join(root, 'draft-tasks.yaml');
  writeFileSync(contract, CONTRACT_FIXTURE);
  writeFileSync(tasks, TASKS_FIXTURE);
  const added = await run(['milestone-add', '--contract', contract, '--tasks', tasks], root);
  expect(added.error).toBeUndefined();
  rmSync(contract);
  rmSync(tasks);
  const { error } = await run(['milestone-confirm', 'M001'], root);
  expect(error).toBeUndefined();
}

const milestoneFile = (file: string): string =>
  join(root, '.pitway', 'milestones', milestoneDirName('M001'), file);

function taskEntry(id: string, dependsOn: string, status: string): string {
  const result =
    status === 'completed'
      ? '    result:\n      summary: Done.\n      evidence: tests pass\n'
      : '    result: null\n';
  return `  - id: ${id}
    objective: Task ${id}.
    status: ${status}
    depends_on: [${dependsOn}]
    acceptance_criteria:
      - It works
    relevant_files:
      - src/a.ts
    verification:
      strategy: tdd
      detail: npm test
${result}    usage: null
`;
}

function writeTaskStatuses(t1Status: string, t2Status: string): void {
  writeFileSync(
    milestoneFile('tasks.yaml'),
    `schema_version: 1\ntasks:\n${taskEntry('T001', '', t1Status)}${taskEntry('T002', 'T001', t2Status)}`,
  );
}

async function recordAllChecks(): Promise<void> {
  const runResult = await run(['verify', 'M001'], root);
  expect(runResult.error).toBeUndefined();
  const record = await run(
    ['verify', 'M001', '--check', 'CT003', '--pass', '--evidence', 'docs reviewed'],
    root,
  );
  expect(record.error).toBeUndefined();
}

// Arranges a milestone where every completion gate is satisfied.
async function readyToComplete(): Promise<void> {
  await confirmed();
  writeTaskStatuses('completed', 'completed');
  await recordAllChecks();
}

async function completed(): Promise<void> {
  await readyToComplete();
  const { error } = await run(['milestone-complete', 'M001'], root);
  expect(error).toBeUndefined();
}

function editContract(transform: (text: string) => string): void {
  writeFileSync(milestoneFile('contract.md'), transform(readFileSync(milestoneFile('contract.md'), 'utf8')));
}

function installFailingHook(): string {
  const hook = join(root, '.git', 'hooks', 'pre-commit');
  writeFileSync(hook, '#!/bin/sh\nexit 1\n');
  chmodSync(hook, 0o755);
  return hook;
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'pitway-mcomp-'));
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
});

describe('milestone-complete auto-closes promoted backlog items whose work completed (B024)', () => {
  function writeBacklog(items: string): void {
    writeFileSync(
      join(root, '.pitway', 'backlog.yaml'),
      `schema_version: 1\nitems:\n${items}`,
    );
  }

  it('auto-archives a promoted item whose target task completed in this milestone', async () => {
    await confirmed();
    writeTaskStatuses('completed', 'cancelled');
    await recordAllChecks();
    writeBacklog(
      [
        '  - id: B001',
        '    title: Promoted and finished',
        "    reason: Discovered mid-flight.",
        '    status: promoted',
        '    source:',
        '      milestone: M001',
        '      task: null',
        '    created_at: 2026-08-23T00:00:00Z',
        '    resolved_at: 2026-08-23T00:00:01Z',
        '    promoted_to:',
        '      milestone: M001',
        '      task: T001',
        '    archived_reason: null',
      ].join('\n') + '\n',
    );
    git(['add', '.pitway/backlog.yaml'], root);
    git(['commit', '-q', '-m', 'seed backlog'], root);

    const before = commitCount(root);
    const { error } = await run(['milestone-complete', 'M001'], root);
    expect(error).toBeUndefined();

    const backlogText = readFileSync(join(root, '.pitway', 'backlog.yaml'), 'utf8');
    expect(backlogText).toMatch(/id: B001[\s\S]*status: archived/);
    expect(backlogText).toMatch(/auto-closed: promoted work completed via M001 completion/);
    // The auto-close rides the completion commit -- no extra commit, tree clean.
    expect(commitCount(root)).toBe(before + 1);
    expect(headFiles(root)).toContain('.pitway/backlog.yaml');
    // Journal entry checkpointed by the same commit.
    const pending = derivePending(readJournal(root));
    expect(pending.filter((e) => e.type === 'backlog_recording')).toHaveLength(0);
  });

  it('keeps a promoted item whose target task did not complete (cancelled work stays for triage)', async () => {
    await confirmed();
    // T001 completes; T002 is cancelled -- the only way a target task can be
    // not-completed at a successful completion gate.
    writeTaskStatuses('completed', 'cancelled');
    await recordAllChecks();
    writeBacklog(
      [
        '  - id: B001',
        '    title: Promoted but unfinished',
        "    reason: Discovered.",
        '    status: promoted',
        '    source:',
        '      milestone: M001',
        '      task: null',
        '    created_at: 2026-08-23T00:00:00Z',
        '    resolved_at: 2026-08-23T00:00:01Z',
        '    promoted_to:',
        '      milestone: M001',
        '      task: T002',
        '    archived_reason: null',
      ].join('\n') + '\n',
    );
    git(['add', '.pitway/backlog.yaml'], root);
    git(['commit', '-q', '-m', 'seed backlog'], root);

    const { error } = await run(['milestone-complete', 'M001'], root);
    expect(error).toBeUndefined();
    const backlogText = readFileSync(join(root, '.pitway', 'backlog.yaml'), 'utf8');
    expect(backlogText).toMatch(/status: promoted/);
    expect(backlogText).not.toMatch(/auto-closed/);
  });

  it('leaves unrelated pending items untouched', async () => {
    await confirmed();
    writeTaskStatuses('completed', 'cancelled');
    await recordAllChecks();
    writeBacklog(
      [
        '  - id: B001',
        '    title: Still pending',
        "    reason: Deferred.",
        '    status: pending',
        '    source:',
        '      milestone: M001',
        '      task: null',
        '    created_at: 2026-08-23T00:00:00Z',
        '    resolved_at: null',
        '    promoted_to: null',
        '    archived_reason: null',
      ].join('\n') + '\n',
    );
    git(['add', '.pitway/backlog.yaml'], root);
    git(['commit', '-q', '-m', 'seed backlog'], root);

    const { error } = await run(['milestone-complete', 'M001'], root);
    expect(error).toBeUndefined();
    expect(readFileSync(join(root, '.pitway', 'backlog.yaml'), 'utf8')).toMatch(/status: pending/);
  });
});

describe('pitway milestone-complete gates (AC005)', () => {
  it('refuses a milestone that is not in_progress', async () => {
    const contract = join(root, 'draft-contract.md');
    const tasks = join(root, 'draft-tasks.yaml');
    writeFileSync(contract, CONTRACT_FIXTURE);
    writeFileSync(tasks, TASKS_FIXTURE);
    await run(['milestone-add', '--contract', contract, '--tasks', tasks], root);
    rmSync(contract);
    rmSync(tasks);
    const { error } = await run(['milestone-complete', 'M001'], root);
    expect(error?.message).toMatch(/draft/);
    expect(commitCount(root)).toBe(1);
  });

  it('refuses when non-cancelled tasks are not completed, naming exactly those tasks', async () => {
    await confirmed();
    writeTaskStatuses('completed', 'in_progress');
    await recordAllChecks();
    const { error } = await run(['milestone-complete', 'M001'], root);
    expect(error?.message).toMatch(/T002/);
    expect(error?.message).not.toMatch(/\bT001\b/);
    // in_progress is not review/blocked/failed: no recovery command appended.
    expect(error?.message).toContain('T002 (in_progress)');
    expect(error?.message).not.toContain('task-update');
    expect(loadContract(root, 'M001').frontmatter.status).toBe('in_progress');
    expect(loadState(root).active_milestone).toBe('M001');
    expect(commitCount(root)).toBe(2);
  });

  it("names 'task-update <id> completed' for a review-status task", async () => {
    await confirmed();
    writeTaskStatuses('review', 'completed');
    const { error } = await run(['milestone-complete', 'M001'], root);
    expect(error?.message).toContain('T001 (review) -- run task-update T001 completed');
  });

  it("names 'task-update <id> ready' for blocked or failed task statuses", async () => {
    await confirmed();
    writeTaskStatuses('blocked', 'failed');
    const { error } = await run(['milestone-complete', 'M001'], root);
    expect(error?.message).toContain('T001 (blocked) -- run task-update T001 ready');
    expect(error?.message).toContain('T002 (failed) -- run task-update T002 ready');
  });

  it('does not count cancelled tasks against completion', async () => {
    await confirmed();
    writeTaskStatuses('completed', 'cancelled');
    await recordAllChecks();
    const { error } = await run(['milestone-complete', 'M001'], root);
    expect(error).toBeUndefined();
    expect(loadContract(root, 'M001').frontmatter.status).toBe('completed');
  });

  it('refuses when a check has no recorded result, naming exactly that check with its recovery command', async () => {
    await confirmed();
    writeTaskStatuses('completed', 'completed');
    // Command checks run and pass; CT003 (type: manual) is never recorded.
    const verify = await run(['verify', 'M001'], root);
    expect(verify.error).toBeUndefined();
    const { error } = await run(['milestone-complete', 'M001'], root);
    expect(error?.message).toContain(
      'CT003 -- run pitway verify M001 --check CT003 --pass|--fail --evidence <text>',
    );
    expect(error?.message).not.toMatch(/CT001/);
    expect(error?.message).not.toMatch(/CT002/);
    expect(loadContract(root, 'M001').frontmatter.status).toBe('in_progress');
    expect(commitCount(root)).toBe(2);
  });

  it('refuses when a command-type check has no recorded result, naming the plain verify command', async () => {
    await confirmed();
    writeTaskStatuses('completed', 'completed');
    // Only the manual check is recorded; CT001/CT002 (type: command) are not.
    const record = await run(
      ['verify', 'M001', '--check', 'CT003', '--pass', '--evidence', 'docs reviewed'],
      root,
    );
    expect(record.error).toBeUndefined();
    const { error } = await run(['milestone-complete', 'M001'], root);
    expect(error?.message).toContain('CT001 -- run pitway verify M001');
    expect(error?.message).toContain('CT002 -- run pitway verify M001');
    expect(error?.message).not.toContain('--check');
  });

  it('refuses when the latest result for a check is fail; a later pass unblocks', async () => {
    await confirmed();
    writeTaskStatuses('completed', 'completed');
    await recordAllChecks();
    const fail = await run(
      ['verify', 'M001', '--check', 'CT003', '--fail', '--evidence', 'docs regressed'],
      root,
    );
    expect(fail.error).toBeUndefined();

    const refused = await run(['milestone-complete', 'M001'], root);
    expect(refused.error?.message).toContain(
      'CT003 -- run pitway verify M001 --check CT003 --pass|--fail --evidence <text>',
    );
    expect(refused.error?.message).not.toMatch(/CT001/);
    expect(loadContract(root, 'M001').frontmatter.status).toBe('in_progress');

    // Latest entry per check is authoritative: a later pass clears the gate.
    await run(['verify', 'M001', '--check', 'CT003', '--pass', '--evidence', 'docs fixed'], root);
    const { error } = await run(['milestone-complete', 'M001'], root);
    expect(error).toBeUndefined();
    expect(loadContract(root, 'M001').frontmatter.status).toBe('completed');
  });

  it('names missing tasks and unrecorded checks together in one diagnostic', async () => {
    await confirmed();
    writeTaskStatuses('completed', 'ready');
    const { error } = await run(['milestone-complete', 'M001'], root);
    expect(error?.message).toMatch(/T002/);
    expect(error?.message).toMatch(/CT001/);
    expect(error?.message).toMatch(/CT002/);
    expect(error?.message).toMatch(/CT003/);
    // \b keeps CT001 (a named check) from matching as T001.
    expect(error?.message).not.toMatch(/\bT001\b/);
    expect(commitCount(root)).toBe(2);
  });
});

describe('pitway milestone-complete success (AC006)', () => {
  it('completes the milestone, clears active_milestone, and commits the exact file set', async () => {
    await readyToComplete();
    const { lines, error } = await run(['milestone-complete', 'M001', '--json'], root);
    expect(error).toBeUndefined();

    const view = JSON.parse(lines[0]!) as { id: string; outcome: string; commit: string };
    expect(view.id).toBe('M001');
    expect(view.outcome).toBe('committed');
    expect(view.commit).toBe(git(['rev-parse', 'HEAD'], root).trim());

    expect(loadContract(root, 'M001').frontmatter.status).toBe('completed');
    expect(loadState(root).active_milestone).toBeNull();

    expect(headFiles(root)).toEqual(expectedCompletionFiles());
    const message = headMessage(root);
    expect(message.startsWith('workflow: complete milestone M001')).toBe(true);
    expect(message).toContain('PitWay-Milestone: M001');
    expect(message).not.toMatch(/PitWay-Task/);
    expect(git(['status', '--porcelain'], root).trim()).toBe('');
    expect(commitCount(root)).toBe(3);
  });

  it('includes usage.yaml in the commit when it is dirty', async () => {
    await readyToComplete();
    writeFileSync(
      milestoneFile('usage.yaml'),
      'schema_version: 1\nplanning:\n  attempts: 1\n  total_tokens: 100\nqa: null\n',
    );
    const { error } = await run(['milestone-complete', 'M001'], root);
    expect(error).toBeUndefined();
    expect(headFiles(root)).toEqual(
      [...expectedCompletionFiles(), milestoneRelFile('usage.yaml')].sort(),
    );
    expect(git(['status', '--porcelain'], root).trim()).toBe('');
  });

  it('leaves active_milestone untouched when it points at another milestone', async () => {
    await readyToComplete();
    const statePath = join(root, '.pitway', 'state.yaml');
    writeFileSync(
      statePath,
      readFileSync(statePath, 'utf8').replace('active_milestone: M001', 'active_milestone: M002'),
    );
    const { error } = await run(['milestone-complete', 'M001'], root);
    expect(error).toBeUndefined();
    expect(loadState(root).active_milestone).toBe('M002');
    expect(loadContract(root, 'M001').frontmatter.status).toBe('completed');
  });

  it('refuses unexpected dirty paths naming them, writing and staging nothing', async () => {
    await readyToComplete();
    writeFileSync(join(root, 'wip.txt'), 'wip\n');
    const stagedBefore = git(['diff', '--cached', '--name-only'], root);
    const { error } = await run(['milestone-complete', 'M001'], root);
    expect(error?.message).toMatch(/wip\.txt/);
    expect(loadContract(root, 'M001').frontmatter.status).toBe('in_progress');
    expect(loadState(root).active_milestone).toBe('M001');
    expect(git(['diff', '--cached', '--name-only'], root)).toBe(stagedBefore);
    expect(commitCount(root)).toBe(2);
  });
});

describe('pitway milestone-complete re-entry (AC007)', () => {
  it('re-entry after the completion commit landed is idempotent', async () => {
    await completed();
    const before = commitCount(root);
    const { lines, error } = await run(['milestone-complete', 'M001', '--json'], root);
    expect(error).toBeUndefined();
    const view = JSON.parse(lines[0]!) as { outcome: string; commit: string };
    expect(view.outcome).toBe('already-committed');
    expect(view.commit).toBe(git(['rev-parse', 'HEAD'], root).trim());
    expect(commitCount(root)).toBe(before);
  });

  it('resumes the pending completion commit after a hook failure is fixed', async () => {
    await readyToComplete();
    const hook = installFailingHook();
    const { error } = await run(['milestone-complete', 'M001'], root);
    expect(error).toBeDefined();
    // Local state advanced; the git step is what is pending.
    expect(loadContract(root, 'M001').frontmatter.status).toBe('completed');
    expect(loadState(root).active_milestone).toBeNull();
    expect(commitCount(root)).toBe(2);

    rmSync(hook);
    const { lines, error: retryError } = await run(['milestone-complete', 'M001', '--json'], root);
    expect(retryError).toBeUndefined();
    expect((JSON.parse(lines[0]!) as { outcome: string }).outcome).toBe('committed');
    expect(headFiles(root)).toEqual(expectedCompletionFiles());
    const message = headMessage(root);
    expect(message.startsWith('workflow: complete milestone M001')).toBe(true);
    expect(git(['status', '--porcelain'], root).trim()).toBe('');
  });

  it('refuses re-entry with unexpected dirty paths without staging', async () => {
    await readyToComplete();
    const hook = installFailingHook();
    await run(['milestone-complete', 'M001'], root);
    rmSync(hook);
    writeFileSync(join(root, 'wip.txt'), 'wip\n');
    const stagedBefore = git(['diff', '--cached', '--name-only'], root);
    const { error } = await run(['milestone-complete', 'M001'], root);
    expect(error?.message).toMatch(/wip\.txt/);
    expect(git(['diff', '--cached', '--name-only'], root)).toBe(stagedBefore);
    expect(commitCount(root)).toBe(2);
  });

  it('stops with a diagnostic when the completion commit exists but local state is not completed', async () => {
    await completed();
    editContract((text) => text.replace('status: completed', 'status: in_progress'));
    const { error } = await run(['milestone-complete', 'M001'], root);
    expect(error?.message).toMatch(/ambiguous/i);
    expect(commitCount(root)).toBe(3);
  });
});

describe('pitway milestone-complete folds in pending journal entries (M005 T004)', () => {
  it('commits an already-materialized pending usage recording alongside completion and reconciles its checkpoint marker', async () => {
    await readyToComplete();
    recordUsage(root, 'M001', { category: 'planning', usage: '{"total_tokens":99}' });
    // Materialized immediately by usage-add's core, uncommitted.
    expect(git(['status', '--porcelain'], root)).toMatch(/usage\.yaml/);
    expect(derivePending(readJournal(root)).filter((e) => e.type === 'usage_recording')).toHaveLength(1);

    const { error } = await run(['milestone-complete', 'M001'], root);
    expect(error).toBeUndefined();
    expect(loadContract(root, 'M001').frontmatter.status).toBe('completed');
    expect(headFiles(root)).toEqual(
      [...expectedCompletionFiles(), milestoneRelFile('usage.yaml')].sort(),
    );
    expect(git(['status', '--porcelain'], root).trim()).toBe('');

    // Reconciled: the pending entry now has a checkpoint marker.
    expect(derivePending(readJournal(root)).filter((e) => e.type === 'usage_recording')).toHaveLength(0);
  });

  it('reconciles on the already-committed re-entry path too, without disturbing an unrelated still-pending entry', async () => {
    await completed();
    recordUsage(root, 'M001', { category: 'qa', usage: '{"total_tokens":11}' });

    // Re-entry: the milestone is already completed and its commit already
    // exists, so this call takes the already-committed branch.
    const { lines, error } = await run(['milestone-complete', 'M001', '--json'], root);
    expect(error).toBeUndefined();
    expect(JSON.parse(lines[0]!)).toMatchObject({ outcome: 'already-committed' });
    // The usage recording is unrelated to the already-landed completion
    // commit, so reconcilePending correctly leaves it pending rather than
    // guessing it was captured.
    expect(derivePending(readJournal(root)).filter((e) => e.type === 'usage_recording')).toHaveLength(1);
  });
});

// M012/T003 (AC003): the shared commit-branch guard, wired into
// milestone-complete's own commit call. Every test above uses branch_
// strategy: main (the default) -- that is itself the main-strategy
// regression coverage for this AC. T006 adds the merge-ready assertions
// separately; this block only covers the guard.
describe('pitway milestone-complete branch guard (M012/T003)', () => {
  async function confirmedOnBranch(): Promise<void> {
    writeFileSync(
      join(root, '.pitway', 'config.yaml'),
      'schema_version: 1\ngit:\n  branch_strategy: milestone\n',
    );
    await confirmed();
  }

  async function readyToCompleteOnBranch(): Promise<void> {
    await confirmedOnBranch();
    writeTaskStatuses('completed', 'completed');
    await recordAllChecks();
  }

  it('completes while correctly on the milestone branch, unchanged from main-strategy behavior', async () => {
    await readyToCompleteOnBranch();
    const expectedBranch = deterministicBranchName('M001', loadContract(root, 'M001').frontmatter.title);
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], root).trim()).toBe(expectedBranch);

    const { error } = await run(['milestone-complete', 'M001'], root);
    expect(error).toBeUndefined();
    expect(loadContract(root, 'M001').frontmatter.status).toBe('completed');
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], root).trim()).toBe(expectedBranch);
  });

  it('refuses completion after a manual checkout away from the milestone branch, staging and committing nothing', async () => {
    await readyToCompleteOnBranch();
    const startBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'], root).trim();
    const before = commitCount(root);
    git(['checkout', '-b', 'somewhere-else'], root);

    const { error } = await run(['milestone-complete', 'M001'], root);
    expect(error?.message).toMatch(new RegExp(`expected branch ${startBranch}`));
    expect(error?.message).toMatch(/found somewhere-else/);
    expect(loadContract(root, 'M001').frontmatter.status).toBe('in_progress');
    expect(commitCount(root)).toBe(before);
    expect(git(['diff', '--cached', '--name-only'], root).trim()).toBe('');
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], root).trim()).toBe('somewhere-else');
  });
});

// M012/T006 (AC006): merge-ready/PR-ready completion state, proven by
// concrete git-plumbing assertions against a real lifecycle with real task
// commits (writeTaskStatuses is a direct tasks.yaml write with no commit of
// its own, so it can't exercise "exactly baseline + task + completion
// commits" -- this block drives T001/T002 through the real task-update
// completion flow instead).
describe('pitway milestone-complete merge-ready state (M012/T006)', () => {
  const RESULT_FIXTURE = 'summary: Done.\nevidence: tests pass\n';
  const MESSAGE_FIXTURE = 'task: complete\n\nReal work.\n';

  async function confirmedOnBranch(): Promise<string> {
    writeFileSync(
      join(root, '.pitway', 'config.yaml'),
      'schema_version: 1\ngit:\n  branch_strategy: milestone\n',
    );
    const startBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'], root).trim();
    await confirmed();
    return startBranch;
  }

  async function completeTaskForReal(id: string, file: string): Promise<string> {
    // Outside root -- flag input files must never show up as unexpected
    // dirty paths during the in_progress/completion dirty-tree checks.
    const scratch = mkdtempSync(join(tmpdir(), 'pitway-mcomp-t006-'));
    const result = join(scratch, `${id}-result.yaml`);
    const message = join(scratch, `${id}-message.txt`);
    writeFileSync(result, RESULT_FIXTURE);
    writeFileSync(message, MESSAGE_FIXTURE);
    expect((await run(['task-update', id, 'in_progress'], root)).error).toBeUndefined();
    expect((await run(['task-update', id, 'review'], root)).error).toBeUndefined();
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, file), 'export const x = 1;\n');
    const { error } = await run(
      ['task-update', id, 'completed', '--result', result, '--message', message],
      root,
    );
    expect(error).toBeUndefined();
    rmSync(scratch, { recursive: true, force: true });
    return git(['rev-parse', 'HEAD'], root).trim();
  }

  async function fullLifecycleOnBranch(): Promise<{
    baseBranch: string;
    baseRevision: string;
    baselineSha: string;
    taskShas: string[];
    milestoneBranch: string;
  }> {
    const baseBranch = await confirmedOnBranch();
    const contract = loadContract(root, 'M001');
    const baseRevision = contract.frontmatter.base_revision!;
    const baselineSha = git(['rev-parse', 'HEAD'], root).trim();
    const milestoneBranch = deterministicBranchName('M001', contract.frontmatter.title);

    const t1 = await completeTaskForReal('T001', 'src/a.ts');
    const t2 = await completeTaskForReal('T002', 'src/b.ts');
    await recordAllChecks();

    return { baseBranch, baseRevision, baselineSha, taskShas: [t1, t2], milestoneBranch };
  }

  it('reaches a merge-ready state: exactly baseline+task+completion commits, base branch untouched, no merge commit, clean tree', async () => {
    const { baseBranch, baseRevision, baselineSha, taskShas, milestoneBranch } =
      await fullLifecycleOnBranch();
    const baseBranchTipBefore = git(['rev-parse', baseBranch], root).trim();

    const { error } = await run(['milestone-complete', 'M001'], root);
    expect(error).toBeUndefined();
    const completionSha = git(['rev-parse', 'HEAD'], root).trim();

    // Exactly baseline + 2 task commits + completion commit, no more, no fewer.
    const commitsSinceBase = git(
      ['log', '--format=%H', `${baseRevision}..${milestoneBranch}`],
      root,
    )
      .trim()
      .split('\n')
      .filter((l) => l.length > 0);
    expect(commitsSinceBase.sort()).toEqual([baselineSha, ...taskShas, completionSha].sort());

    // Working tree clean.
    expect(git(['status', '--porcelain'], root).trim()).toBe('');

    // The base branch's tip does not contain any milestone commit (nothing merged).
    for (const sha of [baselineSha, ...taskShas, completionSha]) {
      expect(() =>
        git(['merge-base', '--is-ancestor', sha, baseBranch], root),
      ).toThrow();
    }

    // No merge commit anywhere in the milestone branch's history since base_revision.
    const parentCounts = git(
      ['log', '--format=%P', `${baseRevision}..${milestoneBranch}`],
      root,
    )
      .trim()
      .split('\n')
      .map((line) => line.trim().split(/\s+/).filter((p) => p.length > 0).length);
    expect(parentCounts.every((count) => count === 1)).toBe(true);

    // The base branch itself was never touched.
    expect(git(['rev-parse', baseBranch], root).trim()).toBe(baseBranchTipBefore);

    // Still checked out on the milestone branch -- completion never switches.
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], root).trim()).toBe(milestoneBranch);
  });

  it('does not affect main-strategy completion behavior at all (regression)', async () => {
    // Main strategy is now opt-in (Option B init defaults), so this explicit
    // regression sets it directly rather than relying on absence.
    saveConfig(root, { schema_version: 1, git: { branch_strategy: 'main' } });
    await completed();
    const contract = loadContract(root, 'M001');
    expect(contract.frontmatter.base_branch ?? null).toBeNull();
    expect(contract.frontmatter.base_revision ?? null).toBeNull();
  });
});

describe('pitway milestone-complete human rendering', () => {
  it("renders the idempotent re-entry as 'already recorded in' in human output", async () => {
    await completed();
    const { lines, error } = await run(['milestone-complete', 'M001'], root);
    expect(error).toBeUndefined();
    const sha = git(['rev-parse', 'HEAD'], root).trim();
    expect(lines.join('\n')).toBe(
      `🏁 Completed milestone M001: already recorded in commit ${sha}. Run 'pitway milestone-merge M001' only with separate, explicit developer approval -- it is never run automatically.`,
    );
  });

  // T003 (M037): milestone-complete's own output today never mentions
  // milestone-merge at all, since getFooterForActiveMilestone is
  // unreachable here (active_milestone is already cleared to null by the
  // time it runs). This states the gate plainly, human-mode only.
  it('states plainly that milestone-merge needs separate developer approval and is never automatic', async () => {
    await readyToComplete();
    const { lines, error } = await run(['milestone-complete', 'M001'], root);
    expect(error).toBeUndefined();
    expect(lines.join('\n')).toBe(
      "🏁 Completed milestone M001: recorded in commit " +
        git(['rev-parse', 'HEAD'], root).trim() +
        ". Run 'pitway milestone-merge M001' only with separate, explicit developer approval -- it is never run automatically.",
    );
  });

  it('leaves --json output byte-for-byte unchanged (no merge-approval guidance)', async () => {
    await readyToComplete();
    const { lines, error } = await run(['milestone-complete', 'M001', '--json'], root);
    expect(error).toBeUndefined();
    expect(lines).toHaveLength(1);
    const view = JSON.parse(lines[0]!) as { id: string; outcome: string; commit: string };
    expect(Object.keys(view).sort()).toEqual(['commit', 'id', 'outcome']);
    expect(lines[0]).not.toMatch(/milestone-merge/);
  });
});

// The default CommandDeps fallbacks (deps.write ?? console.log,
// deps.root ?? process.cwd()) are only reached when a caller registers the
// command with no overrides -- the real shape a bare `pitway
// milestone-complete` invocation takes outside this test file's harness.
describe('pitway milestone-complete default CommandDeps fallbacks', () => {
  it('falls back to console.log and process.cwd() when no overrides are given', async () => {
    await readyToComplete();

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cwdBefore = process.cwd();
    process.chdir(root);
    let caught: unknown;
    let calls: unknown[][] = [];
    try {
      const program = buildCli();
      registerMilestoneCompleteCommand(program);
      await program.parseAsync(['node', 'pitway', 'milestone-complete', 'M001']);
    } catch (error) {
      caught = error;
    } finally {
      calls = logSpy.mock.calls;
      process.chdir(cwdBefore);
      logSpy.mockRestore();
    }

    expect(caught).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.[0])).toMatch(/🏁 Completed milestone M001: recorded in commit [0-9a-f]{40}\./);
  });
});
