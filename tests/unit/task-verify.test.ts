import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MISSING_HASH_MARKER, runTaskVerify, TaskVerifyError } from '../../src/core/tasks/verify.js';
import { appendJournalEntry, readJournal, type JournalTaskVerifyEvidence } from '../../src/state/journal.js';
import { createMilestoneDir, saveState, saveTasks } from '../../src/state/store.js';
import type { Task } from '../../src/state/schemas.js';

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'pitway-task-verify-'));
  git(['init', '-q'], repo);
  git(['config', 'user.email', 'test@example.com'], repo);
  git(['config', 'user.name', 'Test'], repo);
  writeFileSync(join(repo, 'README.md'), 'hello\n');
  git(['add', 'README.md'], repo);
  git(['commit', '-q', '-m', 'init'], repo);

  // Bare "M001" directory (empty title slugifies to '') so the on-disk
  // milestone dir name matches the milestone id exactly -- keeps every
  // path assertion below predictable.
  createMilestoneDir(repo, 'M001', '');
  saveState(repo, { schema_version: 1, active_milestone: 'M001', milestones: ['M001'] });
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

function baseTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'T001',
    objective: 'Do the thing',
    status: 'in_progress',
    depends_on: [],
    acceptance_criteria: ['AC001'],
    write_scope: ['src/thing.ts'],
    verification: { strategy: 'command', detail: 'exit 0' },
    result: null,
    attempts: 1,
    usage: null,
    ...overrides,
  };
}

// Writes tasks.yaml directly (no commit) -- mirrors task-update's own
// uncommitted write at the in_progress boundary, so tasks.yaml is genuinely
// dirty-but-allowed in every test exactly like it would be in real usage.
function setTasks(tasks: Task[]): void {
  saveTasks(repo, 'M001', { schema_version: 1, tasks });
}

function commitAll(message: string): void {
  git(['add', '-A'], repo);
  git(['commit', '-q', '-m', message], repo);
}

