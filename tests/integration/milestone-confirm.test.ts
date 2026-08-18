import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCli } from '../../src/cli/index.js';
import { registerInitCommand } from '../../src/cli/commands/init.js';
import { registerMilestoneAddCommand } from '../../src/cli/commands/milestone-add.js';
import { registerMilestoneConfirmCommand } from '../../src/cli/commands/milestone-confirm.js';
import { computeVerificationHash } from '../../src/core/contracts/verification-hash.js';
import { loadContract, loadTasks } from '../../src/state/store.js';

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

const CONTRACT_FIXTURE = `---
schema_version: 1
id: M999
title: Confirmable milestone
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

const EXPECTED_BASELINE_FILES = [
  '.pitway/config.yaml',
  '.pitway/milestones/M001/contract.md',
  '.pitway/milestones/M001/tasks.yaml',
  '.pitway/milestones/M001/usage.yaml',
  '.pitway/milestones/M001/verification-results.yaml',
  '.pitway/state.yaml',
].sort();

async function run(args: string[], cwd: string): Promise<{ lines: string[]; error?: Error }> {
  const program = buildCli();
  const lines: string[] = [];
  registerInitCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerMilestoneAddCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerMilestoneConfirmCommand(program, { root: cwd, write: (s) => lines.push(s) });
  try {
    await program.parseAsync(['node', 'pitway', ...args]);
    return { lines };
  } catch (error) {
    return { lines, error: error as Error };
  }
}

async function addMilestone(requirement = false): Promise<void> {
  const contract = join(root, 'draft-contract.md');
  const tasks = join(root, 'draft-tasks.yaml');
  writeFileSync(contract, CONTRACT_FIXTURE);
  writeFileSync(tasks, TASKS_FIXTURE);
  const args = ['milestone-add', '--contract', contract, '--tasks', tasks];
  if (requirement) {
    const req = join(root, 'req.md');
    writeFileSync(req, '# Requirement\n\nDo the thing.\n');
    args.push('--requirement', req);
  }
  const { error } = await run(args, root);
  expect(error).toBeUndefined();
  // Draft inputs are scratch files, not part of the baseline set.
  rmSync(contract);
  rmSync(tasks);
  if (requirement) rmSync(join(root, 'req.md'));
}

const contractPath = (): string => join(root, '.pitway', 'milestones', 'M001', 'contract.md');

function editContract(transform: (text: string) => string): void {
  writeFileSync(contractPath(), transform(readFileSync(contractPath(), 'utf8')));
}

function installFailingHook(): string {
  const hook = join(root, '.git', 'hooks', 'pre-commit');
  writeFileSync(hook, '#!/bin/sh\nexit 1\n');
  chmodSync(hook, 0o755);
  return hook;
}

async function confirmed(): Promise<void> {
  await addMilestone();
  const { error } = await run(['milestone-confirm', 'M001'], root);
  expect(error).toBeUndefined();
}

// Arranges an amendable edit: verification block change plus a Change Log entry.
function editForAmend(): void {
  editContract((text) =>
    text
      .replace('command: npm test', 'command: npm run verify')
      .replace('## Change Log', '## Change Log\n\n- Tightened verification command.'),
  );
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'pitway-mconf-'));
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

describe('pitway milestone-confirm', () => {
  it('records hash and confirmed_at, promotes ready tasks, commits the exact baseline set', async () => {
    await addMilestone();
    const { lines, error } = await run(['milestone-confirm', 'M001', '--json'], root);
    expect(error).toBeUndefined();

    const view = JSON.parse(lines[0]!) as {
      outcome: string;
      hash: string;
      confirmedAt: string;
      readyTasks: string[];
    };
    expect(view.outcome).toBe('committed');
    expect(view.readyTasks).toEqual(['T001']);

    const contract = loadContract(root, 'M001');
    expect(contract.frontmatter.status).toBe('in_progress');
    expect(contract.frontmatter.confirmed_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(contract.frontmatter.verification_approved_hash).toBe(
      computeVerificationHash(readFileSync(contractPath(), 'utf8')),
    );
    expect(view.hash).toBe(contract.frontmatter.verification_approved_hash);

    const tasks = loadTasks(root, 'M001').tasks;
    expect(tasks.map((t) => [t.id, t.status])).toEqual([
      ['T001', 'ready'],
      ['T002', 'waiting'],
    ]);

    expect(headFiles(root)).toEqual(EXPECTED_BASELINE_FILES);
    const message = headMessage(root);
    expect(message.startsWith('workflow: add milestone M001')).toBe(true);
    expect(message).toContain('PitWay-Milestone: M001');
    expect(message).not.toMatch(/PitWay-Task/);
    expect(git(['status', '--porcelain'], root).trim()).toBe('');
  });

  it('includes the requirement artifact in the baseline iff the contract references it', async () => {
    await addMilestone(true);
    const { error } = await run(['milestone-confirm', 'M001'], root);
    expect(error).toBeUndefined();
    expect(headFiles(root)).toEqual(
      [...EXPECTED_BASELINE_FILES, '.pitway/requirements/R001.md'].sort(),
    );
  });

  it('refuses a non-draft milestone outside the resume path', async () => {
    await addMilestone();
    editContract((text) => text.replace('status: draft', 'status: cancelled'));
    const { error } = await run(['milestone-confirm', 'M001'], root);
    expect(error?.message).toMatch(/cancelled/);
    expect(commitCount(root)).toBe(1);
  });

  it('refuses unexpected dirty paths listing the offenders, writing and staging nothing', async () => {
    await addMilestone();
    writeFileSync(join(root, '.pitway', 'milestones', 'M001', 'stray.txt'), 'stray\n');
    writeFileSync(join(root, 'wip.txt'), 'wip\n');
    const { error } = await run(['milestone-confirm', 'M001'], root);
    expect(error?.message).toMatch(/\.pitway\/milestones\/M001\/stray\.txt/);
    expect(error?.message).toMatch(/wip\.txt/);
    expect(loadContract(root, 'M001').frontmatter.status).toBe('draft');
    expect(git(['diff', '--cached', '--name-only'], root).trim()).toBe('');
    expect(commitCount(root)).toBe(1);
  });

  it('refuses a milestone with no tasks', async () => {
    const contract = join(root, 'draft-contract.md');
    const tasks = join(root, 'draft-tasks.yaml');
    writeFileSync(contract, CONTRACT_FIXTURE);
    writeFileSync(tasks, 'schema_version: 1\ntasks: []\n');
    await run(['milestone-add', '--contract', contract, '--tasks', tasks], root);
    rmSync(contract);
    rmSync(tasks);
    const { error } = await run(['milestone-confirm', 'M001'], root);
    expect(error?.message).toMatch(/no tasks/);
    expect(loadContract(root, 'M001').frontmatter.status).toBe('draft');
  });

  it('re-entry after the baseline commit landed is idempotent', async () => {
    await confirmed();
    const before = commitCount(root);
    const { lines, error } = await run(['milestone-confirm', 'M001', '--json'], root);
    expect(error).toBeUndefined();
    const view = JSON.parse(lines[0]!) as { outcome: string; commit: string };
    expect(view.outcome).toBe('already-committed');
    expect(view.commit).toBe(git(['rev-parse', 'HEAD'], root).trim());
    expect(commitCount(root)).toBe(before);
  });

  it('resumes the pending baseline commit after a hook failure is fixed', async () => {
    await addMilestone();
    const hook = installFailingHook();
    const { error } = await run(['milestone-confirm', 'M001'], root);
    expect(error).toBeDefined();
    // Local state advanced; the git step is what is pending.
    expect(loadContract(root, 'M001').frontmatter.status).toBe('in_progress');
    expect(commitCount(root)).toBe(1);

    rmSync(hook);
    const { lines, error: retryError } = await run(['milestone-confirm', 'M001', '--json'], root);
    expect(retryError).toBeUndefined();
    expect((JSON.parse(lines[0]!) as { outcome: string }).outcome).toBe('committed');
    expect(headFiles(root)).toEqual(EXPECTED_BASELINE_FILES);
    expect(loadTasks(root, 'M001').tasks.map((t) => t.status)).toEqual(['ready', 'waiting']);
  });

  it('refuses re-entry with unexpected dirty paths without staging', async () => {
    await addMilestone();
    const hook = installFailingHook();
    await run(['milestone-confirm', 'M001'], root);
    rmSync(hook);
    writeFileSync(join(root, 'wip.txt'), 'wip\n');
    const stagedBefore = git(['diff', '--cached', '--name-only'], root);
    const { error } = await run(['milestone-confirm', 'M001'], root);
    expect(error?.message).toMatch(/wip\.txt/);
    // Refusal stages nothing new beyond the interrupted first attempt.
    expect(git(['diff', '--cached', '--name-only'], root)).toBe(stagedBefore);
    expect(commitCount(root)).toBe(1);
  });

  it('stops with a diagnostic when the baseline commit exists but local state is draft', async () => {
    await confirmed();
    editContract((text) =>
      text
        .replace('status: in_progress', 'status: draft')
        .replace(/confirmed_at: .*/, 'confirmed_at: null')
        .replace(/verification_approved_hash: .*/, 'verification_approved_hash: null'),
    );
    const { error } = await run(['milestone-confirm', 'M001'], root);
    expect(error?.message).toMatch(/ambiguous/i);
    expect(commitCount(root)).toBe(2);
  });
});

describe('pitway milestone-confirm --amend', () => {
  it('recomputes the hash and commits exactly contract.md with the amend subject', async () => {
    await confirmed();
    const before = loadContract(root, 'M001').frontmatter;
    editForAmend();

    const { lines, error } = await run(['milestone-confirm', 'M001', '--amend', '--json'], root);
    expect(error).toBeUndefined();
    const view = JSON.parse(lines[0]!) as { outcome: string; hash: string };
    expect(view.outcome).toBe('committed');
    expect(view.hash).not.toBe(before.verification_approved_hash);

    const after = loadContract(root, 'M001').frontmatter;
    expect(after.verification_approved_hash).toBe(view.hash);
    expect(after.verification_approved_hash).toBe(
      computeVerificationHash(readFileSync(contractPath(), 'utf8')),
    );
    expect(after.status).toBe(before.status);
    expect(after.confirmed_at).toBe(before.confirmed_at);

    expect(headFiles(root)).toEqual(['.pitway/milestones/M001/contract.md']);
    const message = headMessage(root);
    expect(message.startsWith('workflow: amend milestone M001')).toBe(true);
    expect(message).toContain('PitWay-Milestone: M001');
    expect(message).not.toMatch(/PitWay-Task/);
    expect(git(['status', '--porcelain'], root).trim()).toBe('');
  });

  it('refuses while the milestone is still draft', async () => {
    await addMilestone();
    const { error } = await run(['milestone-confirm', 'M001', '--amend'], root);
    expect(error?.message).toMatch(/draft/);
    expect(commitCount(root)).toBe(1);
  });

  it('refuses while a confirm is mid-resume (no baseline commit yet)', async () => {
    await addMilestone();
    const hook = installFailingHook();
    await run(['milestone-confirm', 'M001'], root);
    rmSync(hook);
    const { error } = await run(['milestone-confirm', 'M001', '--amend'], root);
    expect(error?.message).toMatch(/baseline/);
    expect(commitCount(root)).toBe(1);
  });

  it('refuses without a Change Log entry, writing nothing', async () => {
    await confirmed();
    const before = loadContract(root, 'M001').frontmatter.verification_approved_hash;
    editContract((text) => text.replace('command: npm test', 'command: npm run verify'));
    const { error } = await run(['milestone-confirm', 'M001', '--amend'], root);
    expect(error?.message).toMatch(/Change Log/);
    expect(loadContract(root, 'M001').frontmatter.verification_approved_hash).toBe(before);
    expect(commitCount(root)).toBe(2);
  });

  it('refuses unexpected dirty paths, writing and staging nothing', async () => {
    await confirmed();
    const before = loadContract(root, 'M001').frontmatter.verification_approved_hash;
    editForAmend();
    writeFileSync(join(root, 'wip.txt'), 'wip\n');
    const { error } = await run(['milestone-confirm', 'M001', '--amend'], root);
    expect(error?.message).toMatch(/wip\.txt/);
    expect(loadContract(root, 'M001').frontmatter.verification_approved_hash).toBe(before);
    expect(git(['diff', '--cached', '--name-only'], root).trim()).toBe('');
  });

  it('resumes the pending amend commit after a hook failure is fixed', async () => {
    await confirmed();
    editForAmend();
    const hook = installFailingHook();
    const { error } = await run(['milestone-confirm', 'M001', '--amend'], root);
    expect(error).toBeDefined();
    expect(commitCount(root)).toBe(2);

    rmSync(hook);
    const { lines, error: retryError } = await run(['milestone-confirm', 'M001', '--amend', '--json'], root);
    expect(retryError).toBeUndefined();
    expect((JSON.parse(lines[0]!) as { outcome: string }).outcome).toBe('committed');
    expect(commitCount(root)).toBe(3);
    expect(headFiles(root)).toEqual(['.pitway/milestones/M001/contract.md']);
  });

  it('re-entry after the amend commit landed is idempotent', async () => {
    await confirmed();
    editForAmend();
    await run(['milestone-confirm', 'M001', '--amend'], root);
    const before = commitCount(root);
    const { lines, error } = await run(['milestone-confirm', 'M001', '--amend', '--json'], root);
    expect(error).toBeUndefined();
    const view = JSON.parse(lines[0]!) as { outcome: string; commit: string };
    expect(view.outcome).toBe('already-committed');
    expect(view.commit).toBe(git(['rev-parse', 'HEAD'], root).trim());
    expect(commitCount(root)).toBe(before);
  });

  it('each amendment matches only its own commit across multiple amends', async () => {
    await confirmed();
    editForAmend();
    const first = await run(['milestone-confirm', 'M001', '--amend', '--json'], root);
    const firstView = JSON.parse(first.lines[0]!) as { hash: string; commit: string };

    editContract((text) =>
      text
        .replace('command: npm run verify', 'command: npm run verify:all')
        .replace('## Change Log', '## Change Log\n\n- Broadened verification command.'),
    );
    const second = await run(['milestone-confirm', 'M001', '--amend', '--json'], root);
    expect(second.error).toBeUndefined();
    const secondView = JSON.parse(second.lines[0]!) as { outcome: string; hash: string; commit: string };
    expect(secondView.outcome).toBe('committed');
    expect(secondView.hash).not.toBe(firstView.hash);
    expect(secondView.commit).not.toBe(firstView.commit);
    expect(commitCount(root)).toBe(4);

    const again = await run(['milestone-confirm', 'M001', '--amend', '--json'], root);
    expect(again.error).toBeUndefined();
    const againView = JSON.parse(again.lines[0]!) as { outcome: string; commit: string };
    expect(againView).toMatchObject({ outcome: 'already-committed', commit: secondView.commit });
    expect(commitCount(root)).toBe(4);
  });

  it('stops with a diagnostic when the amend commit exists but local state is not advanced', async () => {
    await confirmed();
    const baselineHash = loadContract(root, 'M001').frontmatter.verification_approved_hash!;
    editForAmend();
    await run(['milestone-confirm', 'M001', '--amend'], root);
    editContract((text) =>
      text.replace(/verification_approved_hash: .*/, `verification_approved_hash: ${baselineHash}`),
    );
    const { error } = await run(['milestone-confirm', 'M001', '--amend'], root);
    expect(error?.message).toMatch(/ambiguous/i);
    expect(commitCount(root)).toBe(3);
  });
});
