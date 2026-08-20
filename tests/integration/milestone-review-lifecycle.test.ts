import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCli, registerAllCommands } from '../../src/cli/index.js';

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

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
      detail: node -e "process.exit(0)"
    result: null
    usage: null
`;

// Written OUTSIDE the repo so scratch input files never count as dirty
// working-tree changes for the CLI commands this test chains into.
function writeInput(content: string, name: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'pitway-lifecycle-in-')), name);
  writeFileSync(path, content);
  return path;
}

async function addDraftMilestone(): Promise<string> {
  const contractPath = writeInput(CONTRACT_FIXTURE, 'contract.md');
  const tasksPath = writeInput(TASKS_FIXTURE, 'tasks.yaml');
  const added = await run(
    ['milestone-add', '--contract', contractPath, '--tasks', tasksPath, '--json'],
    root,
  );
  expect(added.error).toBeUndefined();
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
  root = mkdtempSync(join(tmpdir(), 'pitway-review-e2e-'));
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

describe('milestone-review full lifecycle (AC010)', () => {
  it('draft path: revise-while-open stales the session; a fresh session on the revision records cleanly and reports', async () => {
    const id = await addDraftMilestone();

    // start with two roles -> brief both.
    const started = await run(
      ['milestone-review', 'start', id, '--roles', 'developer,architect', '--json'],
      root,
    );
    expect(started.error).toBeUndefined();

    const brief1 = await run(['milestone-review', 'brief', id, '--role', 'developer'], root);
    expect(brief1.error).toBeUndefined();
    const brief2 = await run(['milestone-review', 'brief', id, '--role', 'architect'], root);
    expect(brief2.error).toBeUndefined();

    // record one, with findings on a shared target.
    const record1 = await run(
      [
        'milestone-review',
        'record',
        id,
        '--role',
        'developer',
        '--file',
        writeInput(
          `findings:
  - severity: major
    finding: T001's write_scope may be too narrow.
    targets: [T001]
    recommendation: Widen it before implementation.
`,
          'f1.yaml',
        ),
      ],
      root,
    );
    expect(record1.error).toBeUndefined();

    // milestone-add --replace revises the draft WHILE the session is open.
    const replaced = await run(
      [
        'milestone-add',
        '--contract',
        writeInput(CONTRACT_FIXTURE.replace('id: M999', `id: ${id}`), 'replacement-contract.md'),
        '--tasks',
        writeInput(TASKS_FIXTURE.replace('First task.', 'First task, revised.'), 'replacement-tasks.yaml'),
        '--replace',
        id,
        '--json',
      ],
      root,
    );
    expect(replaced.error).toBeUndefined();

    // the second role's record and any further brief refuse on the
    // definition-hash gate -- the revision survives the session (sessions
    // are never CLI-addressable by id, so the gate is only exercisable on
    // a still-open session).
    const staleRecord = await run(
      [
        'milestone-review',
        'record',
        id,
        '--role',
        'architect',
        '--file',
        writeInput('findings: []\n', 'f2.yaml'),
      ],
      root,
    );
    expect(staleRecord.error).toBeDefined();
    expect(staleRecord.error!.message).toContain('revised');

    const staleBrief = await run(['milestone-review', 'brief', id, '--role', 'developer'], root);
    expect(staleBrief.error).toBeDefined();
    expect(staleBrief.error!.message).toContain('revised');

    // decide rejected -- the abandonment path the stale diagnostic names.
    const rejected = await run(['milestone-review', 'decide', id, '--outcome', 'rejected'], root);
    expect(rejected.error).toBeUndefined();

    // a NEW session on the revised draft records both roles cleanly.
    const started2 = await run(
      ['milestone-review', 'start', id, '--roles', 'developer,architect', '--json'],
      root,
    );
    expect(started2.error).toBeUndefined();

    const recordDev = await run(
      [
        'milestone-review',
        'record',
        id,
        '--role',
        'developer',
        '--file',
        writeInput(
          `findings:
  - severity: minor
    finding: A small nit on the revised task.
    targets: [T001]
    recommendation: Rename for clarity.
`,
          'f3.yaml',
        ),
      ],
      root,
    );
    expect(recordDev.error).toBeUndefined();

    const recordArch = await run(
      [
        'milestone-review',
        'record',
        id,
        '--role',
        'architect',
        '--file',
        writeInput(
          `findings:
  - severity: blocker
    finding: The revised task still lacks a clear layering boundary.
    targets: [T001]
    recommendation: Split into two tasks.
