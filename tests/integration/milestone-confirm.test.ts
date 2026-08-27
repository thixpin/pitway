import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCli } from '../../src/cli/index.js';
import { registerInitCommand } from '../../src/cli/commands/init.js';
import { registerMilestoneAddCommand } from '../../src/cli/commands/milestone-add.js';
import { registerMilestoneConfirmCommand } from '../../src/cli/commands/milestone-confirm.js';
import { registerMilestoneReviewCommand } from '../../src/cli/commands/milestone-review.js';
import { registerTaskDispatchCommand } from '../../src/cli/commands/task-dispatch.js';
import { computeVerificationHash } from '../../src/core/contracts/verification-hash.js';
import { derivePending } from '../../src/state/journal-operations.js';
import { readJournal, reconcilePending, type JournalEntry } from '../../src/state/journal.js';
import { loadConfig, loadContract, loadTasks, saveConfig } from '../../src/state/store.js';
import { listClaudeAssetDestinations } from '../../src/state/claude-assets.js';

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

function milestoneDirName(id: string): string {
  const dir = join(root, '.pitway', 'milestones');
  const match = readdirSync(dir).find((e) => e === id || e.startsWith(`${id}-`));
  if (!match) throw new Error(`no milestone directory found for ${id}`);
  return match;
}

// M006 hotfix: the shared beforeEach below runs default `init` (Claude
// assets on), so the real baseline commit also covers every installed
// .claude/ asset -- resolved from the one authoritative list
// (listClaudeAssetDestinations), never hardcoded here, so this helper never
// drifts from what the installer actually ships. T004: default `init` also
// creates AGENTS.md/CLAUDE.md, content-identical, riding into the same
// baseline commit.
const expectedBaselineFiles = (): string[] => {
  const dir = milestoneDirName('M001');
  return [
    '.pitway/config.yaml',
    `.pitway/milestones/${dir}/contract.md`,
    `.pitway/milestones/${dir}/tasks.yaml`,
    `.pitway/milestones/${dir}/usage.yaml`,
    `.pitway/milestones/${dir}/verification-repairs.yaml`,
    `.pitway/milestones/${dir}/verification-results.yaml`,
    '.pitway/state.yaml',
    ...listClaudeAssetDestinations(),
    'AGENTS.md',
    'CLAUDE.md',
  ].sort();
};

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

const contractRelPath = (): string => `.pitway/milestones/${milestoneDirName('M001')}/contract.md`;

const contractPath = (): string => join(root, ...contractRelPath().split('/'));

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

// Writes a scratch draft contract file — the --file input --amend now
// requires — derived from whatever is currently persisted at contract.md
// (which, post-amend, already reflects any prior immediate materialization).
function draftFromCurrent(transform: (text: string) => string): string {
  const draft = join(root, `amend-draft-${Date.now()}-${Math.random().toString(36).slice(2)}.md`);
  writeFileSync(draft, transform(readFileSync(contractPath(), 'utf8')));
  return draft;
}

// Arranges an amendable draft: verification block change plus a Change Log entry.
function amendDraft(command = 'npm run verify', changeLogEntry = 'Tightened verification command.'): string {
  return draftFromCurrent((text) =>
    text
      .replace(/command: .*/, `command: ${command}`)
      .replace('## Change Log', `## Change Log\n\n- ${changeLogEntry}`),
  );
}

function pendingAmendEntries(): JournalEntry[] {
  return derivePending(readJournal(root)).filter((e) => e.type === 'contract_amendment');
}

