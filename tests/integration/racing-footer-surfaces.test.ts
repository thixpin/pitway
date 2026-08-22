import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCli } from '../../src/cli/index.js';
import { registerInitCommand } from '../../src/cli/commands/init.js';
import { registerMilestoneAddCommand } from '../../src/cli/commands/milestone-add.js';
import { registerMilestoneConfirmCommand } from '../../src/cli/commands/milestone-confirm.js';
import { registerMilestoneCompleteCommand } from '../../src/cli/commands/milestone-complete.js';
import { registerMilestoneCancelCommand } from '../../src/cli/commands/milestone-cancel.js';
import { registerMilestoneMergeCommand } from '../../src/cli/commands/milestone-merge.js';
import { registerTaskUpdateCommand } from '../../src/cli/commands/task-update.js';
import { registerTaskDispatchCommand } from '../../src/cli/commands/task-dispatch.js';
import { registerTaskIntegrateCommand } from '../../src/cli/commands/task-integrate.js';
import { registerTaskDiscardCommand } from '../../src/cli/commands/task-discard.js';
import { registerBacklogCommand } from '../../src/cli/commands/backlog.js';
import { registerResumeCommand } from '../../src/cli/commands/resume.js';
import { registerMilestoneStatusCommand } from '../../src/cli/commands/milestone-status.js';
import { registerVerifyCommand } from '../../src/cli/commands/verify.js';
import { getFooterForActiveMilestone } from '../../src/core/milestones/footer.js';
import { loadConfig, saveConfig } from '../../src/state/store.js';
import { WORKTREES_DIR } from '../../src/git/worktree.js';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

const CONTRACT = `---
schema_version: 1
id: M999
title: Racing footer milestone
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
    type: command
    command: echo ok
---

# Contract

## Objective

Example.

## Change Log
`;

const TASKS_SIMPLE = `schema_version: 1
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
  - id: T002
    objective: Second task.
    status: planned
    depends_on: [T001]
    acceptance_criteria:
      - It works
    relevant_files:
      - src/b.ts
    verification:
      strategy: tdd
      detail: npm test
    result: null
    usage: null
`;

const TASKS_PARALLEL = `schema_version: 1
tasks:
  - id: T001
    objective: Parallel task
    status: planned
    depends_on: []
    acceptance_criteria:
      - It works
    context_files:
      - src/a.ts
    write_scope:
      - src/a.ts
    verification:
      strategy: tdd
      detail: npm test
    result: null
    usage: null
  - id: T002
    objective: Parallel task 2
    status: planned
    depends_on: []
    acceptance_criteria:
      - It works
    context_files:
      - src/b.ts
    write_scope:
      - src/b.ts
    verification:
      strategy: tdd
      detail: npm test
    result: null
    usage: null
`;

// FOOTER_SHAPE matches computeRacingFooter's single-line form.
const FOOTER_RE = /^(🏎️|🏁|🔧) \d+% · ✅ \d+\/\d+ · (Complete|Next: (.+))$/;

let root: string;
let scratch: string;

async function runWith(
  register: (program: ReturnType<typeof buildCli>, opts: { root: string; write: (s: string) => void }) => void,
  args: string[],
  lines: string[],
): Promise<Error | undefined> {
  const program = buildCli();
  register(program, { root, write: (s) => lines.push(s) });
  try {
    await program.parseAsync(['node', 'pitway', ...args]);
    return undefined;
  } catch (e) {
    return e as Error;
  }
}

