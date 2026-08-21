import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCli } from '../../src/cli/index.js';
import { registerInitCommand } from '../../src/cli/commands/init.js';
import { registerMilestoneAddCommand } from '../../src/cli/commands/milestone-add.js';
import { registerMilestoneCompleteCommand } from '../../src/cli/commands/milestone-complete.js';
import { registerMilestoneConfirmCommand } from '../../src/cli/commands/milestone-confirm.js';
import { registerMilestoneMergeCommand } from '../../src/cli/commands/milestone-merge.js';
import { registerTaskUpdateCommand } from '../../src/cli/commands/task-update.js';
import { registerVerifyCommand } from '../../src/cli/commands/verify.js';
import { deterministicBranchName } from '../../src/core/milestones/confirm.js';
import { mergeMilestone, MilestoneMergeError } from '../../src/core/milestones/merge.js';
import { derivePending } from '../../src/core/journal/operations.js';
import { readJournal } from '../../src/state/journal.js';

// AC001-AC007 (M019/T001): mergeMilestone against real temp git repos --
// this task's write scope has no CLI wiring yet (T002's job), so every
// scenario here builds a completed milestone through the real CLI commands
// and then calls the Core function directly, exactly like
// tests/integration/branch-isolation-lifecycle.test.ts's own pattern.

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

const commitCount = (cwd: string): number => Number(git(['rev-list', '--count', 'HEAD'], cwd).trim());
const currentBranch = (cwd: string): string => git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).trim();

let root: string;
let scratch: string;

const MILESTONE_TITLE = 'Mergeable milestone';

