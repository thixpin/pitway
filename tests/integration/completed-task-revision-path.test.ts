import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCli } from '../../src/cli/index.js';
import { registerInitCommand } from '../../src/cli/commands/init.js';
import { registerMilestoneAddCommand } from '../../src/cli/commands/milestone-add.js';
import { registerMilestoneConfirmCommand } from '../../src/cli/commands/milestone-confirm.js';
import { registerMilestoneCompleteCommand } from '../../src/cli/commands/milestone-complete.js';
import { registerTaskUpdateCommand } from '../../src/cli/commands/task-update.js';
import { registerVerifyCommand } from '../../src/cli/commands/verify.js';
import { registerTaskStatusCommand } from '../../src/cli/commands/task-status.js';
import { loadContract, loadTasks } from '../../src/state/store.js';

// M007/T007/AC008: proves, using only already-shipped commands
// (milestone-add, milestone-confirm, task-update, milestone-complete, verify
// for manual-check recording) -- zero new Core/CLI code -- a supported path
// to deliver corrective work for a previously-completed task's deliverable
// later found incomplete. The convention: corrective work lands as a new
// task in a subsequent milestone, never by reopening the original.

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

function contractFixture(id: string, title: string): string {
  return `---
schema_version: 1
id: ${id}
title: ${title}
status: draft
requirement: null
confirmed_at: null
verification_approved_hash: null
acceptance_criteria:
  - id: AC001
    text: The scenario holds end to end.
verification:
  - id: CT001
    criterion: AC001
    type: manual
    instruction: Developer confirms the task's deliverable.
---

# Contract

## Objective

${title}.

## Change Log
`;
}

const TASKS_A_FIXTURE = `schema_version: 1
tasks:
  - id: T001
    objective: Write a deliberately incomplete deliverable.
    status: planned
    depends_on: []
    acceptance_criteria:
      - It exists
    relevant_files:
      - src.ts
    verification:
      strategy: manual
      detail: developer review
    result: null
    usage: null
`;

async function run(
  args: string[],
  cwd: string,
): Promise<{ lines: string[]; error?: Error }> {
  const program = buildCli();
  const lines: string[] = [];
  const deps = { root: cwd, write: (s: string) => lines.push(s) };
  registerInitCommand(program, deps);
  registerMilestoneAddCommand(program, deps);
  registerMilestoneConfirmCommand(program, deps);
  registerMilestoneCompleteCommand(program, deps);
  registerTaskUpdateCommand(program, deps);
  registerVerifyCommand(program, deps);
  registerTaskStatusCommand(program, deps);
  try {
    await program.parseAsync(['node', 'pitway', ...args]);
    return { lines };
  } catch (error) {
    return { lines, error: error as Error };
  }
}

function makeRepo(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  git(['init', '-q'], dir);
  git(['config', 'user.email', 'test@example.com'], dir);
  git(['config', 'user.name', 'Test'], dir);
  writeFileSync(join(dir, 'README.md'), 'seed\n');
  git(['add', 'README.md'], dir);
  git(['commit', '-q', '-m', 'init'], dir);
  return dir;
}

let scratch: string;
let root: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'pitway-ctr-in-'));
  root = makeRepo('pitway-ctr-');
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

