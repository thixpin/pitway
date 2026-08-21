import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitError, checkWorkingTreeClean, classifyDirtyPaths } from '../../src/git/safety.js';
import { appendCheckpointMarker, appendJournalEntry } from '../../src/state/journal.js';
import { resolveTargetPath } from '../../src/core/journal/operations.js';

let repo: string;

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'pitway-git-'));
  git(['init', '-q'], repo);
  git(['config', 'user.email', 'test@example.com'], repo);
  git(['config', 'user.name', 'Test'], repo);
  writeFileSync(join(repo, 'README.md'), 'hello\n');
  git(['add', 'README.md'], repo);
  git(['commit', '-q', '-m', 'init'], repo);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('checkWorkingTreeClean', () => {
  it('reports clean on a clean tree', () => {
    const result = checkWorkingTreeClean(repo);
    expect(result.clean).toBe(true);
    expect(result.dirtyPaths).toEqual([]);
  });

  it('reports dirty paths without modifying anything', () => {
    writeFileSync(join(repo, 'scratch.txt'), 'wip\n');
    const result = checkWorkingTreeClean(repo);
    expect(result.clean).toBe(false);
    expect(result.dirtyPaths).toContain('scratch.txt');
    // untouched: still untracked, not staged, not committed
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: repo }).toString();
    expect(status).toContain('?? scratch.txt');
  });

  it('reports modified tracked files as dirty', () => {
    writeFileSync(join(repo, 'README.md'), 'changed\n');
    const result = checkWorkingTreeClean(repo);
    expect(result.clean).toBe(false);
    expect(result.dirtyPaths).toContain('README.md');
  });

  it('throws a clear, distinguishable error outside a git work tree', () => {
    const nonRepo = mkdtempSync(join(tmpdir(), 'pitway-nongit-'));
    try {
      expect(() => checkWorkingTreeClean(nonRepo)).toThrowError(GitError);
      expect(() => checkWorkingTreeClean(nonRepo)).toThrowError(/not a git (work tree|repository)/i);
    } finally {
      rmSync(nonRepo, { recursive: true, force: true });
    }
  });
});

