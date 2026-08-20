import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCli } from '../../src/cli/index.js';
import { registerInitCommand } from '../../src/cli/commands/init.js';
import { registerMilestoneAddCommand } from '../../src/cli/commands/milestone-add.js';
import { registerMilestoneCompleteCommand } from '../../src/cli/commands/milestone-complete.js';
import { registerMilestoneConfirmCommand } from '../../src/cli/commands/milestone-confirm.js';
import { registerResumeCommand } from '../../src/cli/commands/resume.js';
import { registerTaskUpdateCommand } from '../../src/cli/commands/task-update.js';
import { registerVerifyCommand } from '../../src/cli/commands/verify.js';
import { loadContract } from '../../src/state/store.js';
import { deterministicBranchName } from '../../src/core/milestones/confirm.js';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

const commitCount = (cwd: string): number => Number(git(['rev-list', '--count', 'HEAD'], cwd).trim());
const currentBranch = (cwd: string): string => git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).trim();

let root: string;
let scratch: string;

// Cheap fixture commands only -- never npm (the real suite's own commands
// would recurse into this test process).
const CONTRACT_FIXTURE = `---
schema_version: 1
id: M999
title: Lifecycle milestone
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
  registerTaskUpdateCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerResumeCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerVerifyCommand(program, { root: cwd, write: (s) => lines.push(s) });
  try {
    await program.parseAsync(['node', 'pitway', ...args]);
    return { lines };
  } catch (error) {
    return { lines, error: error as Error };
  }
}

function setBranchStrategy(strategy: 'main' | 'milestone' | 'absent'): void {
  const content =
    strategy === 'absent'
      ? 'schema_version: 1\n'
      : `schema_version: 1\ngit:\n  branch_strategy: ${strategy}\n`;
  writeFileSync(join(root, '.pitway', 'config.yaml'), content);
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

async function completeT001(): Promise<string> {
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
  return git(['rev-parse', 'HEAD'], root).trim();
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'pitway-branch-lifecycle-'));
  scratch = mkdtempSync(join(tmpdir(), 'pitway-branch-lifecycle-in-'));
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

// AC007: the full milestone-strategy lifecycle against real git state, start
// to finish, in one continuous flow -- not the individual per-AC pieces
// T002-T006 already exercise in isolation.
describe('branch-isolation full lifecycle under branch_strategy: milestone (M012/T007/AC007)', () => {
  it('confirm creates the branch -> a task commits onto it -> resume surfaces a mismatch after a manual checkout -> completion reaches a merge-ready state', async () => {
    setBranchStrategy('milestone');
    const originalBranch = currentBranch(root);
    const originalRevision = git(['rev-parse', 'HEAD'], root).trim();

    // milestone-confirm: branch created with the deterministic name, baseline
    // lands on it, base_branch/base_revision recorded correctly.
    await addMilestone();
    const { error: confirmError } = await run(['milestone-confirm', 'M001'], root);
    expect(confirmError).toBeUndefined();

    const milestoneBranch = deterministicBranchName('M001', 'Lifecycle milestone');
    expect(currentBranch(root)).toBe(milestoneBranch);
    const contract = loadContract(root, 'M001');
    expect(contract.frontmatter.base_branch).toBe(originalBranch);
    expect(contract.frontmatter.base_revision).toBe(originalRevision);
    const baselineSha = git(['rev-parse', 'HEAD'], root).trim();

    // Task lifecycle: the completion commit lands on the milestone branch.
    const taskSha = await completeT001();
    expect(git(['rev-parse', milestoneBranch], root).trim()).toBe(taskSha);
    // Not leaked onto the base branch (nothing merges it there).
    expect(() => git(['merge-base', '--is-ancestor', taskSha, originalBranch], root)).toThrow();

    // Manual checkout away, then resume: mismatch surfaced, no auto-checkout.
    // Branched off the milestone branch itself (not back to the pristine
    // pre-confirm `originalBranch`) -- .pitway/state.yaml and the milestone
    // directory are committed content that exists only on the milestone
    // branch until it is eventually merged (a disclosed, documented
    // expectation, not something this AC changes); switching all the way
    // back to `originalBranch` would delete them from the working tree
    // entirely and every pitway command, resume included, would fail with a
    // plain file-not-found error -- an unrelated, pre-existing limitation
    // (running any pitway command outside an initialized repo already
    // fails this way), not the branch-mismatch scenario AC004 is about.
    const elsewhere = 'somewhere-else';
    git(['checkout', '-b', elsewhere], root);
    const { lines: resumeLines, error: resumeError } = await run(['resume', '--json'], root);
    expect(resumeError).toBeUndefined();
    const resumeView = JSON.parse(resumeLines.join('\n'));
    expect(resumeView.branch).toEqual({
      expected: milestoneBranch,
      actual: elsewhere,
      matches: false,
    });
    expect(currentBranch(root)).toBe(elsewhere);

    // Checkout back, record the verification check, complete the milestone.
    git(['checkout', milestoneBranch], root);
    const { error: verifyError } = await run(['verify', 'M001'], root);
    expect(verifyError).toBeUndefined();
    const { error: completeError } = await run(['milestone-complete', 'M001'], root);
    expect(completeError).toBeUndefined();
    const completionSha = git(['rev-parse', 'HEAD'], root).trim();

    // Merge-ready assertions (AC006), against this real lifecycle's own commits.
    const commitsSinceBase = git(
      ['log', '--format=%H', `${originalRevision}..${milestoneBranch}`],
      root,
    )
      .trim()
      .split('\n')
      .filter((l) => l.length > 0);
    expect(commitsSinceBase.sort()).toEqual([baselineSha, taskSha, completionSha].sort());
    expect(git(['status', '--porcelain'], root).trim()).toBe('');
    for (const sha of [baselineSha, taskSha, completionSha]) {
      expect(() => git(['merge-base', '--is-ancestor', sha, originalBranch], root)).toThrow();
    }
    expect(git(['rev-parse', originalBranch], root).trim()).toBe(originalRevision);
    expect(currentBranch(root)).toBe(milestoneBranch);
  });
});

// AC007: main strategy (both explicit and config-absent) is completely
// unaffected end-to-end -- no branch is ever created or switched,
// base_branch/base_revision stay null throughout, and the same lifecycle
// completes exactly as it does today.
describe.each([
  ['branch_strategy: main (explicit)', 'main' as const],
  ['git entirely absent from config.yaml (default)', 'absent' as const],
])('branch-isolation full lifecycle regression under %s (M012/T007/AC007)', (_label, strategy) => {
  it('completes the same lifecycle with no branch ever created', async () => {
    setBranchStrategy(strategy);
    const startBranch = currentBranch(root);

    await addMilestone();
    expect((await run(['milestone-confirm', 'M001'], root)).error).toBeUndefined();
    expect(currentBranch(root)).toBe(startBranch);
    const contract = loadContract(root, 'M001');
    expect(contract.frontmatter.base_branch ?? null).toBeNull();
    expect(contract.frontmatter.base_revision ?? null).toBeNull();

    await completeT001();
    expect(currentBranch(root)).toBe(startBranch);

    const { lines: resumeLines } = await run(['resume', '--json'], root);
    expect(JSON.parse(resumeLines.join('\n')).branch).toBeUndefined();

    expect((await run(['verify', 'M001'], root)).error).toBeUndefined();
    const { error: completeError } = await run(['milestone-complete', 'M001'], root);
    expect(completeError).toBeUndefined();
    expect(currentBranch(root)).toBe(startBranch);
    expect(commitCount(root)).toBeGreaterThan(1);
  });
});