describe('completed-task-revision path (M007/T007/AC008)', () => {
  // M016/T001: this test runs two full milestone lifecycles end to end --
  // roughly 15 real CLI invocations (init, milestone-add/confirm x2,
  // task-update x6, verify x2, milestone-complete x2), each spawning several
  // real `git` subprocesses -- against real temp git repos, never mocked.
  // Standalone, that finishes in well under a second. Diagnosed via the
  // debugging skill (M016/T001): reproduced directly by running two full
  // `vitest run` invocations concurrently (the same real-subprocess-load
  // condition `task-verify`/`verify` create by nesting a full suite run
  // inside itself, the shared trigger across M013/T008, M014 CT010, and
  // M015/T011). Under that load this test failed every time with
  // `Error: Test timed out in 5000ms` -- Vitest's default per-test
  // timeout -- never with a thrown GitError or a logic assertion failure;
  // several unrelated integration tests doing similarly heavy real-git-
  // subprocess work timed out the same way under the same induced load.
  // That rules out a PitWay defect in init's git-work-tree detection or
  // file-system writes (a real defect would surface as a thrown error or a
  // wrong result, not uniform timing-only failures across unrelated tests)
  // and points at inherent OS-level contention when many real git child
  // processes are spawned concurrently under load -- CPU/fork scheduling
  // delays that legitimately push this test's real subprocess work past
  // the default 5s budget without anything being logically wrong. Per
  // M017/T007 this is no longer a per-test override here: the 60s budget is
  // now the project-wide default (vitest.config.ts's testTimeout/
  // hookTimeout), so every heavy real-subprocess test gets the same
  // accommodation from one authoritative value, not a retry -- retrying
  // would hide a real failure if one ever occurs, whereas a wider budget for
  // work that is only ever slow, never wrong, does not.
  it('delivers corrective work as a new task in a subsequent milestone, never reopening the original', async () => {
    expect((await run(['init'], root)).error).toBeUndefined();

    // --- Milestone A: real lifecycle order, never task completion before
    // milestone confirmation -- milestone-add A, milestone-confirm A,
    // execute/complete A's task, milestone-complete A.
    const contractA = join(scratch, 'contract-a.md');
    const tasksA = join(scratch, 'tasks-a.yaml');
    writeFileSync(contractA, contractFixture('M001', 'Milestone A'));
    writeFileSync(tasksA, TASKS_A_FIXTURE);
    expect(
      (await run(['milestone-add', '--contract', contractA, '--tasks', tasksA], root)).error,
    ).toBeUndefined();
    expect((await run(['milestone-confirm', 'M001'], root)).error).toBeUndefined();

    expect((await run(['task-update', 'T001', 'in_progress'], root)).error).toBeUndefined();
    writeFileSync(join(root, 'src.ts'), '// deliberately incomplete\n');
    expect((await run(['task-update', 'T001', 'review'], root)).error).toBeUndefined();

    const resultA = join(scratch, 'result-a.yaml');
    const messageA = join(scratch, 'message-a.txt');
    writeFileSync(resultA, 'summary: Incomplete deliverable, intentionally.\nevidence: n/a\n');
    writeFileSync(messageA, 'task: complete T001\n\nDeliberately incomplete.\n');
    expect(
      (
        await run(
          ['task-update', 'T001', 'completed', '--result', resultA, '--message', messageA],
          root,
        )
      ).error,
    ).toBeUndefined();

    expect(
      (await run(['verify', 'M001', '--check', 'CT001', '--pass', '--evidence', 'reviewed'], root))
        .error,
    ).toBeUndefined();

    const completeA = await run(['milestone-complete', 'M001'], root);
    expect(completeA.error).toBeUndefined();

    const shaAfterA = git(['rev-parse', 'HEAD'], root).trim();
    const contractAAfter = loadContract(root, 'M001');
    expect(contractAAfter.frontmatter.status).toBe('completed');
    const tasksAAfter = loadTasks(root, 'M001');
    expect(tasksAAfter.tasks[0]!.status).toBe('completed');

    // --- Milestone B: only now (after A's milestone-complete) does the
    // corrective task exist -- a NEW task in a NEW milestone, never a
    // reopening of A's own task or a rewrite of A's completion commit.
    const contractB = join(scratch, 'contract-b.md');
    const tasksB = join(scratch, 'tasks-b.yaml');
    writeFileSync(contractB, contractFixture('M002', 'Milestone B'));
    writeFileSync(
      tasksB,
      `schema_version: 1
tasks:
  - id: T001
    objective: "Revise M001/T001's deliverable, found incomplete: complete the
      implementation left unfinished."
    status: planned
    depends_on: []
    acceptance_criteria:
      - The revision is complete
    relevant_files:
      - src.ts
    verification:
      strategy: manual
      detail: developer review
    result: null
    usage: null
`,
    );
    expect(
      (await run(['milestone-add', '--contract', contractB, '--tasks', tasksB], root)).error,
    ).toBeUndefined();
    expect((await run(['milestone-confirm', 'M002'], root)).error).toBeUndefined();

    expect((await run(['task-update', 'T001', 'in_progress'], root)).error).toBeUndefined();
    writeFileSync(join(root, 'src.ts'), '// now complete\nexport const x = 1;\n');
    expect((await run(['task-update', 'T001', 'review'], root)).error).toBeUndefined();

    const resultB = join(scratch, 'result-b.yaml');
    const messageB = join(scratch, 'message-b.txt');
    writeFileSync(
      resultB,
      'summary: Revises M001/T001, whose deliverable was found incomplete.\nevidence: src.ts now implements the intended behavior; corrective work per M007/AC008.\n',
    );
    writeFileSync(messageB, 'task: complete T001\n\nRevises M001/T001.\n');
    expect(
      (
        await run(
          ['task-update', 'T001', 'completed', '--result', resultB, '--message', messageB],
          root,
        )
      ).error,
    ).toBeUndefined();

    expect(
      (await run(['verify', 'M002', '--check', 'CT001', '--pass', '--evidence', 'reviewed'], root))
        .error,
    ).toBeUndefined();
    expect((await run(['milestone-complete', 'M002'], root)).error).toBeUndefined();

    // --- Assertions: A's completed task/commit are byte-for-byte unchanged
    // throughout B's entire lifecycle; no task ever left completed; B's
    // corrective work is separately verified and separately committed under
    // its own trailers.
    expect(git(['rev-parse', `${shaAfterA}`], root).trim()).toBe(shaAfterA);
    const contractAFinal = loadContract(root, 'M001');
    expect(contractAFinal.frontmatter.status).toBe('completed');
    const tasksAFinal = loadTasks(root, 'M001');
    expect(tasksAFinal.tasks[0]!.status).toBe('completed');
    expect(tasksAFinal.tasks[0]!.result?.summary).toBe('Incomplete deliverable, intentionally.');

    const commitAShow = git(['show', '--format=%B', '-s', shaAfterA], root);
    expect(commitAShow).toContain('PitWay-Milestone: M001');

    const tasksBFinal = loadTasks(root, 'M002');
    expect(tasksBFinal.tasks[0]!.status).toBe('completed');
    expect(tasksBFinal.tasks[0]!.result?.summary).toContain('M001/T001');

    const headSha = git(['rev-parse', 'HEAD'], root).trim();
    expect(headSha).not.toBe(shaAfterA);
    const headShow = git(['show', '--format=%B', '-s', headSha], root);
    expect(headShow).toContain('PitWay-Milestone: M002');

    // A's commit was never rewritten: its own trailer/subject is unchanged,
    // and it remains a real ancestor of the final HEAD.
    expect(git(['merge-base', '--is-ancestor', shaAfterA, headSha], root)).toBe('');
  });
});
