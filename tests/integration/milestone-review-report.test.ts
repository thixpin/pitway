import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCli } from '../../src/cli/index.js';
import { registerInitCommand } from '../../src/cli/commands/init.js';
import { registerMilestoneAddCommand } from '../../src/cli/commands/milestone-add.js';
import { registerMilestoneReviewCommand } from '../../src/cli/commands/milestone-review.js';
import { registerResumeCommand } from '../../src/cli/commands/resume.js';

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
  registerResumeCommand(program, { root: cwd, write: (s) => lines.push(s) });
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

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'pitway-review-report-'));
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

describe('milestone-review report', () => {
  it('orders findings by severity, shows pending roles, and includes honesty text', async () => {
    const id = await addDraftMilestone();
    await run(['milestone-review', 'start', id, '--roles', 'developer,architect', '--json'], root);

    const file = writeFindingsFile(`findings:
  - severity: minor
    finding: A small nit.
    recommendation: Rename it.
  - severity: blocker
    finding: A big problem.
    recommendation: Fix it now.
  - severity: major
    finding: A medium problem.
    recommendation: Fix it soon.
`);
    await run(['milestone-review', 'record', id, '--role', 'developer', '--file', file], root);

    const { lines, error } = await run(['milestone-review', 'report', id, '--json'], root);
    expect(error).toBeUndefined();
    const view = JSON.parse(lines[0]!) as {
      roles: Array<{ role: string; recorded: boolean; findings: Array<{ severity: string }> }>;
      pendingRoles: string[];
      honesty: string[];
    };
    const developer = view.roles.find((r) => r.role === 'developer')!;
    expect(developer.findings.map((f) => f.severity)).toEqual(['blocker', 'major', 'minor']);
    expect(view.pendingRoles).toEqual(['architect']);
    expect(view.honesty.join(' ')).toContain('opinion-evidence');
    expect(view.honesty.join(' ').toLowerCase()).toContain('developer/driver');
  });

  it('lists a superseded-snapshot count when a role re-records', async () => {
    const id = await addDraftMilestone();
    await run(['milestone-review', 'start', id, '--roles', 'developer', '--json'], root);
    await run(
      ['milestone-review', 'record', id, '--role', 'developer', '--file', writeFindingsFile('findings: []\n')],
      root,
    );
    await run(
      ['milestone-review', 'record', id, '--role', 'developer', '--file', writeFindingsFile('findings: []\n')],
      root,
    );
    const { lines } = await run(['milestone-review', 'report', id, '--json'], root);
    const view = JSON.parse(lines[0]!) as { roles: Array<{ role: string; supersededCount: number }> };
    expect(view.roles.find((r) => r.role === 'developer')?.supersededCount).toBe(1);
  });

  it('surfaces a shared-target conflict when two roles name the same target', async () => {
    const id = await addDraftMilestone();
    await run(['milestone-review', 'start', id, '--roles', 'developer,architect', '--json'], root);

    await run(
      [
        'milestone-review',
        'record',
        id,
        '--role',
        'developer',
        '--file',
        writeFindingsFile(`findings:
  - severity: major
    finding: T001 write_scope is too narrow.
    targets: [T001]
    recommendation: Widen it.
`),
      ],
      root,
    );
    await run(
      [
        'milestone-review',
        'record',
        id,
        '--role',
        'architect',
        '--file',
        writeFindingsFile(`findings:
  - severity: minor
    finding: T001's design is fine actually.
    targets: [T001]
    recommendation: No change needed.
`),
      ],
      root,
    );

    const { lines } = await run(['milestone-review', 'report', id, '--json'], root);
    const view = JSON.parse(lines[0]!) as {
      sharedTargetConflicts: Array<{ target: string; entries: Array<{ role: string }> }>;
    };
    expect(view.sharedTargetConflicts).toHaveLength(1);
    expect(view.sharedTargetConflicts[0]!.target).toBe('t001');
    expect(view.sharedTargetConflicts[0]!.entries.map((e) => e.role).sort()).toEqual([
      'architect',
      'developer',
    ]);
  });

  it('surfaces a declared conflicts_with disagreement', async () => {
    const id = await addDraftMilestone();
    await run(['milestone-review', 'start', id, '--roles', 'developer,architect', '--json'], root);

    await run(
      [
        'milestone-review',
        'record',
        id,
        '--role',
        'developer',
        '--file',
        writeFindingsFile(`findings:
  - severity: major
    finding: Disagrees with the architect's layering call.
    recommendation: Reconcile before deciding.
    conflicts_with: [architect]
`),
      ],
      root,
    );

    const { lines } = await run(['milestone-review', 'report', id, '--json'], root);
    const view = JSON.parse(lines[0]!) as {
      declaredConflicts: Array<{ role: string; conflictsWith: string[] }>;
    };
    expect(view.declaredConflicts).toEqual([
      { role: 'developer', conflictsWith: ['architect'], finding: expect.any(String) },
    ]);
  });

  it('flags an unknown ACnnn/Tnnn-shaped target, never refusing', async () => {
    const id = await addDraftMilestone();
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
    finding: Targets a task that will be renamed.
    targets: [T999]
    recommendation: Reconcile after rename.
`),
      ],
      root,
    );
    const { lines, error } = await run(['milestone-review', 'report', id, '--json'], root);
    expect(error).toBeUndefined();
    const view = JSON.parse(lines[0]!) as {
      roles: Array<{ findings: Array<{ unknownTargets: string[] }> }>;
    };
    expect(view.roles[0]!.findings[0]!.unknownTargets).toEqual(['t999']);
  });

  it('refuses when no review session has ever been recorded for the milestone', async () => {
    const id = await addDraftMilestone();
    const { error } = await run(['milestone-review', 'report', id], root);
    expect(error).toBeDefined();
    expect(error!.message).toContain('no review session');
  });

  it('reports an empty (clean) session with no findings', async () => {
    const id = await addDraftMilestone();
    await run(['milestone-review', 'start', id, '--roles', 'developer', '--json'], root);
    await run(
      ['milestone-review', 'record', id, '--role', 'developer', '--file', writeFindingsFile('findings: []\n')],
      root,
    );
    const { lines, error } = await run(['milestone-review', 'report', id, '--json'], root);
    expect(error).toBeUndefined();
    const view = JSON.parse(lines[0]!) as { roles: Array<{ findings: unknown[] }> };
    expect(view.roles[0]!.findings).toEqual([]);
  });
});

describe('pitway resume open-review discovery (AC006)', () => {
  it('is absent when no review session is open', async () => {
    const id = await addDraftMilestone();
    const { lines } = await run(['resume', '--json'], root);
    const view = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(view, 'openReview')).toBe(false);
    void id;
  });

  it('lists milestone, session id, roles, and recorded/pending counts when one is open', async () => {
    const id = await addDraftMilestone();
    const started = await run(
      ['milestone-review', 'start', id, '--roles', 'developer,architect', '--json'],
      root,
    );
    const session = JSON.parse(started.lines[0]!) as { id: string };
    await run(
      ['milestone-review', 'record', id, '--role', 'developer', '--file', writeFindingsFile('findings: []\n')],
      root,
    );

    const { lines } = await run(['resume', '--json'], root);
    const view = JSON.parse(lines[0]!) as {
      openReview: { milestone: string; sessionId: string; roles: string[]; recordedCount: number; pendingCount: number };
    };
    expect(view.openReview).toEqual({
      milestone: id,
      sessionId: session.id,
      roles: ['developer', 'architect'],
      recordedCount: 1,
      pendingCount: 1,
    });

    const human = await run(['resume'], root);
    expect(human.lines.join('\n')).toContain(session.id);
  });
});