`,
          'f4.yaml',
        ),
      ],
      root,
    );
    expect(recordArch.error).toBeUndefined();

    // report shows severity ordering, the overlap side by side, and the
    // honesty text.
    const report = await run(['milestone-review', 'report', id, '--json'], root);
    expect(report.error).toBeUndefined();
    const reportView = JSON.parse(report.lines[0]!) as {
      roles: Array<{ role: string; findings: Array<{ severity: string }> }>;
      sharedTargetConflicts: Array<{ target: string; entries: Array<{ role: string }> }>;
      honesty: string[];
    };
    const architect = reportView.roles.find((r) => r.role === 'architect')!;
    expect(architect.findings.map((f) => f.severity)).toEqual(['blocker']);
    expect(reportView.sharedTargetConflicts).toHaveLength(1);
    expect(reportView.sharedTargetConflicts[0]!.entries.map((e) => e.role).sort()).toEqual([
      'architect',
      'developer',
    ]);
    expect(reportView.honesty.join(' ')).toContain('opinion-evidence');

    // decide revision_requested names the two revision paths.
    const decided = await run(
      ['milestone-review', 'decide', id, '--outcome', 'revision_requested'],
      root,
    );
    expect(decided.error).toBeUndefined();
    expect(decided.lines.join('\n')).toContain('milestone-add --replace');
    expect(decided.lines.join('\n')).toContain('milestone-confirm --amend');
  });

  it('confirmed path: a real task transition interleaves with recording and never stales the hash', async () => {
    const id = await addDraftMilestone();
    const confirmed = await run(['milestone-confirm', id], root);
    expect(confirmed.error).toBeUndefined();

    const started = await run(
      ['milestone-review', 'start', id, '--roles', 'developer,architect', '--json'],
      root,
    );
    expect(started.error).toBeUndefined();

    const record1 = await run(
      [
        'milestone-review',
        'record',
        id,
        '--role',
        'developer',
        '--file',
        writeInput('findings: []\n', 'f1.yaml'),
      ],
      root,
    );
    expect(record1.error).toBeUndefined();

    // a REAL task-update transition runs -- reviews.yaml is
    // materialized-but-uncommitted (journal-pending), and this succeeds
    // with zero call-site changes (AC008's ride-along wiring).
    const transitioned = await run(['task-update', 'T001', 'in_progress'], root);
    expect(transitioned.error).toBeUndefined();

    // record the second role SUCCEEDS -- execution telemetry never stales
    // the definition hash; the interleaving is genuine, not ordered around.
    const record2 = await run(
      [
        'milestone-review',
        'record',
        id,
        '--role',
        'architect',
        '--file',
        writeInput('findings: []\n', 'f2.yaml'),
      ],
      root,
    );
    expect(record2.error).toBeUndefined();

    const decided = await run(['milestone-review', 'decide', id, '--outcome', 'accepted', '--json'], root);
    expect(decided.error).toBeUndefined();
    const decidedView = JSON.parse(decided.lines[0]!) as { outcome: string };
    expect(decidedView.outcome).toBe('accepted');
  });

  it('refuses a second open session while one is already open', async () => {
    const id = await addDraftMilestone();
    await run(['milestone-review', 'start', id, '--roles', 'developer', '--json'], root);
    const { error } = await run(['milestone-review', 'start', id, '--roles', 'qa'], root);
    expect(error).toBeDefined();
  });

  it('refuses start/brief/record/decide against a terminal (completed) milestone', async () => {
    const id = seedTerminalMilestone('completed');

    const start = await run(['milestone-review', 'start', id, '--roles', 'developer'], root);
    expect(start.error).toBeDefined();

    const brief = await run(['milestone-review', 'brief', id, '--role', 'developer'], root);
    expect(brief.error).toBeDefined();

    const record = await run(
      ['milestone-review', 'record', id, '--role', 'developer', '--file', writeInput('findings: []\n', 'f.yaml')],
      root,
    );
    expect(record.error).toBeDefined();

    const decide = await run(['milestone-review', 'decide', id, '--outcome', 'rejected'], root);
    expect(decide.error).toBeDefined();
  });
});
