import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCli } from '../../src/cli/index.js';
import { registerInitCommand } from '../../src/cli/commands/init.js';
import { registerMilestoneAddCommand } from '../../src/cli/commands/milestone-add.js';
import { registerMilestoneConfirmCommand } from '../../src/cli/commands/milestone-confirm.js';
import { registerQuickChangeCommand } from '../../src/cli/commands/quick-change.js';
import { registerResumeCommand } from '../../src/cli/commands/resume.js';
import { loadBacklog, saveBacklog } from '../../src/state/store.js';
import type { BacklogItem } from '../../src/state/schemas.js';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

const commitCount = (cwd: string): number => Number(git(['rev-list', '--count', 'HEAD'], cwd).trim());
const headMessage = (cwd: string): string => git(['log', '-1', '--format=%B'], cwd);
const headFiles = (cwd: string): string[] =>
  git(['show', '--name-only', '--format='], cwd)
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .sort();

// A minimal, valid draft milestone -- only used by the active_milestone
// gate smoke test below, which needs a real in_progress milestone to prove
// `quick-change create` refuses while one is active.
const CONTRACT_FIXTURE = `---
schema_version: 1
id: M999
title: Placeholder milestone
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
      - It works
    relevant_files:
      - src/a.ts
    verification:
      strategy: tdd
      detail: npm test
    result: null
    usage: null
`;

let root: string;

async function run(args: string[], cwd: string): Promise<{ lines: string[]; error?: Error }> {
  const program = buildCli();
  const lines: string[] = [];
  registerInitCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerMilestoneAddCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerMilestoneConfirmCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerQuickChangeCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerResumeCommand(program, { root: cwd, write: (s) => lines.push(s) });
  try {
    await program.parseAsync(['node', 'pitway', ...args]);
    return { lines };
  } catch (error) {
    return { lines, error: error as Error };
  }
}

// A real, cheap, cross-platform command check whose pass/fail is controlled
// purely by target.txt's content -- mirrors verification-repair.test.ts's
// CT001 fixture command.
const PASSING_VERIFY =
  'node -e "const fs=require(\'fs\'); if(!fs.readFileSync(\'target.txt\',\'utf8\').includes(\'FIXED\')) process.exit(1)"';

async function create(
  objective = 'Fix the regression',
  scope = ['target.txt'],
  verify = PASSING_VERIFY,
  options: { closes?: string } = {},
): Promise<{ lines: string[]; error?: Error }> {
  const args = ['quick-change', 'create', '--objective', objective, '--verify', verify, '--json'];
  for (const s of scope) args.push('--scope', s);
  if (options.closes !== undefined) args.push('--closes', options.closes);
  return run(args, root);
}

function idOf(lines: string[]): string {
  return (JSON.parse(lines[0]!) as { id: string }).id;
}

async function approve(id: string): Promise<{ lines: string[]; error?: Error }> {
  return run(['quick-change', 'approve', id, '--json'], root);
}

async function doRun(id: string): Promise<{ lines: string[]; error?: Error }> {
  return run(['quick-change', 'run', id, '--json'], root);
}

async function commit(id: string): Promise<{ lines: string[]; error?: Error }> {
  return run(['quick-change', 'commit', id, '--json'], root);
}

async function cancel(id: string): Promise<{ lines: string[]; error?: Error }> {
  return run(['quick-change', 'cancel', id, '--json'], root);
}

async function promote(id: string): Promise<{ lines: string[]; error?: Error }> {
  return run(['quick-change', 'promote', id, '--json'], root);
}

async function status(id?: string): Promise<{ lines: string[]; error?: Error }> {
  return run(id === undefined ? ['quick-change', 'status', '--json'] : ['quick-change', 'status', id, '--json'], root);
}