// Simulates the checkpoint commit that task-update's completion path /
// milestone-complete would create around a pending amendment, then the
// reconciliation call they make afterwards — this test file has neither
// command registered, so the checkpoint itself is stood up directly.
function checkpointPendingContract(): void {
  git(['add', contractRelPath()], root);
  git(['commit', '-m', 'workflow: simulate checkpoint\n\nPitWay-Milestone: M001'], root);
  reconcilePending(root, 'M001');
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

    expect(headFiles(root)).toEqual(expectedBaselineFiles());
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
      [...expectedBaselineFiles(), '.pitway/requirements/R001.md'].sort(),
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
    const dir = milestoneDirName('M001');
    writeFileSync(join(root, '.pitway', 'milestones', dir, 'stray.txt'), 'stray\n');
    writeFileSync(join(root, 'wip.txt'), 'wip\n');
    const { error } = await run(['milestone-confirm', 'M001'], root);
    expect(error?.message).toMatch(new RegExp(`\\.pitway/milestones/${dir}/stray\\.txt`));
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
    expect(headFiles(root)).toEqual(expectedBaselineFiles());
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

  // M006 hotfix (baseline safety previously refused every default-init'd
  // repo's own installed Claude assets as "unrelated dirty changes" -- see
  // src/git/baseline.ts's extraExpectedPaths).
  it('accepts the exact installed Claude asset set at confirmation, committed in the same baseline', async () => {
    // beforeEach already ran default `init` (Claude assets on); confirming
    // must succeed and the assets must land in the same baseline commit,
    // exactly like .pitway/config.yaml/state.yaml already do.
    await confirmed();
    expect(headFiles(root)).toEqual(expectedBaselineFiles());
    for (const asset of listClaudeAssetDestinations()) {
      expect(git(['status', '--porcelain', asset], root).trim()).toBe('');
    }
  });

  // T004: dedicated regression test for root instruction files specifically
  // -- confirm succeeds cleanly with both present and untracked, and both
  // land in the baseline commit.
  it('confirms cleanly with both root instruction files present and untracked', async () => {
    expect(git(['status', '--porcelain', 'AGENTS.md'], root).trim()).toMatch(/^\?\?/);
    expect(git(['status', '--porcelain', 'CLAUDE.md'], root).trim()).toMatch(/^\?\?/);
    await confirmed();
    expect(headFiles(root)).toContain('AGENTS.md');
    expect(headFiles(root)).toContain('CLAUDE.md');
    expect(git(['status', '--porcelain'], root).trim()).toBe('');
  });

  it('still refuses an unmanaged file under .claude/ as unrelated dirty, naming it exactly', async () => {
    await addMilestone();
    writeFileSync(join(root, '.claude', 'unmanaged.md'), 'not installed by pitway\n');
    const { error } = await run(['milestone-confirm', 'M001'], root);
    expect(error?.message).toMatch(/\.claude\/unmanaged\.md/);
    expect(loadContract(root, 'M001').frontmatter.status).toBe('draft');
    expect(git(['diff', '--cached', '--name-only'], root).trim()).toBe('');
  });

  // T005: direct regression test for the M006-era gap listSafeManagedDirtyPaths
  // closes -- a manually-tampered, genuinely-conflicting managed .claude/
  // asset now refuses confirmation, naming that asset, rather than being
  // silently staged into the baseline commit merely because its path is a
  // recognized one.
  it('refuses a manually-tampered, conflicting managed .claude/ asset, naming it, not silently staging it', async () => {
    await addMilestone();
    const [asset] = listClaudeAssetDestinations();
    writeFileSync(join(root, ...asset!.split('/')), 'tampered content, not the shipped bytes\n');
    const { error } = await run(['milestone-confirm', 'M001'], root);
    expect(error?.message).toContain(asset!);
    expect(loadContract(root, 'M001').frontmatter.status).toBe('draft');
    expect(git(['diff', '--cached', '--name-only'], root).trim()).toBe('');
  });
});

