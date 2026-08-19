import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCli } from '../../src/cli/index.js';
import { registerInitCommand } from '../../src/cli/commands/init.js';
import { registerMilestoneAddCommand } from '../../src/cli/commands/milestone-add.js';
import { registerMilestoneConfirmCommand } from '../../src/cli/commands/milestone-confirm.js';
import { registerVerifyCommand } from '../../src/cli/commands/verify.js';
import { loadVerificationResults } from '../../src/state/store.js';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

const commitCount = (cwd: string): number => Number(git(['rev-list', '--count', 'HEAD'], cwd).trim());

let root: string;

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

// Cheap fixture commands only — never npm (running the real contract's
// commands from inside the test suite would recurse).
const DEFAULT_CHECKS = `  - id: CT001
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
`;

const FAILING_CHECKS = `  - id: CT001
    criterion: AC001
    type: command
    command: echo hello
  - id: CT002
    criterion: AC001
    type: command
    command: echo boom && exit 1
  - id: CT003
    criterion: AC001
    type: manual
    instruction: Check the docs.
`;

const makeContract = (verification: string): string => `---
schema_version: 1
id: M999
title: Verifiable milestone
status: draft
requirement: null
confirmed_at: null
verification_approved_hash: null
acceptance_criteria:
  - id: AC001
    text: Behavior holds.
verification:
${verification}---

# Contract

## Objective

Example.

## Change Log
`;

const TASKS_FIXTURE = `schema_version: 1
tasks:
  - id: T001
    objective: Only task.
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

async function run(args: string[], cwd: string): Promise<{ lines: string[]; error?: Error }> {
  const program = buildCli();
  const lines: string[] = [];
  registerInitCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerMilestoneAddCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerMilestoneConfirmCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerVerifyCommand(program, { root: cwd, write: (s) => lines.push(s) });
  try {
    await program.parseAsync(['node', 'pitway', ...args]);
    return { lines };
  } catch (error) {
    return { lines, error: error as Error };
  }
}

async function addMilestone(verification = DEFAULT_CHECKS): Promise<void> {
  const contract = join(root, 'draft-contract.md');
  const tasks = join(root, 'draft-tasks.yaml');
  writeFileSync(contract, makeContract(verification));
  writeFileSync(tasks, TASKS_FIXTURE);
  const { error } = await run(['milestone-add', '--contract', contract, '--tasks', tasks], root);
  expect(error).toBeUndefined();
  rmSync(contract);
  rmSync(tasks);
}

async function confirmed(verification = DEFAULT_CHECKS): Promise<void> {
  await addMilestone(verification);
  const { error } = await run(['milestone-confirm', 'M001'], root);
  expect(error).toBeUndefined();
}

function milestoneDirName(id: string): string {
  const dir = join(root, '.pitway', 'milestones');
  const match = readdirSync(dir).find((e) => e === id || e.startsWith(`${id}-`));
  if (!match) throw new Error(`no milestone directory found for ${id}`);
  return match;
}

const contractPath = (): string => join(root, '.pitway', 'milestones', milestoneDirName('M001'), 'contract.md');

function editContract(transform: (text: string) => string): void {
  writeFileSync(contractPath(), transform(readFileSync(contractPath(), 'utf8')));
}

const results = (): Array<{
  check: string;
  status: string;
  at: string;
  evidence: string;
  recorded_by: string;
}> => loadVerificationResults(root, 'M001').results;

interface RunView {
  passed: boolean;
  results: Array<{ check: string; status: string; evidence: string }>;
  pending: string[];
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'pitway-verify-'));
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

describe('pitway verify hash gate (AC001)', () => {
  it('refuses an unconfirmed milestone, executing and recording nothing', async () => {
    await addMilestone();
    const { error } = await run(['verify'], root);
    expect(error?.message).toMatch(/approved verification hash/);
    expect(error?.message).toMatch(/confirm/);
    expect(results()).toEqual([]);
  });

  it('refuses a hash mismatch before executing or recording anything', async () => {
    await confirmed();
    editContract((text) => text.replace('command: echo ok', 'command: touch pwned.txt'));

    const { error } = await run(['verify'], root);
    expect(error?.message).toMatch(/hash/);
    expect(error?.message).toMatch(/does not match/);
    // The tampered command never ran and nothing was recorded.
    expect(existsSync(join(root, 'pwned.txt'))).toBe(false);
    expect(results()).toEqual([]);

    // Developer recording is behind the same gate.
    const record = await run(['verify', '--check', 'CT003', '--pass', '--evidence', 'x'], root);
    expect(record.error?.message).toMatch(/hash/);
    expect(results()).toEqual([]);
  });

  it('works again after a milestone-confirm --amend re-approval', async () => {
    await confirmed();
    editContract((text) =>
      text
        .replace('command: echo ok', 'command: echo amended')
        .replace('## Change Log', '## Change Log\n\n- Adjusted CT002.'),
    );
    const refused = await run(['verify'], root);
    expect(refused.error?.message).toMatch(/hash/);

    // M005/T004: --amend no longer reads the hand-edited live contract.md —
    // it requires a validated --file draft carrying the desired content.
    const amendDraft = join(root, 'amend-draft.md');
    writeFileSync(amendDraft, readFileSync(contractPath(), 'utf8'));
    const amend = await run(['milestone-confirm', 'M001', '--amend', '--file', amendDraft], root);
    expect(amend.error).toBeUndefined();

    const { lines, error } = await run(['verify', '--json'], root);
    expect(error).toBeUndefined();
    const view = JSON.parse(lines[0]!) as RunView;
    expect(view.passed).toBe(true);
    const recorded = results();
    expect(recorded.map((r) => [r.check, r.status])).toEqual([
      ['CT001', 'pass'],
      ['CT002', 'pass'],
    ]);
    // The re-approved (amended) command is what executed.
    expect(recorded[1]!.evidence).toBe('amended');
  });
});

describe('pitway verify command checks (AC002)', () => {
  it('runs only approved command checks in contract order with trimmed evidence', async () => {
    await confirmed();
    const before = commitCount(root);
    const { lines, error } = await run(['verify', 'M001', '--json'], root);
    expect(error).toBeUndefined();

    const view = JSON.parse(lines[0]!) as RunView;
    expect(view.passed).toBe(true);
    expect(view.pending).toEqual(['CT003']);

    const recorded = results();
    expect(recorded.map((r) => [r.check, r.status, r.recorded_by])).toEqual([
      ['CT001', 'pass', 'command'],
      ['CT002', 'pass', 'command'],
    ]);
    expect(recorded[0]!.evidence).toBe('hello');
    for (const r of recorded) {
      expect(r.at).toMatch(TIMESTAMP_RE);
    }
    // verify records results locally; committing happens at a later boundary.
    expect(commitCount(root)).toBe(before);
    expect(git(['status', '--porcelain'], root)).toMatch(/verification-results\.yaml/);
  });

  it('records and reports a failing check without hiding other results', async () => {
    await confirmed(FAILING_CHECKS);
    const { lines, error } = await run(['verify', '--json'], root);
    expect(error).toBeUndefined();

    const view = JSON.parse(lines[0]!) as RunView;
    expect(view.passed).toBe(false);

    const recorded = results();
    expect(recorded.map((r) => [r.check, r.status])).toEqual([
      ['CT001', 'pass'],
      ['CT002', 'fail'],
    ]);
    expect(recorded[1]!.evidence).toContain('boom');
  });

  it('caps evidence at 200 characters', async () => {
    const longChecks = `  - id: CT001
    criterion: AC001
    type: command
    command: echo ${'x'.repeat(260)}
