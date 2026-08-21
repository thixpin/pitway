import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCli } from '../../src/cli/index.js';
import { registerInitCommand } from '../../src/cli/commands/init.js';
import { registerMilestoneAddCommand } from '../../src/cli/commands/milestone-add.js';
import { registerMilestoneReviewCommand } from '../../src/cli/commands/milestone-review.js';
import { loadReviews } from '../../src/state/store.js';
import { deriveLatestFindingsByRole } from '../../src/core/reviews/roles.js';

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

function writeFindingsFile(content: string): string {
  const path = join(root, 'findings.yaml');
  writeFileSync(path, content);
  return path;
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'pitway-review-record-'));
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

describe('milestone-review record', () => {
  it('records a well-formed findings snapshot, normalizing targets', async () => {
    const id = await addDraftMilestone();
    await run(['milestone-review', 'start', id, '--roles', 'developer', '--json'], root);

    const file = writeFindingsFile(`findings:
  - severity: major
    finding: The write_scope for T001 omits a file it clearly writes.
    targets: [' T001 ', 'AC001']
    recommendation: Add the missing file.
`);
    const { lines, error } = await run(
      ['milestone-review', 'record', id, '--role', 'developer', '--file', file, '--json'],
      root,
    );
    expect(error).toBeUndefined();
    const view = JSON.parse(lines[0]!) as { findingsCount: number; role: string };
    expect(view.findingsCount).toBe(1);
    expect(view.role).toBe('developer');

    const reviews = loadReviews(root, id);
    const session = reviews.sessions[0]!;
    expect(session.findings).toHaveLength(1);
    expect(session.findings[0]!.findings[0]!.targets).toEqual(['t001', 'ac001']);
  });

  it('accepts an empty findings list as a valid, clean review', async () => {
    const id = await addDraftMilestone();
    await run(['milestone-review', 'start', id, '--roles', 'developer', '--json'], root);
    const file = writeFindingsFile('findings: []\n');
    const { error } = await run(
      ['milestone-review', 'record', id, '--role', 'developer', '--file', file],
      root,
    );
    expect(error).toBeUndefined();
  });

  it('re-recording a role appends a newer snapshot that wins derivation, without mutating the prior one', async () => {
    const id = await addDraftMilestone();
    await run(['milestone-review', 'start', id, '--roles', 'developer', '--json'], root);

    const first = writeFindingsFile(`findings:
  - severity: minor
    finding: First pass finding.
    recommendation: Fix it.
`);
    await run(['milestone-review', 'record', id, '--role', 'developer', '--file', first], root);

    const second = writeFindingsFile(`findings:
  - severity: blocker
    finding: Second pass finding.
    recommendation: Fix it now.
`);
    await run(['milestone-review', 'record', id, '--role', 'developer', '--file', second], root);

    const reviews = loadReviews(root, id);
    const session = reviews.sessions[0]!;
    expect(session.findings).toHaveLength(2);
    expect(session.findings[0]!.findings[0]!.finding).toBe('First pass finding.');
    expect(session.findings[1]!.findings[0]!.finding).toBe('Second pass finding.');

    const latest = deriveLatestFindingsByRole(session.findings);
    expect(latest.get('developer')?.findings[0]?.finding).toBe('Second pass finding.');
  });

  it('refuses a malformed findings file, naming the issue', async () => {
    const id = await addDraftMilestone();
    await run(['milestone-review', 'start', id, '--roles', 'developer', '--json'], root);
    const file = writeFindingsFile(`findings:
  - severity: not-a-real-severity
    finding: x
    recommendation: y
`);
    const { error } = await run(
      ['milestone-review', 'record', id, '--role', 'developer', '--file', file],
      root,
    );
    expect(error).toBeDefined();
    expect(error!.message).toContain('invalid findings file');
  });

  it('refuses when no session is open', async () => {
    const id = await addDraftMilestone();
    const file = writeFindingsFile('findings: []\n');
    const { error } = await run(
      ['milestone-review', 'record', id, '--role', 'developer', '--file', file],
      root,
    );
    expect(error).toBeDefined();
    expect(error!.message).toContain('no open review session');
  });

  it('refuses when the role is not part of the open session', async () => {
    const id = await addDraftMilestone();
    await run(['milestone-review', 'start', id, '--roles', 'developer', '--json'], root);
    const file = writeFindingsFile('findings: []\n');
    const { error } = await run(
      ['milestone-review', 'record', id, '--role', 'qa', '--file', file],
      root,
    );
    expect(error).toBeDefined();
    expect(error!.message).toContain('qa');
  });

  it('refuses against a terminal milestone', async () => {
    const id = seedTerminalMilestone('completed');
    const file = writeFindingsFile('findings: []\n');
    const { error } = await run(
      ['milestone-review', 'record', id, '--role', 'developer', '--file', file],
      root,
    );
    expect(error).toBeDefined();
    expect(error!.message).toContain('completed');
  });

  it('refuses on a definition-hash mismatch after a real milestone-add --replace revision', async () => {
    const id = await addDraftMilestone();
    await run(['milestone-review', 'start', id, '--roles', 'developer', '--json'], root);

    const contractPath = join(root, 'replacement-contract.md');
    const tasksPath = join(root, 'replacement-tasks.yaml');
    writeFileSync(contractPath, CONTRACT_FIXTURE.replace('id: M999', `id: ${id}`));
    writeFileSync(tasksPath, TASKS_FIXTURE.replace('First task.', 'A materially different task.'));
    await run(
      ['milestone-add', '--contract', contractPath, '--tasks', tasksPath, '--replace', id, '--json'],
      root,
    );
    unlinkSync(contractPath);
    unlinkSync(tasksPath);

    const file = writeFindingsFile('findings: []\n');
    const { error } = await run(
      ['milestone-review', 'record', id, '--role', 'developer', '--file', file],
      root,
    );
    expect(error).toBeDefined();
    expect(error!.message).toContain('revised');
  });
});