// M006 hotfix: --no-claude must remain entirely unaffected -- no Claude
// paths are ever expected or committed when no assets were installed. Uses
// its own root (not the shared default-init beforeEach above).
describe('pitway milestone-confirm with --no-claude (M006 hotfix regression)', () => {
  let noClaudeRoot: string;

  beforeEach(async () => {
    noClaudeRoot = mkdtempSync(join(tmpdir(), 'pitway-mconf-noclaude-'));
    git(['init', '-q'], noClaudeRoot);
    git(['config', 'user.email', 'test@example.com'], noClaudeRoot);
    git(['config', 'user.name', 'Test'], noClaudeRoot);
    writeFileSync(join(noClaudeRoot, 'README.md'), 'seed\n');
    git(['add', 'README.md'], noClaudeRoot);
    git(['commit', '-q', '-m', 'init'], noClaudeRoot);
    await run(['init', '--no-claude'], noClaudeRoot);
  });

  afterEach(() => {
    rmSync(noClaudeRoot, { recursive: true, force: true });
  });

  it('confirms cleanly with no .claude/ directory and no Claude paths in the baseline commit', async () => {
    const contract = join(noClaudeRoot, 'draft-contract.md');
    const tasks = join(noClaudeRoot, 'draft-tasks.yaml');
    writeFileSync(contract, CONTRACT_FIXTURE);
    writeFileSync(tasks, TASKS_FIXTURE);
    await run(['milestone-add', '--contract', contract, '--tasks', tasks], noClaudeRoot);
    rmSync(contract);
    rmSync(tasks);
    const { error } = await run(['milestone-confirm', 'M001'], noClaudeRoot);
    expect(error).toBeUndefined();
    const committed = headFiles(noClaudeRoot);
    expect(committed.some((f) => f.startsWith('.claude/'))).toBe(false);
    expect(git(['status', '--porcelain'], noClaudeRoot).trim()).toBe('');
  });
});