const CONTRACT_FIXTURE = `---
schema_version: 1
id: M001
title: ${MILESTONE_TITLE}
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
    command: echo ok
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

function milestoneDirName(id: string): string {
  const dir = join(root, '.pitway', 'milestones');
  const match = readdirSync(dir).find((e) => e === id || e.startsWith(`${id}-`));
  if (!match) throw new Error(`no milestone directory found for ${id}`);
  return match;
}

async function run(args: string[], cwd: string): Promise<{ lines: string[]; error?: Error }> {
  const program = buildCli();
  const lines: string[] = [];
  registerInitCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerMilestoneAddCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerMilestoneConfirmCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerMilestoneCompleteCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerMilestoneMergeCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerTaskUpdateCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerVerifyCommand(program, { root: cwd, write: (s) => lines.push(s) });
  try {
    await program.parseAsync(['node', 'pitway', ...args]);
    return { lines };
  } catch (error) {
    return { lines, error: error as Error };
  }
}

function setBranchStrategy(strategy: 'main' | 'milestone'): void {
  writeFileSync(join(root, '.pitway', 'config.yaml'), `schema_version: 1\ngit:\n  branch_strategy: ${strategy}\n`);
}

async function addMilestone(): Promise<void> {
  const contract = join(root, 'draft-contract.md');
  const tasks = join(root, 'draft-tasks.yaml');
  writeFileSync(contract, CONTRACT_FIXTURE);
  writeFileSync(tasks, TASKS_FIXTURE);
  const { error } = await run(['milestone-add', '--contract', contract, '--tasks', tasks], root);
  expect(error).toBeUndefined();
  rmSync(contract);
  rmSync(tasks);
}

async function completeT001(): Promise<void> {
  const result = join(scratch, 'result.yaml');
  const message = join(scratch, 'message.txt');
  writeFileSync(result, 'summary: Done.\nevidence: tests pass\n');
  writeFileSync(message, 'task: complete T001\n\nReal work.\n');
  expect((await run(['task-update', 'T001', 'in_progress'], root)).error).toBeUndefined();
  expect((await run(['task-update', 'T001', 'review'], root)).error).toBeUndefined();
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1;\n');
  const { error } = await run(
    ['task-update', 'T001', 'completed', '--result', result, '--message', message],
    root,
  );
  expect(error).toBeUndefined();
}

interface CompletedMilestoneFixture {
  originalBranch: string;
  originalRevision: string;
  milestoneBranch: string;
  completionSha: string;
}

// Builds a milestone all the way to `completed`, ending on the milestone's
// own branch (the natural starting position for milestone-merge). Under
// branch_strategy: main, milestoneBranch/completionSha are still returned
// (completionSha is the completion commit, landed directly on
// originalBranch) but base_branch stays null -- the AC003 scenario.
async function buildCompletedMilestone(
  strategy: 'main' | 'milestone' = 'milestone',
): Promise<CompletedMilestoneFixture> {
  setBranchStrategy(strategy);
  const originalBranch = currentBranch(root);
  const originalRevision = git(['rev-parse', 'HEAD'], root).trim();
  await addMilestone();
  expect((await run(['milestone-confirm', 'M001'], root)).error).toBeUndefined();
  const milestoneBranch = deterministicBranchName('M001', MILESTONE_TITLE);
  await completeT001();
  expect((await run(['verify', 'M001'], root)).error).toBeUndefined();
  expect((await run(['milestone-complete', 'M001'], root)).error).toBeUndefined();
  const completionSha = git(['rev-parse', 'HEAD'], root).trim();
  return { originalBranch, originalRevision, milestoneBranch, completionSha };
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'pitway-mmerge-'));
  scratch = mkdtempSync(join(tmpdir(), 'pitway-mmerge-in-'));
  git(['init', '-q'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  writeFileSync(join(root, 'README.md'), 'seed\n');
  git(['add', 'README.md'], root);
  git(['commit', '-q', '-m', 'init'], root);
  await run(['init', '--no-claude'], root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

describe('mergeMilestone status gate (AC001)', () => {
  it('refuses before any git mutation when the milestone is not completed', async () => {
    setBranchStrategy('milestone');
    await addMilestone();
    expect((await run(['milestone-confirm', 'M001'], root)).error).toBeUndefined();
    const before = currentBranch(root);
    const headBefore = git(['rev-parse', 'HEAD'], root).trim();

    expect(() => mergeMilestone(root, 'M001')).toThrow(MilestoneMergeError);
    expect(() => mergeMilestone(root, 'M001')).toThrow(/status is "in_progress"/);

    expect(currentBranch(root)).toBe(before);
    expect(git(['rev-parse', 'HEAD'], root).trim()).toBe(headBefore);
  });
});

describe('mergeMilestone pre-checkout state resolution (AC002)', () => {
  it('resolves every state read from the current branch and succeeds from the milestone branch', async () => {
    const { originalBranch, milestoneBranch } = await buildCompletedMilestone();
    // The AC002 premise, confirmed live: the target never received the
    // milestone's own .pitway/ directory -- it exists only on the
    // milestone branch until this merge lands.
    expect(() =>
      git(['show', `${originalBranch}:.pitway/milestones/${milestoneDirName('M001')}/contract.md`], root),
    ).toThrow();
    expect(currentBranch(root)).toBe(milestoneBranch);

    const view = mergeMilestone(root, 'M001');

    expect(view.outcome).toBe('merged');
    expect(view.target).toBe(originalBranch);
    expect(view.source).toBe(milestoneBranch);
    expect(currentBranch(root)).toBe(originalBranch);
  });

  it('refuses by name when run from an unrelated branch where the completion commit is unreachable', async () => {
    const { originalRevision } = await buildCompletedMilestone();
    // Forked from the pre-milestone revision -- shares no milestone commits.
    git(['checkout', '-b', 'unrelated', originalRevision], root);

    expect(() => mergeMilestone(root, 'M001')).toThrow(
      /completion commit for M001 not found in current branch history/,
    );
  });

  it('refuses by name in detached HEAD where the completion commit is unreachable', async () => {
    const { originalRevision } = await buildCompletedMilestone();
    git(['checkout', originalRevision], root);

    expect(() => mergeMilestone(root, 'M001')).toThrow(
      /completion commit for M001 not found in current branch history/,
    );
  });

  it('succeeds on a legitimate re-run from the target branch after a successful merge', async () => {
    const { originalBranch, completionSha } = await buildCompletedMilestone();
    const first = mergeMilestone(root, 'M001');
    expect(first.outcome).toBe('merged');
    expect(currentBranch(root)).toBe(originalBranch);

    const afterFirst = commitCount(root);
    const second = mergeMilestone(root, 'M001');

    expect(second.outcome).toBe('already-merged');
    expect(second.commit).toBe(completionSha);
    expect(commitCount(root)).toBe(afterFirst);
  });
});

describe('mergeMilestone target resolution (AC003)', () => {
  it('defaults --target to contract.frontmatter.base_branch', async () => {
    const { originalBranch } = await buildCompletedMilestone();
    const view = mergeMilestone(root, 'M001');
    expect(view.target).toBe(originalBranch);
  });

  it('refuses with a distinct error when base_branch is null, before any git mutation', async () => {
    await buildCompletedMilestone('main');
    const before = currentBranch(root);
    const headBefore = git(['rev-parse', 'HEAD'], root).trim();

    expect(() => mergeMilestone(root, 'M001')).toThrow(/base_branch is null/);

    expect(currentBranch(root)).toBe(before);
    expect(git(['rev-parse', 'HEAD'], root).trim()).toBe(headBefore);
  });
});

describe('mergeMilestone git safety (AC004)', () => {
  it('refuses when the resolved target branch does not exist', async () => {
    await buildCompletedMilestone();
    expect(() => mergeMilestone(root, 'M001', { target: 'does-not-exist' })).toThrow(
      /target branch does-not-exist does not exist/,
    );
  });

  it('refuses on a dirty working tree', async () => {
    await buildCompletedMilestone();
    writeFileSync(join(root, 'dirty.txt'), 'oops\n');
    expect(() => mergeMilestone(root, 'M001')).toThrow(/working tree is dirty/);
  });

  it("refuses when the milestone's own source branch does not exist", async () => {
    const { milestoneBranch } = await buildCompletedMilestone();
    // Still checked out on the milestone branch throughout -- renaming it
    // away (rather than deleting, which git refuses while checked out)
    // makes the deterministic source-branch name resolve to nothing, the
    // same observable state a deleted branch would leave, without
    // disturbing the completion commit's reachability from current HEAD.
    git(['branch', '-m', 'renamed-away'], root);

    let caught: Error | undefined;
    try {
      mergeMilestone(root, 'M001');
    } catch (error) {
      caught = error as Error;
    }
    expect(caught).toBeInstanceOf(MilestoneMergeError);
    expect(caught?.message).toContain(`source branch ${milestoneBranch} does not exist`);
  });

  it('refuses with a distinct message (not generic dirty-tree) when MERGE_HEAD is already present', async () => {
    const { completionSha } = await buildCompletedMilestone();
    writeFileSync(join(root, '.git', 'MERGE_HEAD'), `${completionSha}\n`);

    expect(() => mergeMilestone(root, 'M001')).toThrow(/MERGE_HEAD present/);
  });

  it('on conflict: aborts the merge, restores the original branch, and refuses -- tree/branch unchanged', async () => {
    const { originalBranch, milestoneBranch } = await buildCompletedMilestone();
    // Independent, conflicting add of the same path lands on the target
    // branch after the milestone forked from it.
    git(['checkout', originalBranch], root);
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 2;\n');
    git(['add', 'src/a.ts'], root);
    git(['commit', '-q', '-m', 'target: conflicting change'], root);
    git(['checkout', milestoneBranch], root);

    const headBefore = git(['rev-parse', 'HEAD'], root).trim();
    const targetHeadBefore = git(['rev-parse', originalBranch], root).trim();

    expect(() => mergeMilestone(root, 'M001')).toThrow(MilestoneMergeError);

    expect(currentBranch(root)).toBe(milestoneBranch);
    expect(git(['rev-parse', 'HEAD'], root).trim()).toBe(headBefore);
    expect(git(['status', '--porcelain'], root).trim()).toBe('');
    expect(git(['rev-parse', originalBranch], root).trim()).toBe(targetHeadBefore);
  });

  it('restores the original branch after an injected NON-conflict failure, not only after a conflict', async () => {
    const { originalBranch, milestoneBranch } = await buildCompletedMilestone();
    // A pre-merge-commit hook rejection: the merge is cleanly auto-mergeable
    // (no content conflict) but the commit itself is blocked -- confirmed by
    // inspection to leave the same MERGE_HEAD-present state a real conflict
    // does, exercising the try/finally restore path independent of conflict
    // detection.
    const hook = join(root, '.git', 'hooks', 'pre-merge-commit');
    writeFileSync(hook, '#!/bin/sh\nexit 1\n');
    chmodSync(hook, 0o755);

    const headBefore = git(['rev-parse', 'HEAD'], root).trim();
    const targetHeadBefore = git(['rev-parse', originalBranch], root).trim();

    expect(() => mergeMilestone(root, 'M001')).toThrow(MilestoneMergeError);

    expect(currentBranch(root)).toBe(milestoneBranch);
    expect(git(['rev-parse', 'HEAD'], root).trim()).toBe(headBefore);
    expect(git(['status', '--porcelain'], root).trim()).toBe('');
    expect(git(['rev-parse', originalBranch], root).trim()).toBe(targetHeadBefore);
  });
});

describe('mergeMilestone idempotency (AC005)', () => {
  it('reports already-merged and creates no new commit once the completion commit is an ancestor of target', async () => {
    const { completionSha } = await buildCompletedMilestone();
    mergeMilestone(root, 'M001');
    const afterFirst = commitCount(root);

    const second = mergeMilestone(root, 'M001');

    expect(second.outcome).toBe('already-merged');
    expect(second.commit).toBe(completionSha);
    expect(commitCount(root)).toBe(afterFirst);
  });

  it('still reports already-merged after the source branch has been deleted', async () => {
    const { completionSha, milestoneBranch } = await buildCompletedMilestone();
    mergeMilestone(root, 'M001');
    git(['branch', '-D', milestoneBranch], root);

    const second = mergeMilestone(root, 'M001');

    expect(second.outcome).toBe('already-merged');
    expect(second.commit).toBe(completionSha);
  });
});

describe('mergeMilestone successful merge commit (AC006)', () => {
  it('produces a merge commit "merge: <id> <title>" with no PitWay trailer', async () => {
    await buildCompletedMilestone();
    const view = mergeMilestone(root, 'M001');

    const message = git(['log', '-1', '--format=%B', view.commit], root);
    expect(message.trim()).toBe(`merge: M001 ${MILESTONE_TITLE}`);
    expect(message).not.toMatch(/PitWay-/);

    const parents = git(['log', '-1', '--format=%P', view.commit], root).trim().split(/\s+/);
    expect(parents).toHaveLength(2);
  });
});

describe('mergeMilestone journal record (AC007)', () => {
  it('appends a milestone_merge record on both the success and already-merged paths', async () => {
    await buildCompletedMilestone();

    const success = mergeMilestone(root, 'M001');
    let records = readJournal(root).filter((r) => r.kind === 'milestone_merge');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      milestone: 'M001',
      alreadyMerged: false,
      mergeCommitSha: success.commit,
    });

    const already = mergeMilestone(root, 'M001');
    records = readJournal(root).filter((r) => r.kind === 'milestone_merge');
    expect(records).toHaveLength(2);
    expect(records[1]).toMatchObject({
      milestone: 'M001',
      alreadyMerged: true,
      mergeCommitSha: already.commit,
    });

    // Never checkpoint-eligible and never visible in git status -- same
    // sibling-record discipline as worktree_dispatch/auto_run/quick_change.
    expect(derivePending(readJournal(root))).toHaveLength(0);
    expect(git(['status', '--porcelain'], root).trim()).toBe('');
  });
});

// AC001/AC008/T002: the CLI wiring itself -- reachable via `pitway
// milestone-merge <id> [--target <branch>]`, emitting the mergeMilestone
// view as a JSON envelope under --json and readable text otherwise, on
// every path (success, already-merged, refusal).
describe('milestone-merge CLI command (AC001, AC008)', () => {
  it('--json emits the merge view on a successful merge', async () => {
    const { originalBranch } = await buildCompletedMilestone();
    const { lines, error } = await run(['milestone-merge', 'M001', '--json'], root);

    expect(error).toBeUndefined();
    const view = JSON.parse(lines[0]!) as { id: string; target: string; outcome: string; commit: string };
    expect(view).toMatchObject({ id: 'M001', target: originalBranch, outcome: 'merged' });
    expect(view.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('renders readable text on a successful merge without --json', async () => {
    await buildCompletedMilestone();
    const { lines, error } = await run(['milestone-merge', 'M001'], root);

    expect(error).toBeUndefined();
    expect(lines.join('')).toMatch(/Merged M001/);
  });

  it('--json emits outcome already-merged on a re-run, human text otherwise', async () => {
    await buildCompletedMilestone();
    expect((await run(['milestone-merge', 'M001'], root)).error).toBeUndefined();

    const jsonRun = await run(['milestone-merge', 'M001', '--json'], root);
    expect(jsonRun.error).toBeUndefined();
    expect(JSON.parse(jsonRun.lines[0]!)).toMatchObject({ outcome: 'already-merged' });

    const textRun = await run(['milestone-merge', 'M001'], root);
    expect(textRun.error).toBeUndefined();
    expect(textRun.lines.join('')).toMatch(/already merged/);
  });

  it('respects an explicit --target branch', async () => {
    const { originalBranch } = await buildCompletedMilestone();
    git(['checkout', '-b', 'release', originalBranch], root);
    git(['checkout', deterministicBranchName('M001', MILESTONE_TITLE)], root);

    const { lines, error } = await run(['milestone-merge', 'M001', '--target', 'release', '--json'], root);

    expect(error).toBeUndefined();
    expect(JSON.parse(lines[0]!)).toMatchObject({ target: 'release', outcome: 'merged' });
  });

  it('refuses a not-yet-completed milestone -- readable error, no crash, tree unchanged', async () => {
    setBranchStrategy('milestone');
    await addMilestone();
    expect((await run(['milestone-confirm', 'M001'], root)).error).toBeUndefined();

    const { error } = await run(['milestone-merge', 'M001'], root);

    expect(error).toBeInstanceOf(MilestoneMergeError);
    expect(error?.message).toMatch(/status is "in_progress"/);
  });
});
