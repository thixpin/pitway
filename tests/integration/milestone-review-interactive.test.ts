import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCli } from '../../src/cli/index.js';
import { registerInitCommand } from '../../src/cli/commands/init.js';
import { registerMilestoneAddCommand } from '../../src/cli/commands/milestone-add.js';
import { registerMilestoneReviewCommand } from '../../src/cli/commands/milestone-review.js';
import { promptForRoles, ReviewPromptError, type PromptStreams } from '../../src/cli/review-prompt.js';

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

let root: string;

interface TestStreams {
  input: PassThrough & { isTTY?: boolean };
  output: PromptStreams['output'];
  getOutput: () => string;
}

function makeStreams(isTTY: boolean): TestStreams {
  const input = new PassThrough() as PassThrough & { isTTY?: boolean };
  input.isTTY = isTTY;
  const output = new PassThrough();
  const chunks: string[] = [];
  output.on('data', (d: Buffer) => chunks.push(d.toString()));
  return { input, output, getOutput: () => chunks.join('') };
}

function waitFor(getOutput: () => string, substring: string, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = (): void => {
      if (getOutput().includes(substring)) return resolve();
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`timed out waiting for output to contain "${substring}"`));
      }
      setTimeout(check, 5);
    };
    check();
  });
}

async function run(
  args: string[],
  cwd: string,
  streams?: { input?: PromptStreams['input']; output?: PromptStreams['output'] },
): Promise<{ lines: string[]; error?: Error }> {
  const program = buildCli();
  const lines: string[] = [];
  registerInitCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerMilestoneAddCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerMilestoneReviewCommand(program, {
    root: cwd,
    write: (s) => lines.push(s),
    input: streams?.input,
    output: streams?.output,
  });
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

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'pitway-review-interactive-'));
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

describe('promptForRoles (unit-level, injected streams)', () => {
  it('accepts a valid comma-separated selection', async () => {
    const { input, output, getOutput } = makeStreams(true);
    const promise = promptForRoles({ input, output });
    await waitFor(getOutput, '> ');
    input.write('1,4\n');
    await expect(promise).resolves.toEqual(['developer', 'qa']);
  });

  it('re-prompts once on invalid input, then accepts a valid one', async () => {
    const { input, output, getOutput } = makeStreams(true);
    const promise = promptForRoles({ input, output });
    await waitFor(getOutput, '> ');
    input.write('bogus\n');
    await waitFor(getOutput, 'Invalid selection');
    input.write('2\n');
    await expect(promise).resolves.toEqual(['architect']);
  });

  it('refuses after two consecutive invalid attempts', async () => {
    const { input, output, getOutput } = makeStreams(true);
    const promise = promptForRoles({ input, output });
    await waitFor(getOutput, '> ');
    input.write('bogus\n');
    await waitFor(getOutput, 'Invalid selection');
    input.write('also bogus\n');
    await expect(promise).rejects.toThrow(ReviewPromptError);
  });
});

describe('milestone-review start interactive selection (CLI level)', () => {
  it('prompts and opens a session when --roles is omitted on a TTY', async () => {
    const id = await addDraftMilestone();
    const { input, output, getOutput } = makeStreams(true);
    const promise = run(['milestone-review', 'start', id, '--json'], root, { input, output });
    await waitFor(getOutput, '> ');
    input.write('1,4\n');
    const { lines, error } = await promise;
    expect(error).toBeUndefined();
    const view = JSON.parse(lines[0]!) as { roles: string[] };
    expect(view.roles).toEqual(['developer', 'qa']);
  });

  it('refuses when --roles is omitted and input is not a TTY, naming the flag', async () => {
    const id = await addDraftMilestone();
    const { input, output } = makeStreams(false);
    const { error } = await run(['milestone-review', 'start', id], root, { input, output });
    expect(error).toBeDefined();
    expect(error!.message).toContain('--roles');
  });

  it('never prompts when --roles is supplied, even on a TTY', async () => {
    const id = await addDraftMilestone();
    const { input, output, getOutput } = makeStreams(true);
    const { lines, error } = await run(
      ['milestone-review', 'start', id, '--roles', 'developer', '--json'],
      root,
      { input, output },
    );
    expect(error).toBeUndefined();
    expect(getOutput()).toBe('');
    const view = JSON.parse(lines[0]!) as { roles: string[] };
    expect(view.roles).toEqual(['developer']);
  });
});
