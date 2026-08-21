import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCli } from '../../src/cli/index.js';
import { registerInitCommand } from '../../src/cli/commands/init.js';
import { registerMilestoneAddCommand } from '../../src/cli/commands/milestone-add.js';
import { registerMilestoneReviewCommand } from '../../src/cli/commands/milestone-review.js';
import { resolveMilestoneDirName } from '../../src/state/store.js';

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

let root: string;

async function run(args: string[], cwd: string): Promise<{ lines: string[]; error?: Error }> {
  const program = buildCli();
  const lines: string[] = [];
  registerInitCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerMilestoneAddCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerMilestoneReviewCommand(program, { root: cwd, write: (s) => lines.push(s) });
  try {
    await program.parseAsync(['node', 'pitway', ...args]);
    return { lines };
  } catch (error) {
    return { lines, error: error as Error };
  }
}

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
    relevant_files:
      - src/a.ts
    verification:
      strategy: tdd
      detail: npm test
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

function writeFindingsFile(content: string): string {
  const path = join(root, `findings-${Math.random().toString(36).slice(2)}.yaml`);
  writeFileSync(path, content);
  return path;
}

function seedTerminalMilestone(status: 'completed' | 'cancelled'): string {
  const id = 'M001';
  const dir = join(root, '.pitway', 'milestones', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'contract.md'),
    CONTRACT_FIXTURE.replace('id: M999', `id: ${id}`).replace('status: draft', `status: ${status}`),
  );
  writeFileSync(join(dir, 'tasks.yaml'), TASKS_FIXTURE);
  return id;
}

function contractAndTasksBytes(id: string): { contract: Buffer; tasks: Buffer } {
  const dir = resolveMilestoneDirName(root, id);
  return {
    contract: readFileSync(join(root, '.pitway', 'milestones', dir, 'contract.md')),
    tasks: readFileSync(join(root, '.pitway', 'milestones', dir, 'tasks.yaml')),
  };
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'pitway-review-decide-'));
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