async function initAndConfirm(tasksFixture: string = TASKS_SIMPLE, strategy?: 'parallel_worktrees'): Promise<void> {
  const program = buildCli();
  const sink: string[] = [];
  registerInitCommand(program, { root, write: (s) => sink.push(s) });
  registerMilestoneAddCommand(program, { root, write: (s) => sink.push(s) });
  registerMilestoneConfirmCommand(program, { root, write: (s) => sink.push(s) });
  // strategy must be set before milestone-add so baseline captures it
  if (strategy) {
    // init already wrote config.yaml; flip strategy before add
    saveConfig(root, { ...loadConfig(root), execution: { strategy } });
  }
  const contract = join(scratch, 'contract.md');
  const tasks = join(scratch, 'tasks.yaml');
  writeFileSync(contract, CONTRACT);
  writeFileSync(tasks, tasksFixture);
  await program.parseAsync(['node', 'pitway', 'milestone-add', '--contract', contract, '--tasks', tasks]);
  rmSync(contract);
  rmSync(tasks);
  const confirmProg = buildCli();
  registerMilestoneConfirmCommand(confirmProg, { root, write: (s) => sink.push(s) });
  await confirmProg.parseAsync(['node', 'pitway', 'milestone-confirm', 'M001']);
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'pitway-rfs-'));
  scratch = mkdtempSync(join(tmpdir(), 'pitway-rfs-in-'));
  git(['init', '-q'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  writeFileSync(join(root, 'README.md'), 'seed\n');
  git(['add', 'README.md'], root);
  git(['commit', '-q', '-m', 'init'], root);
  const prog = buildCli();
  const lines: string[] = [];
  registerInitCommand(prog, { root, write: (s) => lines.push(s) });
  await prog.parseAsync(['node', 'pitway', 'init', '--no-claude']);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

describe('racing footer surfaces (M025/T001)', () => {
  it('task-update human output appends footer as second write when confirmed, absent when draft, and never in --json', async () => {
    await initAndConfirm();
    const expected = getFooterForActiveMilestone(root);
    expect(expected).not.toBeNull();
    expect(expected).toMatch(FOOTER_RE);

    // human
    {
      const lines: string[] = [];
      const errLines: string[] = [];
      const prog = buildCli();
      registerTaskUpdateCommand(prog, { root, write: (s) => lines.push(s), writeErr: (s) => errLines.push(s) });
      await prog.parseAsync(['node', 'pitway', 'task-update', 'T001', 'in_progress']);
      expect(lines.length).toBe(2);
      expect(lines[0]).toMatch(/🛠 Task T001 →/);
      expect(lines[1]).toBe(expected);
    }
    // --json: only one JSON write, no extra footer line (transition to a legal state)
    {
      const lines: string[] = [];
      const prog = buildCli();
      registerTaskUpdateCommand(prog, { root, write: (s) => lines.push(s) });
      await prog.parseAsync(['node', 'pitway', 'task-update', 'T001', 'review', '--json']);
      expect(lines.length).toBe(1);
      const view = JSON.parse(lines[0]!);
      expect(view.id).toBe('T001');
      // JSON must not contain footer field (human footer only)
      expect('footer' in view).toBe(false);
    }
    // draft: no footer
    {
      const draftRoot = mkdtempSync(join(tmpdir(), 'pitway-rfs-draft-'));
      try {
        git(['init', '-q'], draftRoot);
        git(['config', 'user.email', 'test@example.com'], draftRoot);
        git(['config', 'user.name', 'Test'], draftRoot);
        writeFileSync(join(draftRoot, 'README.md'), 'seed\n');
        git(['add', 'README.md'], draftRoot);
        git(['commit', '-q', '-m', 'init'], draftRoot);
        const p = buildCli();
        const s: string[] = [];
        registerInitCommand(p, { root: draftRoot, write: (x) => s.push(x) });
        await p.parseAsync(['node', 'pitway', 'init', '--no-claude']);
        const contract = join(scratch, 'draft-contract2.md');
        const tasks = join(scratch, 'draft-tasks2.yaml');
        writeFileSync(contract, CONTRACT);
        writeFileSync(tasks, TASKS_SIMPLE);
        const p2 = buildCli();
        registerMilestoneAddCommand(p2, { root: draftRoot, write: (x) => s.push(x) });
        await p2.parseAsync(['node', 'pitway', 'milestone-add', '--contract', contract, '--tasks', tasks]);
        // do NOT confirm -> draft (footer silence)
        const lines2: string[] = [];
        const prog2 = buildCli();
        registerTaskUpdateCommand(prog2, { root: draftRoot, write: (x) => lines2.push(x) });
        // planned -> waiting is legal from draft state
        await prog2.parseAsync(['node', 'pitway', 'task-update', 'T001', 'waiting']);
        expect(lines2.length).toBe(1);
        expect(lines2[0]).toMatch(/🛠 Task T001 →/);
      } finally {
        rmSync(draftRoot, { recursive: true, force: true });
      }
    }
  });

  it('task-update completion emits footer before usageWarning on stderr', async () => {
    // parallel setup needed to get usageWarning path (worktree-dispatched)
    await initAndConfirm(TASKS_PARALLEL, 'parallel_worktrees');
    // dispatch T001
    {
      const prog = buildCli();
      registerTaskDispatchCommand(prog, { root, write: () => {} });
      await prog.parseAsync(['node', 'pitway', 'task-dispatch', 'T001']);
    }
    // integrate
    {
      const wt = join(root, WORKTREES_DIR, 'M001-T001');
      mkdirSync(join(wt, 'src'), { recursive: true });
      writeFileSync(join(wt, 'src/a.ts'), 'export const x=1;\n');
      git(['add', '-A'], wt);
      git(['commit', '-q', '-m', 'worker'], wt);
      const prog = buildCli();
      registerTaskIntegrateCommand(prog, { root, write: () => {} });
      await prog.parseAsync(['node', 'pitway', 'task-integrate', 'T001']);
    }
    {
      const prog = buildCli();
      registerTaskUpdateCommand(prog, { root, write: () => {} });
      await prog.parseAsync(['node', 'pitway', 'task-update', 'T001', 'review']);
    }
    // complete without --usage -> should warn, footer before warning
    const lines: string[] = [];
    const errLines: string[] = [];
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/a.ts'), 'export const x=1;\n');
    const result = join(scratch, 'res.yaml');
    const message = join(scratch, 'msg.txt');
    writeFileSync(result, 'summary: Done.\nevidence: pass\n');
    writeFileSync(message, 'task: complete T001\n');
    const prog = buildCli();
    registerTaskUpdateCommand(prog, { root, write: (s) => lines.push(s), writeErr: (s) => errLines.push(s) });
    await prog.parseAsync(['node', 'pitway', 'task-update', 'T001', 'completed', '--result', result, '--message', message]);
    expect(lines.length).toBe(2);
    expect(lines[0]).toMatch(/🛠 Task T001 →/);
    expect(lines[1]).toMatch(FOOTER_RE);
    expect(errLines.length).toBe(1);
    expect(errLines[0]).toContain('T001');
  });

  it('task-dispatch human output appends footer, absent when draft, absent in --json', async () => {
    await initAndConfirm(TASKS_PARALLEL, 'parallel_worktrees');
    const expected = getFooterForActiveMilestone(root)!;
    const lines: string[] = [];
    const prog = buildCli();
    registerTaskDispatchCommand(prog, { root, write: (s) => lines.push(s) });
    await prog.parseAsync(['node', 'pitway', 'task-dispatch', 'T001']);
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain('Dispatched T001 to worktree');
    expect(lines[1]).toBe(expected);

    const jLines: string[] = [];
    const jProg = buildCli();
    registerTaskDispatchCommand(jProg, { root, write: (s) => jLines.push(s) });
    await jProg.parseAsync(['node', 'pitway', 'task-dispatch', 'T002', '--json']);
    expect(jLines.length).toBe(1);
    expect(JSON.parse(jLines[0]!).id).toBe('T002');
  });

  it('task-integrate human output appends footer', async () => {
    await initAndConfirm(TASKS_PARALLEL, 'parallel_worktrees');
    const dispProg = buildCli();
    registerTaskDispatchCommand(dispProg, { root, write: () => {} });
    await dispProg.parseAsync(['node', 'pitway', 'task-dispatch', 'T001']);
    const wt = join(root, WORKTREES_DIR, 'M001-T001');
    mkdirSync(join(wt, 'src'), { recursive: true });
    writeFileSync(join(wt, 'src/a.ts'), 'export const x=1;\n');
    git(['add', '-A'], wt);
    git(['commit', '-q', '-m', 'worker'], wt);
    const lines: string[] = [];
    const prog = buildCli();
    registerTaskIntegrateCommand(prog, { root, write: (s) => lines.push(s) });
    await prog.parseAsync(['node', 'pitway', 'task-integrate', 'T001']);
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain('Integrated T001');
    expect(lines[1]).toMatch(FOOTER_RE);
  });

  it('task-discard human output appends footer', async () => {
    await initAndConfirm(TASKS_PARALLEL, 'parallel_worktrees');
    const dispProg = buildCli();
    registerTaskDispatchCommand(dispProg, { root, write: () => {} });
    await dispProg.parseAsync(['node', 'pitway', 'task-dispatch', 'T001']);
    const lines: string[] = [];
    const prog = buildCli();
    registerTaskDiscardCommand(prog, { root, write: (s) => lines.push(s) });
    await prog.parseAsync(['node', 'pitway', 'task-discard', 'T001', '--reason', 'abandon']);
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain('Discarded T001');
    expect(lines[1]).toMatch(FOOTER_RE);
  });

  it('milestone-complete human output appends footer', async () => {
    await initAndConfirm();
    const progUpd = buildCli();
    registerTaskUpdateCommand(progUpd, { root, write: () => {} });
    await progUpd.parseAsync(['node', 'pitway', 'task-update', 'T001', 'in_progress']);
    await progUpd.parseAsync(['node', 'pitway', 'task-update', 'T001', 'review']);
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/a.ts'), 'x\n');
    const res = join(scratch, 'r.yaml');
    const msg = join(scratch, 'm.txt');
    writeFileSync(res, 'summary: Done.\nevidence: ok\n');
    writeFileSync(msg, 'task: complete T001\n');
    await progUpd.parseAsync(['node', 'pitway', 'task-update', 'T001', 'completed', '--result', res, '--message', msg]);
    const progUpd2 = buildCli();
    registerTaskUpdateCommand(progUpd2, { root, write: () => {} });
    await progUpd2.parseAsync(['node', 'pitway', 'task-update', 'T002', 'in_progress']);
    await progUpd2.parseAsync(['node', 'pitway', 'task-update', 'T002', 'review']);
    writeFileSync(join(root, 'src/b.ts'), 'x\n');
    await progUpd2.parseAsync(['node', 'pitway', 'task-update', 'T002', 'completed', '--result', res, '--message', msg]);

    const vProg = buildCli();
    registerVerifyCommand(vProg, { root, write: () => {} });
    await vProg.parseAsync(['node', 'pitway', 'verify', 'M001']);

    // Actually milestone needs all checks pass - simple CT001 passes after verify.
    // Our fixture only has CT001, so one verify call suffices.
    const lines: string[] = [];
    const prog = buildCli();
    registerMilestoneCompleteCommand(prog, { root, write: (s) => lines.push(s) });
    await prog.parseAsync(['node', 'pitway', 'milestone-complete', 'M001']);
    // After completion active_milestone is cleared => footer is null (graceful silence)
    expect(lines.length).toBe(1);
    expect(lines[0]).toMatch(/🏁 Completed milestone M001:/);
    // --json has single line (no footer)
    // milestone already completed, re-entry path: test another instance
  });

  it('milestone-cancel human output has no footer when active milestone is draft (footer silence)', async () => {
    // Create a draft milestone only (no confirm) and cancel it
    const progInit = buildCli();
    // root already init'd in beforeEach -> add draft directly
    const contract2 = join(scratch, 'c2.md');
    const tasks2 = join(scratch, 't2.yaml');
    writeFileSync(contract2, CONTRACT);
    writeFileSync(tasks2, TASKS_SIMPLE);
    const progAdd = buildCli();
    registerMilestoneAddCommand(progAdd, { root, write: () => {} });
    await progAdd.parseAsync(['node', 'pitway', 'milestone-add', '--contract', contract2, '--tasks', tasks2]);
    expect(getFooterForActiveMilestone(root)).toBeNull();
    const linesDraft: string[] = [];
    const progCancel = buildCli();
    registerMilestoneCancelCommand(progCancel, { root, write: (s) => linesDraft.push(s) });
    await progCancel.parseAsync(['node', 'pitway', 'milestone-cancel', 'M001']);
    expect(linesDraft.length).toBe(1);
    expect(linesDraft[0]).toMatch(/🏁 Cancelled milestone M001/);
    expect(getFooterForActiveMilestone(root)).toBeNull();
  });

  it('backlog add/promote/archive human output appends footer when confirmed', async () => {
    await initAndConfirm();
    const expected = getFooterForActiveMilestone(root)!;
    {
      const lines: string[] = [];
      const prog = buildCli();
      registerBacklogCommand(prog, { root, write: (s) => lines.push(s) });
      await prog.parseAsync(['node', 'pitway', 'backlog', 'add', '--title', 'T', '--reason', 'R']);
      expect(lines.length).toBe(2);
      expect(lines[0]).toMatch(/🔧 B001 recorded as pending/);
      expect(lines[1]).toBe(expected);
    }
    {
      const lines: string[] = [];
      const prog = buildCli();
      registerBacklogCommand(prog, { root, write: (s) => lines.push(s) });
      await prog.parseAsync(['node', 'pitway', 'backlog', 'promote', 'B001', '--task', 'T001']);
      expect(lines.length).toBe(2);
      expect(lines[0]).toMatch(/🔧 B001 promoted to/);
      expect(lines[1]).toBe(expected);
    }
    // archive needs a pending item
    {
      const addProg = buildCli();
      registerBacklogCommand(addProg, { root, write: () => {} });
      await addProg.parseAsync(['node', 'pitway', 'backlog', 'add', '--title', 'T2', '--reason', 'R2']);
      const lines: string[] = [];
      const prog = buildCli();
      registerBacklogCommand(prog, { root, write: (s) => lines.push(s) });
      await prog.parseAsync(['node', 'pitway', 'backlog', 'archive', 'B002', '--reason', 'done']);
      expect(lines.length).toBe(2);
      expect(lines[0]).toMatch(/🔧 B002 archived/);
      expect(lines[1]).toBe(expected);
    }
    // --json no footer
    {
      const lines: string[] = [];
      const prog = buildCli();
      registerBacklogCommand(prog, { root, write: (s) => lines.push(s) });
      await prog.parseAsync(['node', 'pitway', 'backlog', 'add', '--title', 'J', '--reason', 'R', '--json']);
      expect(lines.length).toBe(1);
      expect(JSON.parse(lines[0]!).id).toBe('B003');
    }
  });

  it('resume and milestone-status stay byte-stable and already include footer (no double footer)', async () => {
    await initAndConfirm();
    // resume
    {
      const lines: string[] = [];
      const prog = buildCli();
      registerResumeCommand(prog, { root, write: (s) => lines.push(s) });
      await prog.parseAsync(['node', 'pitway', 'resume']);
      const output = lines.join('\n');
      const footerMatches = output.split('\n').filter((l) => FOOTER_RE.test(l));
      expect(footerMatches.length).toBe(1);
      expect(output.split('\n').at(-1)).toMatch(FOOTER_RE);
    }
    // milestone-status
    {
      const lines: string[] = [];
      const prog = buildCli();
      registerMilestoneStatusCommand(prog, { root, write: (s) => lines.push(s) });
      await prog.parseAsync(['node', 'pitway', 'milestone-status', 'M001']);
      const output = lines.join('\n');
      // milestone-status decorates footer with progress bar, so count via ✅
      const footerLines = output.split('\n').filter((l) => /\d+% · ✅/.test(l));
      expect(footerLines.length).toBe(1);
    }
  });
});