`;
    await confirmed(longChecks);
    const { error } = await run(['verify'], root);
    expect(error).toBeUndefined();
    expect(results()[0]!.evidence.length).toBe(200);
  });
});

describe('pitway verify --check developer recording (AC003)', () => {
  it('records manual checks as recorded_by developer', async () => {
    await confirmed();
    const { lines, error } = await run(
      ['verify', '--check', 'CT003', '--pass', '--evidence', 'docs reviewed', '--json'],
      root,
    );
    expect(error).toBeUndefined();
    const view = JSON.parse(lines[0]!) as { check: string; status: string };
    expect(view).toMatchObject({ check: 'CT003', status: 'pass' });

    const recorded = results();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      check: 'CT003',
      status: 'pass',
      evidence: 'docs reviewed',
      recorded_by: 'developer',
    });
    expect(recorded[0]!.at).toMatch(TIMESTAMP_RE);
  });

  it('refuses unknown check ids', async () => {
    await confirmed();
    const { error } = await run(['verify', '--check', 'CT099', '--pass', '--evidence', 'x'], root);
    expect(error?.message).toMatch(/CT099/);
    expect(results()).toEqual([]);
  });

  it('refuses developer recording of a command-type check', async () => {
    await confirmed();
    const { error } = await run(['verify', '--check', 'CT001', '--pass', '--evidence', 'x'], root);
    expect(error?.message).toMatch(/command/);
    expect(results()).toEqual([]);
  });

  it('refuses missing --evidence and ambiguous --pass/--fail', async () => {
    await confirmed();
    const noEvidence = await run(['verify', '--check', 'CT003', '--pass'], root);
    expect(noEvidence.error?.message).toMatch(/--evidence/);

    const both = await run(
      ['verify', '--check', 'CT003', '--pass', '--fail', '--evidence', 'x'],
      root,
    );
    expect(both.error?.message).toMatch(/--pass or --fail/);

    const neither = await run(['verify', '--check', 'CT003', '--evidence', 'x'], root);
    expect(neither.error?.message).toMatch(/--pass or --fail/);

    expect(results()).toEqual([]);
  });

  it('refuses --pass/--fail/--evidence without --check', async () => {
    await confirmed();
    const { error } = await run(['verify', '--pass'], root);
    expect(error?.message).toMatch(/--check/);
    expect(results()).toEqual([]);
  });
});

describe('pitway verify append-only results (AC004)', () => {
  it('appends fresh results on re-run without erasing history', async () => {
    await confirmed();
    await run(['verify'], root);
    const first = results();
    expect(first).toHaveLength(2);

    const { error } = await run(['verify'], root);
    expect(error).toBeUndefined();
    const second = results();
    expect(second).toHaveLength(4);
    // History is preserved verbatim; fresh entries follow it.
    expect(second.slice(0, 2)).toEqual(first);
    expect(second.map((r) => r.check)).toEqual(['CT001', 'CT002', 'CT001', 'CT002']);
  });

  it('keeps every developer recording; the latest per check is authoritative', async () => {
    await confirmed();
    await run(['verify', '--check', 'CT003', '--fail', '--evidence', 'docs missing'], root);
    const { error } = await run(
      ['verify', '--check', 'CT003', '--pass', '--evidence', 'docs added'],
      root,
    );
    expect(error).toBeUndefined();

    const recorded = results();
    expect(recorded.map((r) => [r.check, r.status])).toEqual([
      ['CT003', 'fail'],
      ['CT003', 'pass'],
    ]);
    // Latest entry for CT003 is the authoritative one.
    expect(recorded[recorded.length - 1]!.status).toBe('pass');
  });
});

describe('pitway verify milestone resolution', () => {
  it('refuses when no id is given and no milestone is active', async () => {
    const { error } = await run(['verify'], root);
    expect(error?.message).toMatch(/active milestone/);
  });
});