describe('pitway milestone-confirm --amend', () => {
  it('requires --file', async () => {
    await confirmed();
    const { error } = await run(['milestone-confirm', 'M001', '--amend'], root);
    expect(error?.message).toMatch(/--file/);
    expect(commitCount(root)).toBe(2);
  });

  it('recomputes the hash and materializes contract.md immediately from --file, journaling the amendment with no commit of its own', async () => {
    await confirmed();
    const before = loadContract(root, 'M001').frontmatter;
    const draft = amendDraft();

    const { lines, error } = await run(
      ['milestone-confirm', 'M001', '--amend', '--file', draft, '--json'],
      root,
    );
    expect(error).toBeUndefined();
    const view = JSON.parse(lines[0]!) as {
      id: string;
      operation: string;
      hash: string;
      confirmedAt: string | null;
    };
    expect(view).toEqual({ id: 'M001', operation: 'amend', hash: expect.any(String), confirmedAt: before.confirmed_at });
    expect(view.hash).not.toBe(before.verification_approved_hash);

    // AC3: a read immediately after the command reflects the amended state,
    // before any checkpoint commit exists.
    const after = loadContract(root, 'M001').frontmatter;
    expect(after.verification_approved_hash).toBe(view.hash);
    expect(after.verification_approved_hash).toBe(
      computeVerificationHash(readFileSync(contractPath(), 'utf8')),
    );
    expect(after.status).toBe(before.status);
    expect(after.confirmed_at).toBe(before.confirmed_at);

    // No commit of its own: contract.md sits dirty, waiting for the next checkpoint.
    expect(commitCount(root)).toBe(2);
    expect(git(['status', '--porcelain'], root).trim()).toContain(contractRelPath());

    const pending = pendingAmendEntries();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      milestone: 'M001',
      type: 'contract_amendment',
      payload: { hash: view.hash },
    });
  });

  it('refuses while the milestone is still draft', async () => {
    await addMilestone();
    const draft = amendDraft();
    const { error } = await run(['milestone-confirm', 'M001', '--amend', '--file', draft], root);
    expect(error?.message).toMatch(/draft/);
    expect(commitCount(root)).toBe(1);
  });

  it('refuses while a confirm is mid-resume (no baseline commit yet)', async () => {
    await addMilestone();
    const hook = installFailingHook();
    await run(['milestone-confirm', 'M001'], root);
    rmSync(hook);
    const draft = amendDraft();
    const { error } = await run(['milestone-confirm', 'M001', '--amend', '--file', draft], root);
    expect(error?.message).toMatch(/baseline/);
    expect(commitCount(root)).toBe(1);
  });

  it('refuses without a Change Log entry, writing nothing', async () => {
    await confirmed();
    const before = loadContract(root, 'M001').frontmatter.verification_approved_hash;
    const draft = draftFromCurrent((text) => text.replace(/command: .*/, 'command: npm run verify'));
    const { error } = await run(['milestone-confirm', 'M001', '--amend', '--file', draft], root);
    expect(error?.message).toMatch(/Change Log/);
    expect(loadContract(root, 'M001').frontmatter.verification_approved_hash).toBe(before);
    expect(commitCount(root)).toBe(2);
    expect(pendingAmendEntries()).toHaveLength(0);
  });

  it('refuses an unreadable or malformed --file, writing nothing', async () => {
    await confirmed();
    const before = loadContract(root, 'M001').frontmatter.verification_approved_hash;
    const missing = join(root, 'does-not-exist.md');
    const { error } = await run(['milestone-confirm', 'M001', '--amend', '--file', missing], root);
    expect(error?.message).toMatch(/amendment/);
    expect(loadContract(root, 'M001').frontmatter.verification_approved_hash).toBe(before);
    expect(commitCount(root)).toBe(2);
  });

  it('refuses a --file draft whose id does not match the target milestone, writing nothing', async () => {
    await confirmed();
    const before = loadContract(root, 'M001').frontmatter.verification_approved_hash;
    const draft = draftFromCurrent((text) =>
      text.replace('id: M001', 'id: M002').replace('## Change Log', '## Change Log\n\n- Wrong id.'),
    );
    const { error } = await run(['milestone-confirm', 'M001', '--amend', '--file', draft], root);
    expect(error?.message).toMatch(/does not match/);
    expect(loadContract(root, 'M001').frontmatter.verification_approved_hash).toBe(before);
    expect(commitCount(root)).toBe(2);
    expect(pendingAmendEntries()).toHaveLength(0);
  });

  it('succeeds regardless of unrelated dirty paths — materialization is not a commit staging step', async () => {
    await confirmed();
    const draft = amendDraft();
    writeFileSync(join(root, 'wip.txt'), 'wip\n');
    const { error } = await run(['milestone-confirm', 'M001', '--amend', '--file', draft], root);
    expect(error).toBeUndefined();
    expect(loadContract(root, 'M001').frontmatter.verification_approved_hash).not.toBeNull();
  });

  it('materializes a body-only amendment (Change Log entry, no AC/CT change) instead of silently no-op-ing on an unchanged hash', async () => {
    await confirmed();
    const beforeHash = loadContract(root, 'M001').frontmatter.verification_approved_hash;
    // No command/AC change — only the Change Log prose differs, so the
    // verification-block hash stays identical to what's already persisted.
    const draft = draftFromCurrent((text) =>
      text.replace('## Change Log', '## Change Log\n\n- Body-only note, no AC/CT touched.'),
    );
    const { error } = await run(['milestone-confirm', 'M001', '--amend', '--file', draft], root);
    expect(error).toBeUndefined();
    const after = loadContract(root, 'M001');
    expect(after.frontmatter.verification_approved_hash).toBe(beforeHash);
    expect(after.body).toContain('Body-only note, no AC/CT touched.');
  });

  it('a hook failure elsewhere does not affect amend — it never invokes git at all', async () => {
    await confirmed();
    const draft = amendDraft();
    installFailingHook();
    const { error } = await run(['milestone-confirm', 'M001', '--amend', '--file', draft], root);
    expect(error).toBeUndefined();
    expect(commitCount(root)).toBe(2);
  });

  it('re-entry with the same draft while it is still pending is idempotent: no second journal entry, same hash returned', async () => {
    await confirmed();
    const draft = amendDraft();
    const first = await run(['milestone-confirm', 'M001', '--amend', '--file', draft, '--json'], root);
    expect(first.error).toBeUndefined();
    const firstView = JSON.parse(first.lines[0]!) as { hash: string };

    const second = await run(['milestone-confirm', 'M001', '--amend', '--file', draft, '--json'], root);
    expect(second.error).toBeUndefined();
    const secondView = JSON.parse(second.lines[0]!) as { hash: string };
    expect(secondView.hash).toBe(firstView.hash);
    expect(pendingAmendEntries()).toHaveLength(1);
    expect(commitCount(root)).toBe(2);
  });

  it('re-running the same amendment after it has already been checkpointed is a no-op: no new journal entry', async () => {
    await confirmed();
    const draft = amendDraft();
    await run(['milestone-confirm', 'M001', '--amend', '--file', draft], root);
    checkpointPendingContract();
    expect(pendingAmendEntries()).toHaveLength(0);

    const { error } = await run(['milestone-confirm', 'M001', '--amend', '--file', draft], root);
    expect(error).toBeUndefined();
    expect(pendingAmendEntries()).toHaveLength(0);
    expect(commitCount(root)).toBe(3);
  });

  it('refuses a second amendment with a different hash while the first is still pending, diagnosing the ambiguity (AC6)', async () => {
    await confirmed();
    const first = amendDraft('npm run verify', 'Tightened verification command.');
    const firstRun = await run(['milestone-confirm', 'M001', '--amend', '--file', first, '--json'], root);
    expect(firstRun.error).toBeUndefined();
    const firstView = JSON.parse(firstRun.lines[0]!) as { hash: string };

    // A second, differently-hashed amendment before the first has been
    // checkpointed — genuinely ambiguous, must not silently pick one.
    const second = amendDraft('npm run verify:all', 'Broadened verification command.');
    const { error } = await run(['milestone-confirm', 'M001', '--amend', '--file', second], root);
    expect(error?.message).toMatch(/ambiguous/i);
    expect(pendingAmendEntries()).toHaveLength(1);
    expect(pendingAmendEntries()[0]?.payload.hash).toBe(firstView.hash);
  });

  it('permits a new, differently-hashed amendment once the prior one has been checkpointed', async () => {
    await confirmed();
    const first = amendDraft('npm run verify', 'Tightened verification command.');
    const firstRun = await run(['milestone-confirm', 'M001', '--amend', '--file', first, '--json'], root);
    const firstView = JSON.parse(firstRun.lines[0]!) as { hash: string };
    checkpointPendingContract();

    const second = amendDraft('npm run verify:all', 'Broadened verification command.');
    const secondRun = await run(
      ['milestone-confirm', 'M001', '--amend', '--file', second, '--json'],
      root,
    );
    expect(secondRun.error).toBeUndefined();
    const secondView = JSON.parse(secondRun.lines[0]!) as { hash: string };
    expect(secondView.hash).not.toBe(firstView.hash);
    expect(pendingAmendEntries()).toHaveLength(1);
    expect(loadContract(root, 'M001').frontmatter.verification_approved_hash).toBe(secondView.hash);
  });
});