async function resumeHuman(): Promise<string> {
  const { lines, error } = await run(['resume'], root);
  expect(error).toBeUndefined();
  return lines.join('\n');
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'pitway-quickchange-'));
  git(['init', '-q'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  writeFileSync(join(root, 'README.md'), 'seed\n');
  writeFileSync(join(root, 'target.txt'), 'ORIGINAL\n');
  git(['add', 'README.md', 'target.txt'], root);
  git(['commit', '-q', '-m', 'init'], root);
  await run(['init'], root);
  // `init` writes .pitway/config.yaml, state.yaml, and the installed
  // .claude/ assets uncommitted (they only get folded into a commit at the
  // next milestone baseline). quick-change create requires a genuinely
  // clean tree at start, so commit them here as plain test setup, mirroring
  // readyForRepair's own uncommitted-write fold in
  // tests/integration/verification-repair.test.ts.
  git(['add', '-A'], root);
  git(['commit', '-q', '-m', 'test: seed pitway state'], root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('quick-change create/approve/run/commit end to end', () => {
  it('lands a real commit carrying only a PitWay-Change trailer once approved and run passes', async () => {
    const created = await create();
    expect(created.error).toBeUndefined();
    const id = idOf(created.lines);
    expect(id).toMatch(/^qc-/);

    expect((await approve(id)).error).toBeUndefined();

    // RED — verify fails before fix
    const red = await doRun(id);
    expect((JSON.parse(red.lines[0]!) as { status: string }).status).toBe('fail');
    writeFileSync(join(root, 'target.txt'), 'FIXED\n');
    const ran = await doRun(id);
    expect(ran.error).toBeUndefined();
    expect((JSON.parse(ran.lines[0]!) as { status: string }).status).toBe('pass');

    const before = commitCount(root);
    const committed = await commit(id);
    expect(committed.error).toBeUndefined();
    const view = JSON.parse(committed.lines[0]!) as { outcome: string; commit: string };
    expect(view.outcome).toBe('committed');
    expect(commitCount(root)).toBe(before + 1);
    expect(view.commit).toBe(git(['rev-parse', 'HEAD'], root).trim());

    expect(headFiles(root)).toEqual(['target.txt']);
    const message = headMessage(root);
    expect(message).toContain(`PitWay-Change: ${id}`);
    expect(message).not.toContain('PitWay-Milestone');
    expect(message).not.toContain('PitWay-Task');
    expect(git(['status', '--porcelain'], root).trim()).toBe('');
  });

  it('blocks commit when the latest run failed, leaving no commit behind', async () => {
    const created = await create();
    const id = idOf(created.lines);
    await approve(id);

    // target.txt is left as ORIGINAL -- the verify command fails.
    const ran = await doRun(id);
    expect((JSON.parse(ran.lines[0]!) as { status: string }).status).toBe('fail');

    const before = commitCount(root);
    const committed = await commit(id);
    expect(committed.error?.message).toMatch(/no passing run/);
    expect(commitCount(root)).toBe(before);
  });
});

// M037/T001: seeds a pending backlog item directly (backlog add's CLI
// command requires an active milestone, which quick-change create's own
// gate forbids -- so this seeds the state file directly, committed,
// mirroring the unit-level fixtures in tests/unit/quick-change-commit.test.ts
// and tests/unit/quick-change-lifecycle.test.ts).
function makePendingBacklogItem(root: string, id: string, title = 'Some backlog item'): void {
  const backlog = loadBacklog(root);
  const item: BacklogItem = {
    id: id as BacklogItem['id'],
    title,
    reason: 'test fixture',
    status: 'pending',
    source: { milestone: null, task: null },
    created_at: new Date().toISOString(),
    resolved_at: null,
    promoted_to: null,
    archived_reason: null,
  };
  saveBacklog(root, { schema_version: backlog.schema_version, items: [...backlog.items, item] });
  git(['add', '.pitway/backlog.yaml'], root);
  git(['commit', '-q', '-m', 'test: seed backlog item'], root);
}

function backlogStatus(cwd: string, id: string): string | undefined {
  return loadBacklog(cwd).items.find((item) => item.id === id)?.status;
}

describe('quick-change create --closes <backlog-id> via the real CLI', () => {
  it('refuses an unknown or non-pending backlog id, with a clear error', async () => {
    const unknown = await create('Fix it', ['target.txt'], PASSING_VERIFY, { closes: 'B999' });
    expect(unknown.error?.message).toMatch(/B999/);
  });

  it('lands the fix and the backlog archive in exactly one commit, with only a PitWay-Change trailer', async () => {
    makePendingBacklogItem(root, 'B001');
    const created = await create('Fix it', ['target.txt'], PASSING_VERIFY, { closes: 'B001' });
    expect(created.error).toBeUndefined();
    const id = idOf(created.lines);
    expect((JSON.parse(created.lines[0]!) as { closesBacklogId?: string }).closesBacklogId).toBe('B001');

    await approve(id);
    await doRun(id); // RED
    writeFileSync(join(root, 'target.txt'), 'FIXED\n');
    await doRun(id); // GREEN

    const before = commitCount(root);
    const committed = await commit(id);
    expect(committed.error).toBeUndefined();
    expect(commitCount(root)).toBe(before + 1);

    expect(backlogStatus(root, 'B001')).toBe('archived');
    const message = headMessage(root);
    expect(message).toContain(`PitWay-Change: ${id}`);
    expect(message).not.toMatch(/PitWay-(?!Change)/);
    expect(git(['status', '--porcelain'], root).trim()).toBe('');
  });

  it('cancel and promote never archive the linked backlog item; it stays pending', async () => {
    makePendingBacklogItem(root, 'B001');
    const createdA = await create('Cancel me', ['target.txt'], PASSING_VERIFY, { closes: 'B001' });
    const idA = idOf(createdA.lines);
    expect((await cancel(idA)).error).toBeUndefined();
    expect(backlogStatus(root, 'B001')).toBe('pending');

    makePendingBacklogItem(root, 'B002');
    const createdB = await create('Promote me', ['target.txt'], PASSING_VERIFY, { closes: 'B002' });
    const idB = idOf(createdB.lines);
    expect((await promote(idB)).error).toBeUndefined();
    expect(backlogStatus(root, 'B002')).toBe('pending');
  });
});

describe('quick-change cancel', () => {
  it('cancels a draft change with no git operation', async () => {
    const created = await create();
    const id = idOf(created.lines);
    const before = commitCount(root);

    const cancelled = await cancel(id);
    expect(cancelled.error).toBeUndefined();
    expect((JSON.parse(cancelled.lines[0]!) as { status: string }).status).toBe('cancelled');
    expect(commitCount(root)).toBe(before);
  });

  it('cancels an approved change with no git operation', async () => {
    const created = await create();
    const id = idOf(created.lines);
    await approve(id);
    const before = commitCount(root);

    const cancelled = await cancel(id);
    expect(cancelled.error).toBeUndefined();
    expect((JSON.parse(cancelled.lines[0]!) as { status: string }).status).toBe('cancelled');
    expect(commitCount(root)).toBe(before);
  });

  it('refuses to cancel an already-committed change', async () => {
    const created = await create();
    const id = idOf(created.lines);
    await approve(id);
    // RED before GREEN
    await doRun(id);
    writeFileSync(join(root, 'target.txt'), 'FIXED\n');
    await doRun(id);
    expect((await commit(id)).error).toBeUndefined();

    const cancelled = await cancel(id);
    expect(cancelled.error?.message).toMatch(/not draft or approved/);
  });
});

describe('quick-change promote', () => {
  it('promotes a draft change, is terminal, and it can never be run or committed afterward', async () => {
    const created = await create();
    const id = idOf(created.lines);
    const before = commitCount(root);

    const promoted = await promote(id);
    expect(promoted.error).toBeUndefined();
    const view = JSON.parse(promoted.lines[0]!) as {
      id: string;
      status: string;
      objective: string;
      scope: string[];
    };
    expect(view).toMatchObject({ id, status: 'promoted', objective: 'Fix the regression', scope: ['target.txt'] });
    // No git operation of its own.
    expect(commitCount(root)).toBe(before);

    // Never committable/runnable as a quick-change again.
    expect((await approve(id)).error?.message).toMatch(/not draft/);
    expect((await doRun(id)).error?.message).toMatch(/not approved/);
    expect((await commit(id)).error?.message).toMatch(/not approved/);
    expect(commitCount(root)).toBe(before);
  });

  it('promotes an approved change and it can never be committed as a quick-change afterward', async () => {
    const created = await create();
    const id = idOf(created.lines);
    await approve(id);

    const promoted = await promote(id);
    expect(promoted.error).toBeUndefined();
    expect((JSON.parse(promoted.lines[0]!) as { status: string }).status).toBe('promoted');

    writeFileSync(join(root, 'target.txt'), 'FIXED\n');
    expect((await doRun(id)).error?.message).toMatch(/not approved/);
    expect((await commit(id)).error?.message).toMatch(/not approved/);
  });

  it('refuses to promote an already-committed change', async () => {
    const created = await create();
    const id = idOf(created.lines);
    await approve(id);
    await doRun(id);
    writeFileSync(join(root, 'target.txt'), 'FIXED\n');
    await doRun(id);
    expect((await commit(id)).error).toBeUndefined();

    const promoted = await promote(id);
    expect(promoted.error?.message).toMatch(/not draft or approved/);
  });
});

describe('pitway resume as the authoritative recovery view for a pending quick-change', () => {
  it('surfaces a draft change in plain human-readable output with no --json and no quick-change status call', async () => {
    const created = await create('Fix the flaky check', ['target.txt']);
    const id = idOf(created.lines);

    const output = await resumeHuman();
    expect(output).toContain(id);
    expect(output).toContain('draft');
    expect(output).toContain('Fix the flaky check');
  });

  it('surfaces an approved change and stops surfacing it once committed', async () => {
    const created = await create();
    const id = idOf(created.lines);
    await approve(id);

    const beforeCommit = await resumeHuman();
    expect(beforeCommit).toContain(id);
    expect(beforeCommit).toContain('approved');

    await doRun(id);
    writeFileSync(join(root, 'target.txt'), 'FIXED\n');
    await doRun(id);
    expect((await commit(id)).error).toBeUndefined();

    const afterCommit = await resumeHuman();
    expect(afterCommit).not.toContain(id);
  });

  it('stops surfacing a cancelled or promoted change', async () => {
    const created = await create();
    const id = idOf(created.lines);
    expect((await cancel(id)).error).toBeUndefined();
    expect(await resumeHuman()).not.toContain(id);

    const created2 = await create('Another fix', ['target.txt']);
    const id2 = idOf(created2.lines);
    expect((await promote(id2)).error).toBeUndefined();
    expect(await resumeHuman()).not.toContain(id2);
  });

  it('quick-change status also works standalone, but resume alone is proven sufficient without it (AC003)', async () => {
    const created = await create();
    const id = idOf(created.lines);

    // Resume alone already proved sufficient in the tests above, with no
    // status call anywhere in their path. This test additionally proves
    // `quick-change status` itself works, as an independent convenience --
    // never a replacement for the resume assertions above.
    const single = await status(id);
    expect(single.error).toBeUndefined();
    expect(JSON.parse(single.lines[0]!)).toMatchObject({ id, status: 'draft' });

    const listed = await status();
    expect(listed.error).toBeUndefined();
    const all = JSON.parse(listed.lines[0]!) as Array<{ id: string }>;
    expect(all.map((c) => c.id)).toContain(id);
  });
});

describe('quick-change create gates (smoke: built by a prior task, exercised here through the real CLI)', () => {
  it('refuses while a milestone is active', async () => {
    const contract = join(root, 'draft-contract.md');
    const tasks = join(root, 'draft-tasks.yaml');
    writeFileSync(contract, CONTRACT_FIXTURE);
    writeFileSync(tasks, TASKS_FIXTURE);
    expect((await run(['milestone-add', '--contract', contract, '--tasks', tasks], root)).error).toBeUndefined();
    rmSync(contract);
    rmSync(tasks);
    expect((await run(['milestone-confirm', 'M001'], root)).error).toBeUndefined();

    const { error } = await create();
    expect(error?.message).toMatch(/active milestone/);
  });

  it('refuses on a dirty working tree', async () => {
    writeFileSync(join(root, 'stray.txt'), 'uncommitted\n');
    const { error } = await create();
    expect(error?.message).toMatch(/working tree is not clean/);
  });
});

// AC005/T005: a genuinely fresh init, never committed as test setup (unlike
// the shared beforeEach above, which commits init's output specifically so
// the OLD, unfixed create gate would allow the rest of this file's tests
// to run at all) -- exercises the real fix, own local roots throughout.
describe('quick-change after a fresh, uncommitted pitway init (T005/AC005)', () => {
  function makeFreshRoot(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    git(['init', '-q'], dir);
    git(['config', 'user.email', 'test@example.com'], dir);
    git(['config', 'user.name', 'Test'], dir);
    writeFileSync(join(dir, 'README.md'), 'seed\n');
    writeFileSync(join(dir, 'target.txt'), 'ORIGINAL\n');
    git(['add', 'README.md', 'target.txt'], dir);
    git(['commit', '-q', '-m', 'init'], dir);
    return dir;
  }

  async function createIn(
    cwd: string,
    objective = 'Fix the regression',
    scope = ['target.txt'],
    verify = PASSING_VERIFY,
  ): Promise<{ lines: string[]; error?: Error }> {
    const args = ['quick-change', 'create', '--objective', objective, '--verify', verify, '--json'];
    for (const s of scope) args.push('--scope', s);
    return run(args, cwd);
  }

  it('a fresh default init immediately followed by create succeeds with no other changes', async () => {
    const freshRoot = makeFreshRoot('pitway-qc-fresh-');
    try {
      const initResult = await run(['init'], freshRoot);
      expect(initResult.error).toBeUndefined();
      const { error } = await createIn(freshRoot);
      expect(error).toBeUndefined();
    } finally {
      rmSync(freshRoot, { recursive: true, force: true });
    }
  });

  it('the same sequence after pitway init --no-claude also succeeds', async () => {
    const freshRoot = makeFreshRoot('pitway-qc-fresh-noclaude-');
    try {
      await run(['init', '--no-claude'], freshRoot);
      const { error } = await createIn(freshRoot);
      expect(error).toBeUndefined();
    } finally {
      rmSync(freshRoot, { recursive: true, force: true });
    }
  });

  it('a fresh init plus one arbitrary extra untracked file still refuses, naming only that file', async () => {
    const freshRoot = makeFreshRoot('pitway-qc-fresh-stray-');
    try {
      await run(['init'], freshRoot);
      writeFileSync(join(freshRoot, 'stray.txt'), 'uncommitted\n');
      const { error } = await createIn(freshRoot);
      expect(error?.message).toMatch(/working tree is not clean/);
      expect(error?.message).toContain('stray.txt');
      expect(error?.message).not.toContain('.pitway/config.yaml');
      expect(error?.message).not.toContain('.pitway/state.yaml');
    } finally {
      rmSync(freshRoot, { recursive: true, force: true });
    }
  });

  // T005: the dedicated mixed dirty-state regression case -- managed dirt
  // (.pitway/config.yaml, .pitway/state.yaml, every installed .claude/
  // asset) coexists with one genuinely unrelated dirty file.
  it('a mixed dirty state (managed dirt + one unrelated file) refuses, naming exactly and only the unrelated file', async () => {
    const freshRoot = makeFreshRoot('pitway-qc-fresh-mixed-');
    try {
      await run(['init'], freshRoot);
      writeFileSync(join(freshRoot, 'unrelated.txt'), 'developer work in progress\n');
      const { error } = await createIn(freshRoot);
      expect(error?.message).toMatch(/working tree is not clean/);
      expect(error?.message).toContain('unrelated.txt');
      expect(error?.message).not.toContain('.pitway/config.yaml');
      expect(error?.message).not.toContain('.pitway/state.yaml');
      expect(error?.message).not.toContain('.claude/');
    } finally {
      rmSync(freshRoot, { recursive: true, force: true });
    }
  });

  it('create/approve/run/commit succeeds end to end, landing one commit with the declared scope plus swept managed init output', async () => {
    const freshRoot = makeFreshRoot('pitway-qc-fresh-e2e-');
    try {
      await run(['init'], freshRoot);
      const created = await createIn(freshRoot);
      expect(created.error).toBeUndefined();
      const id = idOf(created.lines);

      expect((await run(['quick-change', 'approve', id, '--json'], freshRoot)).error).toBeUndefined();

      // RED before GREEN
      const red = await run(['quick-change', 'run', id, '--json'], freshRoot);
      expect((JSON.parse(red.lines[0]!) as { status: string }).status).toBe('fail');
      writeFileSync(join(freshRoot, 'target.txt'), 'FIXED\n');
      const ran = await run(['quick-change', 'run', id, '--json'], freshRoot);
      expect(ran.error).toBeUndefined();
      expect((JSON.parse(ran.lines[0]!) as { status: string }).status).toBe('pass');

      const committed = await run(['quick-change', 'commit', id, '--json'], freshRoot);
      expect(committed.error).toBeUndefined();
      expect((JSON.parse(committed.lines[0]!) as { outcome: string }).outcome).toBe('committed');

      expect(headFiles(freshRoot)).toContain('target.txt');
      expect(headFiles(freshRoot)).toContain('.pitway/config.yaml');
      expect(headFiles(freshRoot)).toContain('.pitway/state.yaml');
      expect(headFiles(freshRoot)).toContain('AGENTS.md');
      expect(git(['status', '--porcelain'], freshRoot).trim()).toBe('');
    } finally {
      rmSync(freshRoot, { recursive: true, force: true });
    }
  });
});

// M024/T002 (AC003): the CLI wiring's human-render paths (no --json), the
// create-option guards, the status unknown-id guard, and the CommandDeps
// default fallbacks (no deps object: root falls back to process.cwd(),
// write falls back to console.log) -- mirrors task-verify.test.ts's
// chdir+spy harness.
describe('quick-change CLI human output (no --json)', () => {
  async function human(args: string[]): Promise<{ lines: string[]; error?: Error }> {
    return run(['quick-change', ...args], root);
  }

  it('create/approve render the id, status, and objective line', async () => {
    const created = await human([
      'create',
      '--objective',
      'Fix the regression',
      '--scope',
      'target.txt',
      '--verify',
      PASSING_VERIFY,
    ]);
    expect(created.error).toBeUndefined();
    expect(created.lines).toHaveLength(1);
    expect(created.lines[0]).toMatch(/^🔧 qc-[0-9a-f]+ \(draft\) — Fix the regression$/);
    const id = created.lines[0]!.split(' ')[1]!;

    const approved = await human(['approve', id]);
    expect(approved.error).toBeUndefined();
    expect(approved.lines).toEqual([`🔧 ${id} (approved) — Fix the regression`]);
  });

  it('run renders the passed line on a pass and the failed line on a fail', async () => {
    const id = idOf((await create()).lines);
    await approve(id);

    const failed = await human(['run', id]);
    expect(failed.error).toBeUndefined();
    expect(failed.lines).toEqual([`🔧 ${id} run failed.`]);

    writeFileSync(join(root, 'target.txt'), 'FIXED\n');
    const passed = await human(['run', id]);
    expect(passed.error).toBeUndefined();
    expect(passed.lines).toEqual([`🔧 ${id} run passed.`]);
  });

  it('commit renders the committed line, then the already-committed line on a repeat', async () => {
    const id = idOf((await create()).lines);
    await approve(id);
    await doRun(id);
    writeFileSync(join(root, 'target.txt'), 'FIXED\n');
    await doRun(id);

    const committed = await human(['commit', id]);
    expect(committed.error).toBeUndefined();
    const sha = git(['rev-parse', 'HEAD'], root).trim();
    expect(committed.lines).toEqual([`🔧 Committed ${id} at ${sha}.`]);

    const again = await human(['commit', id]);
    expect(again.error).toBeUndefined();
    expect(again.lines).toEqual([`🔧 ${id} already committed at ${sha}.`]);
  });

  it('cancel and promote render their human lines', async () => {
    const id = idOf((await create('Cancel me')).lines);
    const cancelled = await human(['cancel', id]);
    expect(cancelled.error).toBeUndefined();
    expect(cancelled.lines).toEqual([`🔧 ${id} (cancelled) — Cancel me`]);

    const id2 = idOf((await create('Promote me')).lines);
    const promoted = await human(['promote', id2]);
    expect(promoted.error).toBeUndefined();
    expect(promoted.lines).toEqual([`🔧 ${id2} promoted; draft a milestone contract for: Promote me`]);
  });

  it('status renders the empty-state line, the full list, and the single-item line', async () => {
    const empty = await human(['status']);
    expect(empty.error).toBeUndefined();
    expect(empty.lines).toEqual(['No quick-changes recorded.']);

    const idA = idOf((await create('First fix')).lines);
    const idB = idOf((await create('Second fix')).lines);

    const listed = await human(['status']);
    expect(listed.error).toBeUndefined();
    expect(listed.lines.join('\n').split('\n')).toEqual([
      `🔧 ${idA} (draft) — First fix`,
      `🔧 ${idB} (draft) — Second fix`,
    ]);

    const single = await human(['status', idA]);
    expect(single.error).toBeUndefined();
    expect(single.lines).toEqual([`🔧 ${idA} (draft) — First fix`]);
  });
});

describe('quick-change TDD discipline via CLI (B020)', () => {
  it('commit via CLI refuses single-pass without prior fail (TDD), and succeeds with RED→GREEN', async () => {
    const verify = 'node -e "if(!require(\'fs\').readFileSync(\'target.txt\',\'utf8\').includes(\'FIXED\')) process.exit(1)"';
    const created = await create('TDD fix', ['target.txt'], verify);
    const id = idOf(created.lines);
    await approve(id);
    writeFileSync(join(root, 'target.txt'), 'FIXED\n');
    await doRun(id);
    const committedNoRed = await commit(id);
    expect(committedNoRed.error?.message).toMatch(/TDD|failing run|RED/i);
  });

  it('commit via CLI with --tdd-exempt allows single-pass', async () => {
    const args = ['quick-change', 'create', '--objective', 'Doc fix', '--scope', 'target.txt', '--verify', 'echo ok', '--tdd-exempt', 'doc-only: typo', '--json'];
    const created = await run(args, root);
    expect(created.error).toBeUndefined();
    const id = idOf(created.lines);
    expect((JSON.parse(created.lines[0]!) as any).tddExempt).toBe(true);
    await approve(id);
    writeFileSync(join(root, 'target.txt'), 'FIXED\n');
    await doRun(id);
    const committed = await commit(id);
    expect(committed.error).toBeUndefined();
  });

  it('RED→GREEN via CLI: fail then pass allows commit', async () => {
    const verify = 'node -e "if(!require(\'fs\').readFileSync(\'target.txt\',\'utf8\').includes(\'FIXED\')) process.exit(1)"';
    const created = await create('Behavior fix', ['target.txt'], verify);
    const id = idOf(created.lines);
    await approve(id);
    // RED — file still ORIGINAL
    const r1 = await doRun(id);
    expect((JSON.parse(r1.lines[0]!) as { status: string }).status).toBe('fail');
    writeFileSync(join(root, 'target.txt'), 'FIXED\n');
    const r2 = await doRun(id);
    expect((JSON.parse(r2.lines[0]!) as { status: string }).status).toBe('pass');
    const committed = await commit(id);
    expect(committed.error).toBeUndefined();
  });

  it('create via CLI refuses --tdd-exempt without reason', async () => {
    const args = ['quick-change', 'create', '--objective', 'Fix', '--scope', 'target.txt', '--verify', 'echo ok', '--tdd-exempt', '', '--json'];
    const { error } = await run(args, root);
    expect(error?.message).toMatch(/tdd-exempt|reason/i);
  });
});

describe('quick-change CLI guards', () => {
  it('create refuses without --objective, naming the flag', async () => {
    const { error } = await run(
      ['quick-change', 'create', '--verify', PASSING_VERIFY, '--scope', 'target.txt', '--json'],
      root,
    );
    expect(error?.message).toMatch(/quick-change create requires --objective <text>/);
  });

  it('create refuses without --verify, naming the flag', async () => {
    const { error } = await run(
      ['quick-change', 'create', '--objective', 'Fix it', '--scope', 'target.txt', '--json'],
      root,
    );
    expect(error?.message).toMatch(/quick-change create requires --verify <command>/);
  });

  it('status refuses an unknown change id by name', async () => {
    const { error } = await status('qc-doesnotexist');
    expect(error?.message).toMatch(/unknown quick-change qc-doesnotexist/);
  });
});

describe('quick-change CLI default deps (no deps object: process.cwd() root, console.log write)', () => {
  async function runDefault(args: string[]): Promise<{ calls: unknown[][]; caught?: unknown }> {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cwdBefore = process.cwd();
    process.chdir(root);
    let caught: unknown;
    let calls: unknown[][] = [];
    try {
      const program = buildCli();
      registerQuickChangeCommand(program);
      await program.parseAsync(['node', 'pitway', 'quick-change', ...args]);
    } catch (error) {
      caught = error;
    } finally {
      calls = logSpy.mock.calls;
      process.chdir(cwdBefore);
      logSpy.mockRestore();
    }
    return { calls, caught };
  }

  function jsonOf(calls: unknown[][]): Record<string, unknown> {
    expect(calls).toHaveLength(1);
    return JSON.parse(calls[0]?.[0] as string) as Record<string, unknown>;
  }

  it('create/approve/run/commit/status all resolve root from process.cwd() and write via console.log', async () => {
    const created = await runDefault([
      'create',
      '--objective',
      'Fix via defaults',
      '--scope',
      'target.txt',
      '--verify',
      PASSING_VERIFY,
      '--json',
    ]);
    expect(created.caught).toBeUndefined();
    const id = jsonOf(created.calls).id as string;
    expect(id).toMatch(/^qc-/);

    const approved = await runDefault(['approve', id, '--json']);
    expect(approved.caught).toBeUndefined();
    expect(jsonOf(approved.calls).status).toBe('approved');

    const red = await runDefault(['run', id, '--json']);
    expect(red.caught).toBeUndefined();
    expect(jsonOf(red.calls).status).toBe('fail');
    writeFileSync(join(root, 'target.txt'), 'FIXED\n');
    const ran = await runDefault(['run', id, '--json']);
    expect(ran.caught).toBeUndefined();
    expect(jsonOf(ran.calls).status).toBe('pass');

    const committed = await runDefault(['commit', id, '--json']);
    expect(committed.caught).toBeUndefined();
    expect(jsonOf(committed.calls).outcome).toBe('committed');

    const shown = await runDefault(['status', id, '--json']);
    expect(shown.caught).toBeUndefined();
    expect(jsonOf(shown.calls).status).toBe('committed');
  });

  it('cancel and promote also resolve root from process.cwd() and write via console.log', async () => {
    const createdA = await runDefault([
      'create',
      '--objective',
      'Cancel via defaults',
      '--scope',
      'target.txt',
      '--verify',
      PASSING_VERIFY,
      '--json',
    ]);
    const idA = jsonOf(createdA.calls).id as string;
    const cancelled = await runDefault(['cancel', idA, '--json']);
    expect(cancelled.caught).toBeUndefined();
    expect(jsonOf(cancelled.calls).status).toBe('cancelled');

    const createdB = await runDefault([
      'create',
      '--objective',
      'Promote via defaults',
      '--scope',
      'target.txt',
      '--verify',
      PASSING_VERIFY,
      '--json',
    ]);
    const idB = jsonOf(createdB.calls).id as string;
    const promoted = await runDefault(['promote', idB, '--json']);
    expect(promoted.caught).toBeUndefined();
    expect(jsonOf(promoted.calls).status).toBe('promoted');
  });
});