describe('milestone-review decide', () => {
  it('accepts once every selected role has recorded findings', async () => {
    const id = await addDraftMilestone();
    await run(['milestone-review', 'start', id, '--roles', 'developer', '--json'], root);
    await run(
      ['milestone-review', 'record', id, '--role', 'developer', '--file', writeFindingsFile('findings: []\n')],
      root,
    );
    const { lines, error } = await run(
      ['milestone-review', 'decide', id, '--outcome', 'accepted', '--json'],
      root,
    );
    expect(error).toBeUndefined();
    const view = JSON.parse(lines[0]!) as { outcome: string };
    expect(view.outcome).toBe('accepted');
  });

  it('records revision_requested with an optional note', async () => {
    const id = await addDraftMilestone();
    await run(['milestone-review', 'start', id, '--roles', 'developer', '--json'], root);
    await run(
      ['milestone-review', 'record', id, '--role', 'developer', '--file', writeFindingsFile('findings: []\n')],
      root,
    );
    const { lines, error } = await run(
      [
        'milestone-review',
        'decide',
        id,
        '--outcome',
        'revision_requested',
        '--note',
        'Widen T001 write_scope first.',
        '--json',
      ],
      root,
    );
    expect(error).toBeUndefined();
    const view = JSON.parse(lines[0]!) as { outcome: string; note: string | null };
    expect(view.outcome).toBe('revision_requested');
    expect(view.note).toBe('Widen T001 write_scope first.');

    const human = await run(
      ['milestone-review', 'decide', id, '--outcome', 'revision_requested'],
      root,
    );
    // Already decided -- expect refusal on a second decide, but exercise the
    // human renderer via a fresh cycle below instead.
    expect(human.error).toBeDefined();
  });

  it('names both revision paths in the human output for revision_requested', async () => {
    const id = await addDraftMilestone();
    await run(['milestone-review', 'start', id, '--roles', 'developer', '--json'], root);
    await run(
      ['milestone-review', 'record', id, '--role', 'developer', '--file', writeFindingsFile('findings: []\n')],
      root,
    );
    const { lines, error } = await run(
      ['milestone-review', 'decide', id, '--outcome', 'revision_requested'],
      root,
    );
    expect(error).toBeUndefined();
    expect(lines.join('\n')).toContain('milestone-add --replace');
    expect(lines.join('\n')).toContain('milestone-confirm --amend');
  });

  it('refuses accepted while a selected role has no recorded findings, naming it', async () => {
    const id = await addDraftMilestone();
    await run(['milestone-review', 'start', id, '--roles', 'developer,architect', '--json'], root);
    await run(
      ['milestone-review', 'record', id, '--role', 'developer', '--file', writeFindingsFile('findings: []\n')],
      root,
    );
    const { error } = await run(['milestone-review', 'decide', id, '--outcome', 'accepted'], root);
    expect(error).toBeDefined();
    expect(error!.message).toContain('architect');
  });

  it('refuses revision_requested while a selected role has no recorded findings', async () => {
    const id = await addDraftMilestone();
    await run(['milestone-review', 'start', id, '--roles', 'developer,architect', '--json'], root);
    const { error } = await run(
      ['milestone-review', 'decide', id, '--outcome', 'revision_requested'],
      root,
    );
    expect(error).toBeDefined();
    expect(error!.message).toContain('developer');
    expect(error!.message).toContain('architect');
  });

  it('permits rejected with pending roles -- the explicit abandonment path', async () => {
    const id = await addDraftMilestone();
    await run(['milestone-review', 'start', id, '--roles', 'developer,architect', '--json'], root);
    const { error } = await run(['milestone-review', 'decide', id, '--outcome', 'rejected'], root);
    expect(error).toBeUndefined();
  });

  it('a decided session closure allows a fresh start on the same milestone', async () => {
    const id = await addDraftMilestone();
    await run(['milestone-review', 'start', id, '--roles', 'developer', '--json'], root);
    await run(['milestone-review', 'decide', id, '--outcome', 'rejected'], root);

    const { error } = await run(['milestone-review', 'start', id, '--roles', 'qa', '--json'], root);
    expect(error).toBeUndefined();
  });

  it('refuses when no session is open', async () => {
    const id = await addDraftMilestone();
    const { error } = await run(['milestone-review', 'decide', id, '--outcome', 'rejected'], root);
    expect(error).toBeDefined();
    expect(error!.message).toContain('no open review session');
  });

  it('refuses an invalid --outcome value before touching any review state', async () => {
    const id = await addDraftMilestone();
    const { error } = await run(['milestone-review', 'decide', id, '--outcome', 'bogus'], root);
    expect(error).toBeDefined();
    expect(error!.message).toContain('--outcome must be one of');
  });

  it('falls back to process.cwd() when deps.root is omitted', async () => {
    const id = await addDraftMilestone();
    await run(['milestone-review', 'start', id, '--roles', 'developer', '--json'], root);
    await run(
      ['milestone-review', 'record', id, '--role', 'developer', '--file', writeFindingsFile('findings: []\n')],
      root,
    );

    const program = buildCli();
    const lines: string[] = [];
    registerMilestoneReviewCommand(program, { write: (s) => lines.push(s) });
    const cwdBefore = process.cwd();
    process.chdir(root);
    try {
      await program.parseAsync(['node', 'pitway', 'milestone-review', 'decide', id, '--outcome', 'accepted', '--json']);
    } finally {
      process.chdir(cwdBefore);
    }
    const view = JSON.parse(lines[0]!) as { outcome: string };
    expect(view.outcome).toBe('accepted');
  });

  it('refuses against a terminal milestone', async () => {
    const id = seedTerminalMilestone('completed');
    const { error } = await run(['milestone-review', 'decide', id, '--outcome', 'rejected'], root);
    expect(error).toBeDefined();
    expect(error!.message).toContain('completed');
  });

  it('never writes contract.md or tasks.yaml across a full start/record/decide cycle', async () => {
    const id = await addDraftMilestone();
    const before = contractAndTasksBytes(id);

    await run(['milestone-review', 'start', id, '--roles', 'developer', '--json'], root);
    await run(
      [
        'milestone-review',
        'record',
        id,
        '--role',
        'developer',
        '--file',
        writeFindingsFile(`findings:
  - severity: minor
    finding: A nit.
    recommendation: Fix it.
`),
      ],
      root,
    );
    await run(['milestone-review', 'decide', id, '--outcome', 'accepted'], root);

    const after = contractAndTasksBytes(id);
    expect(after.contract.equals(before.contract)).toBe(true);
    expect(after.tasks.equals(before.tasks)).toBe(true);
  });
});
