import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCli } from '../../src/cli/index.js';
import { registerInitCommand } from '../../src/cli/commands/init.js';
import { registerMilestoneAddCommand } from '../../src/cli/commands/milestone-add.js';
import { registerMilestoneConfirmCommand } from '../../src/cli/commands/milestone-confirm.js';
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
  registerMilestoneConfirmCommand(program, { root: cwd, write: (s) => lines.push(s) });
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

// milestone-add assigns the next sequential milestone id itself -- it never
// reads the fixture's own `id:` field -- so every caller must use the id
// this returns, never the fixture's literal M999.
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
  // The loose draft-input files are outside the milestone's own tracked
  // scope -- clean them up so a later milestone-confirm sees a genuinely
  // clean tree (mirrors milestone-add.test.ts's own convention).
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
  root = mkdtempSync(join(tmpdir(), 'pitway-review-start-'));
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

describe('milestone-review start', () => {
  it('opens a session with the given roles and a content_hash, on a draft milestone', async () => {
    const id = await addDraftMilestone();
    const { lines, error } = await run(
      ['milestone-review', 'start', id, '--roles', 'developer,architect', '--json'],
      root,
    );
    expect(error).toBeUndefined();
    const view = JSON.parse(lines[0]!) as {
      id: string;
      status: string;
      roles: string[];
      contentHash: string;
    };
    expect(view.id).toMatch(/^rev-[0-9a-f]+$/);
    expect(view.status).toBe('open');
    expect(view.roles).toEqual(['developer', 'architect']);
    expect(view.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('opens a session on a confirmed milestone', async () => {
    const id = await addDraftMilestone();
    const confirmed = await run(['milestone-confirm', id], root);
    expect(confirmed.error).toBeUndefined();

    const { lines, error } = await run(
      ['milestone-review', 'start', id, '--roles', 'qa', '--json'],
      root,
    );
    expect(error).toBeUndefined();
    const view = JSON.parse(lines[0]!) as { roles: string[] };
    expect(view.roles).toEqual(['qa']);
  });

  it('refuses an unknown role, naming it', async () => {
    const id = await addDraftMilestone();
    const { error } = await run(
      ['milestone-review', 'start', id, '--roles', 'developer,astronaut'],
      root,
    );
    expect(error).toBeDefined();
    expect(error!.message).toContain('astronaut');
  });

  it('refuses a duplicate role, naming it', async () => {
    const id = await addDraftMilestone();
    const { error } = await run(
      ['milestone-review', 'start', id, '--roles', 'developer,developer'],
      root,
    );
    expect(error).toBeDefined();
    expect(error!.message).toContain('developer');
    expect(error!.message.toLowerCase()).toContain('duplicate');
  });

  it('refuses an empty role selection', async () => {
    const id = await addDraftMilestone();
    const { error } = await run(['milestone-review', 'start', id, '--roles', ''], root);
    expect(error).toBeDefined();
  });

  it('refuses to start against a completed milestone', async () => {
    const id = seedTerminalMilestone('completed');
    const { error } = await run(['milestone-review', 'start', id, '--roles', 'developer'], root);
    expect(error).toBeDefined();
    expect(error!.message).toContain('completed');
  });

  it('refuses to start against a cancelled milestone', async () => {
    const id = seedTerminalMilestone('cancelled');
    const { error } = await run(['milestone-review', 'start', id, '--roles', 'developer'], root);
    expect(error).toBeDefined();
    expect(error!.message).toContain('cancelled');
  });

  it('falls back to process.cwd()/stdin/stdout when deps are entirely omitted, refusing without --roles off a non-TTY', async () => {
    // No `root`/`input`/`output` deps at all -- the CLI action computes
    // `deps.root ?? process.cwd()` and `deps.input ?? process.stdin` /
    // `deps.output ?? process.stdout` before checking `input.isTTY`. This
    // throws before ever touching the filesystem (root is never used for
    // I/O on this path), so it is safe to exercise the real fallbacks
    // without redirecting the process's cwd or stdio.
    const program = buildCli();
    const lines: string[] = [];
    registerMilestoneReviewCommand(program, { write: (s) => lines.push(s) });
    let error: Error | undefined;
    try {
      await program.parseAsync(['node', 'pitway', 'milestone-review', 'start', 'M001']);
    } catch (e) {
      error = e as Error;
    }
    expect(error).toBeDefined();
    expect(error!.message).toContain('--roles');
  });

  it('refuses a second open session for the same milestone, naming the still-open one', async () => {
    const id = await addDraftMilestone();
    const first = await run(
      ['milestone-review', 'start', id, '--roles', 'developer', '--json'],
      root,
    );
    const firstId = (JSON.parse(first.lines[0]!) as { id: string }).id;

    const { error } = await run(['milestone-review', 'start', id, '--roles', 'qa'], root);
    expect(error).toBeDefined();
    expect(error!.message).toContain(firstId);
  });
});
