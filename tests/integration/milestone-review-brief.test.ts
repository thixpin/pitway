import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCli } from '../../src/cli/index.js';
import { registerInitCommand } from '../../src/cli/commands/init.js';
import { registerMilestoneAddCommand } from '../../src/cli/commands/milestone-add.js';
import { registerMilestoneReviewCommand } from '../../src/cli/commands/milestone-review.js';

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

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'pitway-review-brief-'));
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

describe('milestone-review brief', () => {
  it('emits a role brief with focus, instructions, contract, tasks and the session content_hash', async () => {
    const id = await addDraftMilestone();
    const started = await run(
      ['milestone-review', 'start', id, '--roles', 'developer,architect', '--json'],
      root,
    );
    const session = JSON.parse(started.lines[0]!) as { id: string; contentHash: string };

    const { lines, error } = await run(
      ['milestone-review', 'brief', id, '--role', 'developer', '--json'],
      root,
    );
    expect(error).toBeUndefined();
    const view = JSON.parse(lines[0]!) as {
      milestone: string;
      sessionId: string;
      role: string;
      focus: string;
      instructions: string;
      contract: { frontmatter: { id: string; title: string }; body: string };
      tasks: Array<{ id: string }>;
      contentHash: string;
    };
    expect(view.milestone).toBe(id);
    expect(view.sessionId).toBe(session.id);
    expect(view.role).toBe('developer');
    expect(view.focus.length).toBeGreaterThan(0);
    expect(view.instructions).toContain('findings:');
    expect(view.instructions.toLowerCase()).toContain('findings only');
    expect(view.contract.frontmatter.id).toBe(id);
    expect(view.contract.body).toContain('## Objective');
    expect(view.tasks.map((t) => t.id)).toEqual(['T001']);
    expect(view.contentHash).toBe(session.contentHash);
  });

  it('refuses when no session is open', async () => {
    const id = await addDraftMilestone();
    const { error } = await run(['milestone-review', 'brief', id, '--role', 'developer'], root);
    expect(error).toBeDefined();
    expect(error!.message).toContain('no open review session');
  });

  it('refuses when the role is not part of the open session', async () => {
    const id = await addDraftMilestone();
    await run(['milestone-review', 'start', id, '--roles', 'developer', '--json'], root);

    const { error } = await run(['milestone-review', 'brief', id, '--role', 'qa'], root);
    expect(error).toBeDefined();
    expect(error!.message).toContain('qa');
  });

  it('refuses against a terminal (completed) milestone', async () => {
    const id = seedTerminalMilestone('completed');
    const { error } = await run(['milestone-review', 'brief', id, '--role', 'developer'], root);
    expect(error).toBeDefined();
    expect(error!.message).toContain('completed');
  });

  it('refuses against a terminal (cancelled) milestone', async () => {
    const id = seedTerminalMilestone('cancelled');
    const { error } = await run(['milestone-review', 'brief', id, '--role', 'developer'], root);
    expect(error).toBeDefined();
    expect(error!.message).toContain('cancelled');
  });

  it('refuses on a definition-hash mismatch after a real milestone-add --replace revision', async () => {
    const id = await addDraftMilestone();
    await run(['milestone-review', 'start', id, '--roles', 'developer', '--json'], root);

    const contractPath = join(root, 'replacement-contract.md');
    const tasksPath = join(root, 'replacement-tasks.yaml');
    writeFileSync(contractPath, CONTRACT_FIXTURE.replace('First task.', 'A materially different task.'));
    writeFileSync(tasksPath, TASKS_FIXTURE.replace('First task.', 'A materially different task.'));
    const replaced = await run(
      ['milestone-add', '--contract', contractPath, '--tasks', tasksPath, '--replace', id, '--json'],
      root,
    );
    expect(replaced.error).toBeUndefined();
    unlinkSync(contractPath);
    unlinkSync(tasksPath);

    const { error } = await run(['milestone-review', 'brief', id, '--role', 'developer'], root);
    expect(error).toBeDefined();
    expect(error!.message).toContain('revised');
    expect(error!.message).toContain('rejected');
  });
});
