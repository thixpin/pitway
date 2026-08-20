import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCli, registerAllCommands } from '../../src/cli/index.js';

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function gitOutput(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

const headFiles = (cwd: string): string[] =>
  gitOutput(['show', '--name-only', '--format='], cwd)
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .sort();

let root: string;

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

const PASSING_VERIFY = 'node -e "process.exit(0)"';

const CONTRACT_FIXTURE = `---
schema_version: 1
id: M999
title: Example milestone
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
      - AC001
    write_scope:
      - src/a.ts
    context_files:
      - src/a.ts
    verification:
      strategy: command
      detail: ${PASSING_VERIFY}
    result: null
    usage: null
`;

async function addDraftMilestone(): Promise<string> {
  const contractPath = join(root, 'contract.md');
  const tasksPath = join(root, 'tasks.yaml');
  writeFileSync(contractPath, CONTRACT_FIXTURE);
  writeFileSync(tasksPath, TASKS_FIXTURE);
  const added = await run(
    ['milestone-add', '--contract', contractPath, '--tasks', tasksPath, '--json'],
    root,
  );
  expect(added.error).toBeUndefined();
  unlinkSync(contractPath);
  unlinkSync(tasksPath);
  return (JSON.parse(added.lines[0]!) as { id: string }).id;
}

// Written OUTSIDE the repo (a fresh tmpdir, not `root`) so it never counts
// as a dirty working-tree file for the CLI commands this test chains into.
function writeFindingsFile(content: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'pitway-findings-')), 'findings.yaml');
  writeFileSync(path, content);
  return path;
}

function reviewsRelPath(id: string): string {
  const dir = execFileSync(
    'node',
    ['-e', `console.log(require('fs').readdirSync('.pitway/milestones').find(e=>e===${JSON.stringify(id)}||e.startsWith(${JSON.stringify(id + '-')})))`],
    { cwd: root, stdio: 'pipe' },
  )
    .toString()
    .trim();
  return `.pitway/milestones/${dir}/reviews.yaml`;
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'pitway-review-lifecycle-'));
  git(['init', '-q'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  writeFileSync(join(root, 'README.md'), 'seed\n');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.ts'), 'export {};\n');
  git(['add', '-A'], root);
  git(['commit', '-q', '-m', 'init'], root);
  await run(['init'], root);
  git(['add', '-A'], root);
  git(['commit', '-q', '-m', 'test: seed pitway state'], root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('reviews.yaml never deadlocks or dangles across the real task/milestone lifecycle (AC008)', () => {
  it('rides the baseline commit, the completion commit, and the milestone-complete commit; unrelated dirt still refuses', async () => {
    const id = await addDraftMilestone();

    // (1) draft-session write rides the baseline commit at confirm.
    const started = await run(
      ['milestone-review', 'start', id, '--roles', 'developer,architect', '--json'],
      root,
    );
    expect(started.error).toBeUndefined();

    const confirmed = await run(['milestone-confirm', id], root);
    expect(confirmed.error).toBeUndefined();
    expect(headFiles(root)).toContain(reviewsRelPath(id));

    // control: genuinely unrelated dirt still refuses task-update in_progress.
    writeFileSync(join(root, 'unrelated.txt'), 'stray\n');
    const blockedStart = await run(['task-update', 'T001', 'in_progress'], root);
    expect(blockedStart.error).toBeDefined();
    expect(blockedStart.error!.message).toContain('unrelated.txt');
    rmSync(join(root, 'unrelated.txt'));

    // (2) on the now-confirmed (in_progress) milestone: record -> reviews.yaml
    // materializes dirty+pending again -> task-update in_progress still
    // succeeds -> task-verify succeeds -> completion commit carries
    // reviews.yaml.
    const recorded1 = await run(
      [
        'milestone-review',
        'record',
        id,
        '--role',
        'developer',
        '--file',
        writeFindingsFile(`findings:
  - severity: minor
    finding: A small nit in T001.
    recommendation: Fix it later.
`),
      ],
      root,
    );
    expect(recorded1.error).toBeUndefined();

    const started1 = await run(['task-update', 'T001', 'in_progress'], root);
    expect(started1.error).toBeUndefined();

    const verified = await run(['task-verify', 'T001'], root);
    expect(verified.error).toBeUndefined();

    const toReview = await run(['task-update', 'T001', 'review'], root);
    expect(toReview.error).toBeUndefined();

    const scratch = mkdtempSync(join(tmpdir(), 'pitway-taskresult-'));
    const resultPath = join(scratch, 'result.yaml');
    const messagePath = join(scratch, 'message.txt');
    writeFileSync(resultPath, 'summary: done\nevidence: verified\n');
    writeFileSync(messagePath, 'workflow: complete T001\n');
    const completedTask = await run(
      ['task-update', 'T001', 'completed', '--result', resultPath, '--message', messagePath],
      root,
    );
    expect(completedTask.error).toBeUndefined();
    expect(headFiles(root)).toContain(reviewsRelPath(id));

    // (3) record after the final task completes rides the milestone-complete
    // commit (the session is still open -- confirm/complete stay uncoupled
    // from review sessions by design).
    const recorded2 = await run(
      [
        'milestone-review',
        'record',
        id,
        '--role',
        'architect',
        '--file',
        writeFindingsFile('findings: []\n'),
      ],
      root,
    );
    expect(recorded2.error).toBeUndefined();

    const verifyCheck = await run(
      ['verify', id, '--check', 'CT001', '--pass', '--evidence', 'Docs checked manually.'],
      root,
    );
    expect(verifyCheck.error).toBeUndefined();

    const completedMilestone = await run(['milestone-complete', id], root);
    expect(completedMilestone.error).toBeUndefined();
    expect(headFiles(root)).toContain(reviewsRelPath(id));
  });

  it('quick-change create refuses while a review write is pending (disclosed edge)', async () => {
    const id = await addDraftMilestone();
    await run(['milestone-review', 'start', id, '--roles', 'developer', '--json'], root);

    // milestone-cancel is draft-only and performs no git operation -- it
    // clears active_milestone without folding the still-pending
    // review_recording journal entry into any commit, leaving reviews.yaml
    // genuinely dirty in the tree.
    const cancelled = await run(['milestone-cancel', id], root);
    expect(cancelled.error).toBeUndefined();

    const created = await run(
      [
        'quick-change',
        'create',
        '--objective',
        'Fix something unrelated',
        '--scope',
        'README.md',
        '--verify',
        PASSING_VERIFY,
      ],
      root,
    );
    expect(created.error).toBeDefined();
    expect(created.error!.message).toContain('reviews.yaml');
  });
});