describe('runTaskVerify (AC001)', () => {
  it('refuses when the task is not in_progress', () => {
    setTasks([baseTask({ status: 'ready' })]);
    commitAll('baseline');
    expect(() => runTaskVerify(repo, 'T001')).toThrow(TaskVerifyError);
    expect(() => runTaskVerify(repo, 'T001')).toThrow(/in_progress/);
  });

  it('refuses a manual verification strategy with a clear message', () => {
    setTasks([baseTask({ verification: { strategy: 'manual', detail: 'inspect it' } })]);
    commitAll('baseline');
    expect(() => runTaskVerify(repo, 'T001')).toThrow(/manual/);
  });

  it('refuses a review verification strategy with a clear message', () => {
    setTasks([baseTask({ verification: { strategy: 'review', detail: 'inspect it' } })]);
    commitAll('baseline');
    expect(() => runTaskVerify(repo, 'T001')).toThrow(/review/);
  });

  it('accepts command and tdd strategies, executes the command, and persists a passing evidence record', () => {
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'thing.ts'), 'export const x = 1;\n');
    commitAll('baseline with src/thing.ts');

    setTasks([baseTask({ verification: { strategy: 'tdd', detail: 'exit 0' } })]); // dirty tasks.yaml only

    const record = runTaskVerify(repo, 'T001');
    expect(record.kind).toBe('task_verify_evidence');
    expect(record.milestone).toBe('M001');
    expect(record.taskId).toBe('T001');
    expect(record.attempts).toBe(1);
    expect(record.command).toBe('exit 0');
    expect(record.exitCode).toBe(0);
    expect(record.terminationReason).toBe('exited');
    expect(typeof record.durationMs).toBe('number');

    const all = readJournal(repo).filter(
      (r): r is JournalTaskVerifyEvidence => r.kind === 'task_verify_evidence',
    );
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe(record.id);
  });

  it('persists a fail-shaped record (nonzero exit) without throwing', () => {
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'thing.ts'), 'export const x = 1;\n');
    commitAll('baseline');
    setTasks([baseTask({ verification: { strategy: 'command', detail: 'exit 1' } })]);

    const record = runTaskVerify(repo, 'T001');
    expect(record.exitCode).toBe(1);
    expect(record.terminationReason).toBe('exited');
  });

  it('best-effort parses vitest-style pass/fail counts from combined output, leaving them absent when parsing fails', () => {
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'thing.ts'), 'export const x = 1;\n');
    commitAll('baseline');

    setTasks([
      baseTask({
        verification: {
          strategy: 'command',
          detail: `node -e "console.log('Tests  2 failed | 5 passed (7)')"`,
        },
      }),
    ]);
    const record = runTaskVerify(repo, 'T001');
    expect(record.passCount).toBe(5);
    expect(record.failCount).toBe(2);

    setTasks([baseTask({ attempts: 2, verification: { strategy: 'command', detail: 'exit 0' } })]);
    const record2 = runTaskVerify(repo, 'T001');
    expect(record2.passCount).toBeUndefined();
    expect(record2.failCount).toBeUndefined();
  });

  it('runs the optional typecheck command and persists its result', () => {
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'thing.ts'), 'export const x = 1;\n');
    commitAll('baseline');
    setTasks([baseTask({ verification: { strategy: 'command', detail: 'exit 0' } })]);

    const record = runTaskVerify(repo, 'T001', { typecheckCommand: 'exit 0' });
    expect(record.typecheck).toMatchObject({ command: 'exit 0', exitCode: 0 });
  });

  it('fingerprints a deleted declared path via the missing marker, not an error', () => {
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'thing.ts'), 'export const x = 1;\n');
    commitAll('baseline');

    rmSync(join(repo, 'src', 'thing.ts'));
    setTasks([baseTask()]);

    const record = runTaskVerify(repo, 'T001');
    expect(record.fingerprint.entries).toEqual([
      { path: 'src/thing.ts', state: 'missing', hash: MISSING_HASH_MARKER },
    ]);
  });

  it('hashes an untracked declared path by its real content', () => {
    setTasks([baseTask({ write_scope: ['src/new.ts'] })]);
    commitAll('baseline');
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'new.ts'), 'export const y = 2;\n');
    // tasks.yaml stays as committed above -- re-save with in_progress to
    // make it genuinely dirty like a real in_progress transition would.
    setTasks([baseTask({ write_scope: ['src/new.ts'] })]);

    const record = runTaskVerify(repo, 'T001');
    expect(record.fingerprint.entries).toHaveLength(1);
    expect(record.fingerprint.entries[0]?.path).toBe('src/new.ts');
    expect(record.fingerprint.entries[0]?.state).toBe('present');
    expect(record.fingerprint.entries[0]?.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(record.fingerprint.entries[0]?.hash).not.toBe(MISSING_HASH_MARKER);
  });

  it('verifies correctly through a valid rename with both old and new paths declared', () => {
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'old.ts'), 'export const old = 1;\n');
    setTasks([baseTask({ write_scope: ['src/old.ts', 'src/new.ts'] })]);
    commitAll('baseline with src/old.ts');

    rmSync(join(repo, 'src', 'old.ts'));
    writeFileSync(join(repo, 'src', 'new.ts'), 'export const renamed = 1;\n');
    setTasks([baseTask({ write_scope: ['src/old.ts', 'src/new.ts'] })]);

    const record = runTaskVerify(repo, 'T001');
    const byPath = Object.fromEntries(record.fingerprint.entries.map((e) => [e.path, e]));
    expect(byPath['src/old.ts']).toMatchObject({ state: 'missing', hash: MISSING_HASH_MARKER });
    expect(byPath['src/new.ts']?.state).toBe('present');
    expect(byPath['src/new.ts']?.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('refuses a one-sided rename with only the new path declared, naming the old path and its deleted status', () => {
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'old.ts'), 'export const old = 1;\n');
    setTasks([baseTask({ write_scope: ['src/old.ts'] })]);
    commitAll('baseline with src/old.ts');

    rmSync(join(repo, 'src', 'old.ts'));
    writeFileSync(join(repo, 'src', 'new.ts'), 'export const renamed = 1;\n');
    // Only the new path declared -- old.ts is undeclared and shows deleted.
    setTasks([baseTask({ write_scope: ['src/new.ts'] })]);

    expect(() => runTaskVerify(repo, 'T001')).toThrow(TaskVerifyError);
    try {
      runTaskVerify(repo, 'T001');
      throw new Error('expected runTaskVerify to throw');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('src/old.ts');
      expect(message).toContain('deleted');
    }
  });

  it('refuses a one-sided rename with only the old path declared, naming the new path and its untracked status', () => {
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'old.ts'), 'export const old = 1;\n');
    setTasks([baseTask({ write_scope: ['src/old.ts'] })]);
    commitAll('baseline with src/old.ts');

    rmSync(join(repo, 'src', 'old.ts'));
    writeFileSync(join(repo, 'src', 'new.ts'), 'export const renamed = 1;\n');
    // Only the old path declared -- new.ts is undeclared and shows untracked.
    setTasks([baseTask({ write_scope: ['src/old.ts'] })]);

    try {
      runTaskVerify(repo, 'T001');
      throw new Error('expected runTaskVerify to throw');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('src/new.ts');
      expect(message).toContain('untracked');
    }
  });

  it('refuses a declared path that is itself git-ignored, via a real git check-ignore call', () => {
    writeFileSync(join(repo, '.gitignore'), 'ignored.ts\n');
    setTasks([baseTask({ write_scope: ['ignored.ts'] })]);
    commitAll('baseline with .gitignore');

    writeFileSync(join(repo, 'ignored.ts'), 'export const z = 1;\n');
    // tasks.yaml already committed above with the right task shape; re-save
    // (identical content) is a no-op dirty-wise, so this test isolates the
    // ignore-check refusal from the dirty-subset check.
    setTasks([baseTask({ write_scope: ['ignored.ts'] })]);

    expect(() => runTaskVerify(repo, 'T001')).toThrow(TaskVerifyError);
    expect(() => runTaskVerify(repo, 'T001')).toThrow(/ignored\.ts/);
  });

  it('fingerprints identically regardless of declared write_scope order', () => {
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
    writeFileSync(join(repo, 'src', 'b.ts'), 'export const b = 1;\n');
    setTasks([baseTask({ write_scope: ['src/a.ts', 'src/b.ts'] })]);
    commitAll('baseline');
    const forward = runTaskVerify(repo, 'T001');

    setTasks([baseTask({ attempts: 2, write_scope: ['src/b.ts', 'src/a.ts'] })]);
    const reversed = runTaskVerify(repo, 'T001');

    expect(forward.fingerprint.entries).toEqual(reversed.fingerprint.entries);
  });

  it('verifies correctly for a legacy relevant_files-only task through the same fingerprint path', () => {
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'legacy.ts'), 'export const legacy = 1;\n');
    const { write_scope: _write_scope, ...rest } = baseTask();
    setTasks([{ ...rest, relevant_files: ['src/legacy.ts'] }]);
    commitAll('baseline');

    const record = runTaskVerify(repo, 'T001');
    expect(record.fingerprint.entries).toEqual([
      { path: 'src/legacy.ts', state: 'present', hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) },
    ]);
  });

  it('verifies successfully while the task\'s own tasks.yaml is dirty purely from its in_progress transition', () => {
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'thing.ts'), 'export const x = 1;\n');
    setTasks([baseTask({ status: 'ready', attempts: undefined })]);
    commitAll('baseline (ready)');

    // Simulate task-update's own in_progress write: uncommitted, dirty.
    setTasks([baseTask({ status: 'in_progress', attempts: 1 })]);
    expect(existsSync(join(repo, '.pitway', 'milestones', 'M001', 'tasks.yaml'))).toBe(true);

    const record = runTaskVerify(repo, 'T001');
    expect(record.exitCode).toBe(0);
  });

  it('allows a real pending journal-backed workflow path (classifyDirtyPaths expected set)', () => {
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'thing.ts'), 'export const x = 1;\n');
    setTasks([baseTask()]);
    commitAll('baseline');

    const contractPath = join(repo, '.pitway', 'milestones', 'M001', 'contract.md');
    writeFileSync(contractPath, '---\nid: M001\n---\namended body\n');
    appendJournalEntry(repo, {
      milestone: 'M001',
      type: 'contract_amendment',
      operationId: 'op-1',
      payload: {},
    });

    const record = runTaskVerify(repo, 'T001');
    expect(record.exitCode).toBe(0);
  });

  it('refuses an arbitrary edit to an unrelated .pitway/ path not backed by any pending journal entry', () => {
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'thing.ts'), 'export const x = 1;\n');
    setTasks([baseTask()]);
    commitAll('baseline');

    const usagePath = join(repo, '.pitway', 'milestones', 'M001', 'usage.yaml');
    writeFileSync(usagePath, 'schema_version: 1\nplanning: null\nqa: null\n');

    expect(() => runTaskVerify(repo, 'T001')).toThrow(TaskVerifyError);
    expect(() => runTaskVerify(repo, 'T001')).toThrow(/usage\.yaml/);
  });

  it('refuses an unrelated source file or untracked file outside write_scope (AC001)', () => {
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'thing.ts'), 'export const x = 1;\n');
    setTasks([baseTask()]);
    commitAll('baseline');

    writeFileSync(join(repo, 'stray.txt'), 'oops\n');

    expect(() => runTaskVerify(repo, 'T001')).toThrow(TaskVerifyError);
    expect(() => runTaskVerify(repo, 'T001')).toThrow(/stray\.txt/);
  });
});