// M012/T002 (AC002): branch_strategy: milestone branch creation, and the
// two-case hardened resume design -- fresh confirm refuses on an already-
// existing branch (never reuses/resets it); resumed confirm performs no
// branch mutation and refuses on any position mismatch.
function setBranchStrategy(strategy: 'main' | 'milestone'): void {
  writeFileSync(
    join(root, '.pitway', 'config.yaml'),
    `schema_version: 1\ngit:\n  branch_strategy: ${strategy}\n`,
  );
}

describe('pitway milestone-confirm with branch_strategy: milestone (M012/T002)', () => {
  it('creates the milestone branch when git is absent from config (runtime fallback is Option B)', async () => {
    const startRevision = git(['rev-parse', 'HEAD'], root).trim();
    await confirmed();
    const contract = loadContract(root, 'M001');
    expect(contract.frontmatter.base_branch).not.toBeNull();
    expect(contract.frontmatter.base_revision).toBe(startRevision);
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], root).trim()).toBe(
      'pitway/M001-confirmable-milestone',
    );
  });

  it('leaves base_branch/base_revision null and creates no branch under explicit branch_strategy: main', async () => {
    setBranchStrategy('main');
    const before = git(['rev-parse', '--abbrev-ref', 'HEAD'], root).trim();
    await confirmed();
    const contract = loadContract(root, 'M001');
    expect(contract.frontmatter.base_branch ?? null).toBeNull();
    expect(contract.frontmatter.base_revision ?? null).toBeNull();
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], root).trim()).toBe(before);
  });

  it('creates the deterministic branch, checks it out, and records base_branch/base_revision on a fresh confirm', async () => {
    setBranchStrategy('milestone');
    const startBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'], root).trim();
    const startRevision = git(['rev-parse', 'HEAD'], root).trim();
    await confirmed();

    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], root).trim()).toBe(
      'pitway/M001-confirmable-milestone',
    );
    const contract = loadContract(root, 'M001');
    expect(contract.frontmatter.base_branch).toBe(startBranch);
    expect(contract.frontmatter.base_revision).toBe(startRevision);
    // The baseline commit landed on the new branch, not the original one.
    expect(git(['rev-parse', startBranch], root).trim()).toBe(startRevision);
  });

  it('refuses a fresh confirm when the deterministic branch name already exists, without reusing or resetting it (covers both a genuine foreign collision and a simulated orphaned-from-crash branch identically -- this design deliberately never distinguishes the two)', async () => {
    setBranchStrategy('milestone');
    await addMilestone();
    git(['branch', 'pitway/M001-confirmable-milestone'], root);
    const branchTip = git(['rev-parse', 'pitway/M001-confirmable-milestone'], root).trim();
    const startBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'], root).trim();

    const { error } = await run(['milestone-confirm', 'M001'], root);
    expect(error?.message).toMatch(/already exists/i);
    expect(loadContract(root, 'M001').frontmatter.status).toBe('draft');
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], root).trim()).toBe(startBranch);
    // Never deleted, reset, or force-created over.
    expect(git(['rev-parse', 'pitway/M001-confirmable-milestone'], root).trim()).toBe(branchTip);
    expect(commitCount(root)).toBe(1);
  });

  it('resumes and completes the baseline commit when re-invoked while still on the correct milestone branch', async () => {
    setBranchStrategy('milestone');
    await addMilestone();
    const hook = installFailingHook();
    const { error } = await run(['milestone-confirm', 'M001'], root);
    expect(error).toBeDefined();
    expect(loadContract(root, 'M001').frontmatter.status).toBe('in_progress');
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], root).trim()).toBe(
      'pitway/M001-confirmable-milestone',
    );

    rmSync(hook);
    const { lines, error: retryError } = await run(['milestone-confirm', 'M001', '--json'], root);
    expect(retryError).toBeUndefined();
    expect((JSON.parse(lines[0]!) as { outcome: string }).outcome).toBe('committed');
    expect(headFiles(root)).toEqual(expectedBaselineFiles());
  });

  it('refuses to resume when checked out on a different branch, without checking anything out itself', async () => {
    setBranchStrategy('milestone');
    const startBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'], root).trim();
    await addMilestone();
    const hook = installFailingHook();
    await run(['milestone-confirm', 'M001'], root);
    rmSync(hook);
    git(['checkout', startBranch], root);

    const { error } = await run(['milestone-confirm', 'M001'], root);
    expect(error?.message).toMatch(/expected branch pitway\/M001-confirmable-milestone/);
    expect(error?.message).toMatch(new RegExp(`found ${startBranch}`));
    // Confirm never checked anything out to fix the mismatch.
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], root).trim()).toBe(startBranch);
  });

  it('refuses to resume when the expected branch was deleted between attempts', async () => {
    setBranchStrategy('milestone');
    const startBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'], root).trim();
    await addMilestone();
    const hook = installFailingHook();
    await run(['milestone-confirm', 'M001'], root);
    rmSync(hook);
    git(['checkout', startBranch], root);
    git(['branch', '-d', 'pitway/M001-confirmable-milestone'], root);

    const { error } = await run(['milestone-confirm', 'M001'], root);
    expect(error?.message).toMatch(/expected branch pitway\/M001-confirmable-milestone/);
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], root).trim()).toBe(startBranch);
    // Confirm never recreated the deleted branch.
    expect(() =>
      git(['show-ref', '--verify', '--quiet', 'refs/heads/pitway/M001-confirmable-milestone'], root),
    ).toThrow();
  });

  it('preserves base_branch/base_revision across --amend even when the submitted draft omits them (M033 hotfix)', async () => {
    setBranchStrategy('milestone');
    await confirmed();
    const before = loadContract(root, 'M001').frontmatter;
    expect(before.base_branch).not.toBeNull();
    expect(before.base_revision).not.toBeNull();

    // Simulates an amendment authored from draft-formats.md's minimal
    // template, which never mentions base_branch/base_revision at all --
    // these are execution-lifecycle fields only a fresh confirm's branch
    // creation should ever set, never something an amendment author is
    // expected to know about or echo back.
    const draft = draftFromCurrent((text) =>
      text
        .replace(/^base_branch: .*\n/m, '')
        .replace(/^base_revision: .*\n/m, '')
        .replace(/command: .*/, 'command: npm run verify')
        .replace('## Change Log', '## Change Log\n\n- Tightened verification command.'),
    );

    const { error } = await run(['milestone-confirm', 'M001', '--amend', '--file', draft], root);
    expect(error).toBeUndefined();

    const after = loadContract(root, 'M001').frontmatter;
    expect(after.base_branch).toBe(before.base_branch);
    expect(after.base_revision).toBe(before.base_revision);
  });
});