// M021/AC002 (B006): --usage mirrors task-update's own --usage parsing
// shape verbatim -- a measured figure only, never estimated. Omitting it
// leaves the recorded snapshot's usage null.
describe('milestone-review record --usage', () => {
  it('attaches a well-formed --usage figure to the recorded snapshot', async () => {
    const id = await addDraftMilestone();
    await run(['milestone-review', 'start', id, '--roles', 'developer', '--json'], root);
    const file = writeFindingsFile('findings: []\n');

    const { error } = await run(
      [
        'milestone-review',
        'record',
        id,
        '--role',
        'developer',
        '--file',
        file,
        '--usage',
        '{"input_tokens": 100, "output_tokens": 50, "total_tokens": 150}',
      ],
      root,
    );
    expect(error).toBeUndefined();

    const reviews = loadReviews(root, id);
    const snapshot = reviews.sessions[0]!.findings[0]!;
    expect(snapshot.usage).toEqual({ input_tokens: 100, output_tokens: 50, total_tokens: 150 });
  });

  it('leaves usage null when --usage is omitted, exactly like an inline task today', async () => {
    const id = await addDraftMilestone();
    await run(['milestone-review', 'start', id, '--roles', 'developer', '--json'], root);
    const file = writeFindingsFile('findings: []\n');

    await run(['milestone-review', 'record', id, '--role', 'developer', '--file', file], root);

    const reviews = loadReviews(root, id);
    expect(reviews.sessions[0]!.findings[0]!.usage).toBeNull();
  });

  it('refuses malformed --usage JSON, naming the issue', async () => {
    const id = await addDraftMilestone();
    await run(['milestone-review', 'start', id, '--roles', 'developer', '--json'], root);
    const file = writeFindingsFile('findings: []\n');

    const { error } = await run(
      ['milestone-review', 'record', id, '--role', 'developer', '--file', file, '--usage', 'not-json'],
      root,
    );
    expect(error).toBeDefined();
    expect(error!.message).toContain('invalid --usage JSON');
  });

  it('refuses a --usage figure with a negative token count, never estimating a substitute', async () => {
    const id = await addDraftMilestone();
    await run(['milestone-review', 'start', id, '--roles', 'developer', '--json'], root);
    const file = writeFindingsFile('findings: []\n');

    const { error } = await run(
      [
        'milestone-review',
        'record',
        id,
        '--role',
        'developer',
        '--file',
        file,
        '--usage',
        '{"total_tokens": -1}',
      ],
      root,
    );
    expect(error).toBeDefined();
    expect(error!.message).toContain('invalid --usage');
  });
});