describe('classifyDirtyPaths', () => {
  // AC1: declaring a path in write_scope grants no expectation by itself —
  // only after the task's own verified-clean-start check has passed.
  it('never classifies a write_scope path as expected when verifiedCleanStart is not true', () => {
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'thing.ts'), 'x\n');

    const resultOmitted = classifyDirtyPaths(repo, {
      taskWriteScope: ['src/thing.ts'],
    });
    expect(resultOmitted.expected).toEqual([]);
    expect(resultOmitted.unexpected).toContain('src/thing.ts');

    const resultFalse = classifyDirtyPaths(repo, {
      taskWriteScope: ['src/thing.ts'],
      verifiedCleanStart: false,
    });
    expect(resultFalse.expected).toEqual([]);
    expect(resultFalse.unexpected).toContain('src/thing.ts');
  });

  it('classifies a write_scope path as expected once verifiedCleanStart is true', () => {
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'thing.ts'), 'x\n');

    const result = classifyDirtyPaths(repo, {
      taskWriteScope: ['src/thing.ts'],
      verifiedCleanStart: true,
    });
    expect(result.expected).toEqual(['src/thing.ts']);
    expect(result.unexpected).toEqual([]);
  });

  // AC2: ordinary pending task_transition/verification_result writes are
  // always expected, independent of write_scope/verifiedCleanStart.
  it('always classifies a pendingTransitionPaths path as expected, regardless of write_scope/verifiedCleanStart', () => {
    writeFileSync(join(repo, 'tasks.yaml'), 'schema_version: 1\n');

    const result = classifyDirtyPaths(repo, {
      pendingTransitionPaths: ['tasks.yaml'],
      verifiedCleanStart: false,
    });
    expect(result.expected).toEqual(['tasks.yaml']);
    expect(result.unexpected).toEqual([]);
  });

  // AC2: a dirty path matching a pending journal entry (T001) is expected.
  it('classifies a path matching a pending journal entry target as expected', () => {
    const milestoneDir = join(repo, '.pitway', 'milestones', 'M005');
    mkdirSync(milestoneDir, { recursive: true });
    const usagePath = join(milestoneDir, 'usage.yaml');
    writeFileSync(usagePath, 'schema_version: 1\nplanning: null\nqa: null\n');

    appendJournalEntry(repo, {
      milestone: 'M005',
      type: 'usage_recording',
      operationId: 'op-usage-1',
      payload: { total_tokens: 10 },
    });

    const relTarget = resolveTargetPath({ type: 'usage_recording' }, 'M005');
    const result = classifyDirtyPaths(repo, { journalMilestone: 'M005' });
    expect(result.expected).toContain(relTarget);
    expect(result.unexpected).not.toContain(relTarget);
  });

  it('does not classify a journal-target path as expected once it has been checkpointed', () => {
    const milestoneDir = join(repo, '.pitway', 'milestones', 'M005');
    mkdirSync(milestoneDir, { recursive: true });
    const usagePath = join(milestoneDir, 'usage.yaml');
    writeFileSync(usagePath, 'schema_version: 1\nplanning: null\nqa: null\n');

    appendJournalEntry(repo, {
      milestone: 'M005',
      type: 'usage_recording',
      operationId: 'op-usage-2',
      payload: { total_tokens: 10 },
    });
    appendCheckpointMarker(repo, 'M005', 'op-usage-2', 'deadbeef');

    const relTarget = resolveTargetPath({ type: 'usage_recording' }, 'M005');
    const result = classifyDirtyPaths(repo, { journalMilestone: 'M005' });
    expect(result.unexpected).toContain(relTarget);
    expect(result.expected).not.toContain(relTarget);
  });

  it('does not classify a pending journal entry from a different milestone as expected', () => {
    const milestoneDir = join(repo, '.pitway', 'milestones', 'M005');
    mkdirSync(milestoneDir, { recursive: true });
    const usagePath = join(milestoneDir, 'usage.yaml');
    writeFileSync(usagePath, 'schema_version: 1\nplanning: null\nqa: null\n');

    appendJournalEntry(repo, {
      milestone: 'M005',
      type: 'usage_recording',
      operationId: 'op-usage-3',
      payload: { total_tokens: 10 },
    });

    const relTarget = resolveTargetPath({ type: 'usage_recording' }, 'M005');
    const result = classifyDirtyPaths(repo, { journalMilestone: 'M006' });
    expect(result.unexpected).toContain(relTarget);
    expect(result.expected).not.toContain(relTarget);
  });

  // AC3: existing refusal diagnostics keep naming genuinely unexpected
  // paths only — an unrelated stray file is never swept into "expected" by
  // any of the classification inputs.
  it('keeps a genuinely unrelated dirty path unexpected even when other classification inputs are supplied', () => {
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'thing.ts'), 'x\n');
    writeFileSync(join(repo, 'stray.txt'), 'oops\n');

    const result = classifyDirtyPaths(repo, {
      taskWriteScope: ['src/thing.ts'],
      verifiedCleanStart: true,
      pendingTransitionPaths: ['tasks.yaml'],
      journalMilestone: 'M005',
    });
    expect(result.expected).toEqual(['src/thing.ts']);
    expect(result.unexpected).toEqual(['stray.txt']);
  });

  // AC4: documented limitation — PitWay cannot distinguish, by path alone,
  // between the in_progress task's own edit and a concurrent developer edit
  // to a file that happens to also be in that task's write_scope. Both are
  // classified expected. This test constructs exactly that scenario: the
  // file inside write_scope is, in this test's own framing, edited by "the
  // developer" concurrently rather than by the task itself — and it is
  // still classified expected, proving the limitation is real, not silently
  // special-cased away.
  it('classifies a concurrent developer edit to a write_scope path as expected, indistinguishable from the task\'s own edit', () => {
    mkdirSync(join(repo, 'src'), { recursive: true });
    // Framing: this write simulates a developer editing src/thing.ts by hand
    // while the task is in_progress — not an edit made by the task worker.
    writeFileSync(join(repo, 'src', 'thing.ts'), 'developer edit\n');

    const result = classifyDirtyPaths(repo, {
      taskWriteScope: ['src/thing.ts'],
      verifiedCleanStart: true,
    });
    // Indistinguishable from the task's own edit: still expected.
    expect(result.expected).toEqual(['src/thing.ts']);
    expect(result.unexpected).toEqual([]);
  });

  // M018/T002 (AC005): a pending backlog_recording entry's root-level
  // target (.pitway/backlog.yaml, not nested under any milestone
  // directory) is classified expected through the exact same generic
  // journalMilestone allowlist as a milestone-nested target like
  // usage.yaml above -- no code change to classifyDirtyPaths was needed
  // for this.
  it('classifies the root-level .pitway/backlog.yaml as expected via a pending backlog_recording entry', () => {
    mkdirSync(join(repo, '.pitway', 'milestones', 'M018'), { recursive: true });
    writeFileSync(join(repo, '.pitway', 'backlog.yaml'), 'schema_version: 1\nitems: []\n');

    appendJournalEntry(repo, {
      milestone: 'M018',
      type: 'backlog_recording',
      operationId: 'op-backlog-1',
      payload: {},
    });

    const relTarget = resolveTargetPath({ type: 'backlog_recording' }, 'M018');
    expect(relTarget).toBe('.pitway/backlog.yaml');
    const result = classifyDirtyPaths(repo, { journalMilestone: 'M018' });
    expect(result.expected).toContain(relTarget);
    expect(result.unexpected).not.toContain(relTarget);
  });

  it('does not classify .pitway/backlog.yaml as expected for an unrelated journalMilestone', () => {
    mkdirSync(join(repo, '.pitway', 'milestones', 'M018'), { recursive: true });
    writeFileSync(join(repo, '.pitway', 'backlog.yaml'), 'schema_version: 1\nitems: []\n');

    appendJournalEntry(repo, {
      milestone: 'M018',
      type: 'backlog_recording',
      operationId: 'op-backlog-2',
      payload: {},
    });

    const relTarget = resolveTargetPath({ type: 'backlog_recording' }, 'M018');
    const result = classifyDirtyPaths(repo, { journalMilestone: 'M019' });
    expect(result.unexpected).toContain(relTarget);
    expect(result.expected).not.toContain(relTarget);
  });
});