// M017/T001 (AC001): the baseline commit is a checkpoint -- a journal-pending
// entry whose target file it just committed must get its marker, or it stays
// "pending" forever and blocks task-dispatch (found live in M016, whose own
// pre-confirmation milestone-review left exactly such review_recording
// entries). Uses its own write_scope fixture: the shared TASKS_FIXTURE's legacy
// relevant_files tasks are never parallel-eligible, so task-dispatch would
// refuse them for an unrelated reason.
const PARALLEL_TASKS_FIXTURE = `schema_version: 1
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
      strategy: tdd
      detail: npm test
    result: null
    usage: null
`;

describe('milestone-confirm reconciles pending journal entries after its baseline commit (M017/T001)', () => {
  async function runExt(args: string[]): Promise<{ lines: string[]; error?: Error }> {
    const program = buildCli();
    const lines: string[] = [];
    const deps = { root, write: (s: string) => lines.push(s) };
    registerMilestoneAddCommand(program, deps);
    registerMilestoneConfirmCommand(program, deps);
    registerMilestoneReviewCommand(program, deps);
    registerTaskDispatchCommand(program, deps);
    try {
      await program.parseAsync(['node', 'pitway', ...args]);
      return { lines };
    } catch (error) {
      return { lines, error: error as Error };
    }
  }

  const pendingFor = (milestone: string): JournalEntry[] =>
    derivePending(readJournal(root)).filter((e) => e.milestone === milestone);

  async function addParallelDraft(): Promise<void> {
    saveConfig(root, { ...loadConfig(root), execution: { strategy: 'parallel_worktrees' } });
    const contract = join(root, 'draft-contract.md');
    const tasks = join(root, 'draft-tasks.yaml');
    writeFileSync(contract, CONTRACT_FIXTURE);
    writeFileSync(tasks, PARALLEL_TASKS_FIXTURE);
    expect((await runExt(['milestone-add', '--contract', contract, '--tasks', tasks])).error).toBeUndefined();
    rmSync(contract);
    rmSync(tasks);
  }

  it('clears review_recording entries the baseline commit captured, so task-dispatch works immediately', async () => {
    await addParallelDraft();
    expect((await runExt(['milestone-review', 'start', 'M001', '--roles', 'qa'])).error).toBeUndefined();
    expect(pendingFor('M001')).toHaveLength(1);

    const confirmed = await runExt(['milestone-confirm', 'M001']);
    expect(confirmed.error).toBeUndefined();
    expect(headFiles(root)).toContain(`.pitway/milestones/${milestoneDirName('M001')}/reviews.yaml`);
    expect(pendingFor('M001')).toHaveLength(0);

    // The exact call that M016's first dispatch failed on.
    expect((await runExt(['task-dispatch', 'T001'])).error).toBeUndefined();
  });

  it('leaves an entry pending when its target still differs from HEAD (byte-match semantics unchanged)', async () => {
    await addParallelDraft();
    expect((await runExt(['milestone-confirm', 'M001'])).error).toBeUndefined();
    expect(pendingFor('M001')).toHaveLength(0);

    // A review write AFTER the baseline: reviews.yaml on disk is not at HEAD.
    expect((await runExt(['milestone-review', 'start', 'M001', '--roles', 'qa'])).error).toBeUndefined();
    expect(pendingFor('M001')).toHaveLength(1);
    expect(reconcilePending(root, 'M001')).toHaveLength(0);
    expect(pendingFor('M001')).toHaveLength(1);
  });
});

describe('pitway milestone-confirm human rendering', () => {
  it("renders the idempotent re-entry as 'already recorded in', omitting Ready tasks when none remain ready", async () => {
    await confirmed();
    // Work has since started: T001 moved past ready. The re-entry view
    // reports the currently-ready set, which is now empty -- the human line
    // must omit the Ready-tasks sentence entirely, not render an empty list.
    const tasksPath = join(root, '.pitway', 'milestones', milestoneDirName('M001'), 'tasks.yaml');
    writeFileSync(
      tasksPath,
      readFileSync(tasksPath, 'utf8').replace('status: ready', 'status: in_progress'),
    );

    const { lines, error } = await run(['milestone-confirm', 'M001'], root);
    expect(error).toBeUndefined();
    const output = lines.join('\n');
    expect(output).toMatch(/🏁 Confirmed milestone M001: hash sha256:[0-9a-f]{64} already recorded in baseline [0-9a-f]{40}\./);
    expect(output).not.toContain('Ready tasks');
  });
});

// The default CommandDeps fallbacks (deps.write ?? console.log,
// deps.root ?? process.cwd()) are only reached when a caller registers the
// command with no overrides -- the real shape a bare `pitway
// milestone-confirm` invocation takes outside this test file's harness.
describe('pitway milestone-confirm default CommandDeps fallbacks', () => {
  it('falls back to console.log and process.cwd() when no overrides are given', async () => {
    await addMilestone();

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cwdBefore = process.cwd();
    process.chdir(root);
    let caught: unknown;
    let calls: unknown[][] = [];
    try {
      const program = buildCli();
      registerMilestoneConfirmCommand(program);
      await program.parseAsync(['node', 'pitway', 'milestone-confirm', 'M001']);
    } catch (error) {
      caught = error;
    } finally {
      calls = logSpy.mock.calls;
      process.chdir(cwdBefore);
      logSpy.mockRestore();
    }

    expect(caught).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.[0])).toMatch(
      /🏁 Confirmed milestone M001: hash sha256:[0-9a-f]{64} recorded in baseline [0-9a-f]{40}\. Ready tasks: T001\./,
    );
  });
});
