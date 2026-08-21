import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendBacklogArchiveRecord,
  appendCheckpointMarker,
  appendJournalEntry,
  appendMilestoneMergeRecord,
  appendQuickChangeRecord,
  appendTaskVerifyEvidenceRecord,
  appendWorktreeDispatchRecord,
  appendWorktreeDiscardRecord,
  appendWorktreeIntegrateRecord,
  JournalError,
  readJournal,
  reconcilePending,
} from '../../src/state/journal.js';
import { resolvePitwayJournalPath } from '../../src/git/paths.js';
import { derivePending, resolveTargetPath } from '../../src/core/journal/operations.js';
import { composeMessage } from '../../src/git/trailers.js';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'pitway-journal-'));
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

describe('resolvePitwayJournalPath', () => {
  it('resolves via git rev-parse --git-path, not a hard-coded .git/... string, and lives under the git dir', () => {
    const path = resolvePitwayJournalPath(repo);
    const gitDir = join(repo, '.git');
    expect(path.startsWith(gitDir)).toBe(true);
    expect(path.endsWith(join('pitway', 'journal.yaml'))).toBe(true);
  });

  it('resolves correctly under a linked worktree (.git is a file, not a directory)', () => {
    const worktreeDir = mkdtempSync(join(tmpdir(), 'pitway-journal-wt-'));
    rmSync(worktreeDir, { recursive: true, force: true });
    git(['worktree', 'add', '-b', 'wt-branch', worktreeDir], repo);
    try {
      // .git in a linked worktree is a file containing a `gitdir:` pointer,
      // not a directory.
      const dotGit = readFileSync(join(worktreeDir, '.git'), 'utf8');
      expect(dotGit).toContain('gitdir:');

      const path = resolvePitwayJournalPath(worktreeDir);
      expect(path.endsWith(join('pitway', 'journal.yaml'))).toBe(true);
      // Resolves somewhere under the main repo's .git (worktree-private
      // area), not under the linked worktree's working directory.
      expect(path.startsWith(worktreeDir)).toBe(false);
      expect(path.includes(join('.git', 'worktrees'))).toBe(true);
    } finally {
      git(['worktree', 'remove', '--force', worktreeDir], repo);
    }
  });
});

describe('journal append + read', () => {
  it('appends entries carrying milestone, type, operationId, target and payload, and reads them back', () => {
    const entry = appendJournalEntry(repo, {
      milestone: 'M005',
      type: 'usage_recording',
      operationId: 'op-1',
      target: 'T001',
      payload: { total_tokens: 42 },
    });
    expect(entry.kind).toBe('entry');

    const all = readJournal(repo);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      kind: 'entry',
      milestone: 'M005',
      type: 'usage_recording',
      operationId: 'op-1',
      target: 'T001',
      payload: { total_tokens: 42 },
    });
  });

  it('rejects entries carrying a type outside the allowed enum (task_transition / verification_result are not journal entries)', () => {
    expect(() =>
      appendJournalEntry(repo, {
        milestone: 'M005',
        // @ts-expect-error deliberately invalid — task_transition must never be journal-writable
        type: 'task_transition',
        operationId: 'op-x',
        payload: {},
      }),
    ).toThrow(JournalError);

    expect(() =>
      appendJournalEntry(repo, {
        milestone: 'M005',
        // @ts-expect-error deliberately invalid — verification_result must never be journal-writable
        type: 'verification_result',
        operationId: 'op-y',
        payload: {},
      }),
    ).toThrow(JournalError);

    expect(readJournal(repo)).toHaveLength(0);
  });

  it('starts empty when no journal file exists yet', () => {
    expect(readJournal(repo)).toEqual([]);
  });
});

describe('append-only / checkpoint markers', () => {
  it('never clears or deletes an original entry when checkpointed', () => {
    appendJournalEntry(repo, {
      milestone: 'M005',
      type: 'usage_recording',
      operationId: 'op-1',
      payload: { total_tokens: 1 },
    });
    appendCheckpointMarker(repo, 'M005', 'op-1', 'deadbeef');

    const all = readJournal(repo);
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ kind: 'entry', operationId: 'op-1' });
    expect(all[1]).toMatchObject({ kind: 'checkpoint', entryOperationId: 'op-1', commitSha: 'deadbeef' });
  });

  it('supports more than one marker referencing the same commit SHA', () => {
    appendJournalEntry(repo, {
      milestone: 'M005',
      type: 'usage_recording',
      operationId: 'op-1',
      payload: { total_tokens: 1 },
    });
    appendJournalEntry(repo, {
      milestone: 'M005',
      type: 'contract_amendment',
      operationId: 'op-2',
      payload: { field: 'title' },
    });

    const sha = 'cafef00d';
    appendCheckpointMarker(repo, 'M005', 'op-1', sha);
    appendCheckpointMarker(repo, 'M005', 'op-2', sha);

    const all = readJournal(repo);
    const markers = all.filter((r) => r.kind === 'checkpoint');
    expect(markers).toHaveLength(2);
    expect(markers.every((m) => m.kind === 'checkpoint' && m.commitSha === sha)).toBe(true);

    expect(derivePending(all)).toHaveLength(0);
  });
});

describe('derivePending', () => {
  it('derives entries with no matching checkpoint marker', () => {
    appendJournalEntry(repo, {
      milestone: 'M005',
      type: 'usage_recording',
      operationId: 'op-1',
      payload: {},
    });
    appendJournalEntry(repo, {
      milestone: 'M005',
      type: 'task_amendment',
      operationId: 'op-2',
      target: 'T002',
      payload: {},
    });
    appendCheckpointMarker(repo, 'M005', 'op-1', 'sha1');

    const pending = derivePending(readJournal(repo));
    expect(pending).toHaveLength(1);
    expect(pending[0]?.operationId).toBe('op-2');
  });

  it('is computed, not stored deletion — the original entry is still present in the raw journal', () => {
    appendJournalEntry(repo, {
      milestone: 'M005',
      type: 'usage_recording',
      operationId: 'op-1',
      payload: {},
    });
    appendCheckpointMarker(repo, 'M005', 'op-1', 'sha1');

    const all = readJournal(repo);
    expect(all.some((r) => r.kind === 'entry' && r.operationId === 'op-1')).toBe(true);
    expect(derivePending(all)).toHaveLength(0);
  });
});

describe('journal invisibility', () => {
  it('never appears in git status, and lives under the git dir rather than the working tree', () => {
    appendJournalEntry(repo, {
      milestone: 'M005',
      type: 'usage_recording',
      operationId: 'op-1',
      payload: {},
    });

    const status = git(['status', '--porcelain'], repo).trim();
    expect(status).toBe('');

    const path = resolvePitwayJournalPath(repo);
    expect(path.startsWith(join(repo, '.git'))).toBe(true);
    expect(path.startsWith(join(repo, '.pitway'))).toBe(false);
  });

  it('does not survive .git deletion or a fresh clone — durability is scoped to the local repo/worktree only', () => {
    appendJournalEntry(repo, {
      milestone: 'M005',
      type: 'usage_recording',
      operationId: 'op-1',
      payload: {},
    });

    // Documented limitation, not a bug: the journal is resolved through git
    // itself (git rev-parse --git-path), so once .git is gone there is no
    // git work tree to resolve a path against — the natural failure mode
    // (mirroring assertGitWorkTree elsewhere) is sufficient evidence that
    // journal durability never extends past the local .git directory (it is
    // never committed, so a fresh clone starts with none of it either).
    rmSync(join(repo, '.git'), { recursive: true, force: true });
    expect(() => readJournal(repo)).toThrow();
  });
});

describe('self-healing crash recovery (reconcilePending)', () => {
  function commitWithTrailers(cwd: string, files: string[], milestone: string, task?: string): string {
    git(['add', '--', ...files], cwd);
    const trailers: Record<string, string> = { 'PitWay-Milestone': milestone };
    if (task) trailers['PitWay-Task'] = task;
    const message = composeMessage(`workflow: complete ${task ?? milestone}`, trailers);
    git(['commit', '-m', message], cwd);
    return git(['rev-parse', 'HEAD'], cwd).trim();
  }

  it('appends the missing marker when a checkpoint commit happened but the marker was never written, idempotently', () => {
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

    // Simulate: the commit that captures this pending change succeeded, but
    // the process crashed before appendCheckpointMarker ran.
    const relTarget = resolveTargetPath({ type: 'usage_recording' }, 'M005');
    expect(relTarget).toBe('.pitway/milestones/M005/usage.yaml');
    const sha = commitWithTrailers(repo, [relTarget], 'M005', 'T001');

    expect(derivePending(readJournal(repo))).toHaveLength(1);

    const created = reconcilePending(repo, 'M005');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ entryOperationId: 'op-usage-1', commitSha: sha });
    expect(derivePending(readJournal(repo))).toHaveLength(0);

    // Idempotent: calling again does not duplicate the marker or re-apply anything.
    const createdAgain = reconcilePending(repo, 'M005');
    expect(createdAgain).toHaveLength(0);
    const markers = readJournal(repo).filter((r) => r.kind === 'checkpoint');
    expect(markers).toHaveLength(1);
  });

  it('leaves the entry pending when the target file has not actually been committed to match', () => {
    const milestoneDir = join(repo, '.pitway', 'milestones', 'M005');
    mkdirSync(milestoneDir, { recursive: true });
    const usagePath = join(milestoneDir, 'usage.yaml');
    writeFileSync(usagePath, 'schema_version: 1\nplanning: null\nqa: null\n');

    appendJournalEntry(repo, {
      milestone: 'M005',
      type: 'usage_recording',
      operationId: 'op-usage-2',
      payload: { total_tokens: 5 },
    });

    // No commit happened at all yet — genuinely still pending.
    const created = reconcilePending(repo, 'M005');
    expect(created).toHaveLength(0);
    expect(derivePending(readJournal(repo))).toHaveLength(1);
  });

  it('handles more than one pending operation captured by a single checkpoint commit SHA', () => {
    const milestoneDir = join(repo, '.pitway', 'milestones', 'M005');
    mkdirSync(milestoneDir, { recursive: true });
    const usagePath = join(milestoneDir, 'usage.yaml');
    const contractPath = join(milestoneDir, 'contract.md');
    writeFileSync(usagePath, 'schema_version: 1\nplanning: null\nqa: null\n');
    writeFileSync(contractPath, '---\nid: M005\n---\nbody\n');

    appendJournalEntry(repo, {
      milestone: 'M005',
      type: 'usage_recording',
      operationId: 'op-a',
      payload: {},
    });
    appendJournalEntry(repo, {
      milestone: 'M005',
      type: 'contract_amendment',
      operationId: 'op-b',
      payload: {},
    });

    const relUsage = resolveTargetPath({ type: 'usage_recording' }, 'M005');
    const relContract = resolveTargetPath({ type: 'contract_amendment' }, 'M005');
    const sha = commitWithTrailers(repo, [relUsage, relContract], 'M005');

    const created = reconcilePending(repo, 'M005');
    expect(created).toHaveLength(2);

    const markers = readJournal(repo).filter((r) => r.kind === 'checkpoint');
    expect(markers).toHaveLength(2);
    expect(markers.every((m) => m.kind === 'checkpoint' && m.commitSha === sha)).toBe(true);
    const referenced = new Set(markers.map((m) => (m.kind === 'checkpoint' ? m.entryOperationId : '')));
    expect(referenced).toEqual(new Set(['op-a', 'op-b']));

    expect(derivePending(readJournal(repo))).toHaveLength(0);
  });
});

describe('quick_change records (M007/T003)', () => {
  it('appends a quick_change record and reads it back', () => {
    const record = appendQuickChangeRecord(repo, {
      id: 'qc-1',
      status: 'draft',
      objective: 'Fix the thing',
      scope: ['README.md'],
      verifyCommand: 'echo ok',
      runs: [],
    });
    expect(record.kind).toBe('quick_change');

    const all = readJournal(repo);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      kind: 'quick_change',
      id: 'qc-1',
      status: 'draft',
      objective: 'Fix the thing',
      scope: ['README.md'],
      verifyCommand: 'echo ok',
      runs: [],
    });
  });

  it('is excluded from derivePending the same way auto_run is, needing zero change to derivePending/resolveTargetPath', () => {
    appendQuickChangeRecord(repo, {
      id: 'qc-1',
      status: 'draft',
      objective: 'Fix the thing',
      scope: ['README.md'],
      verifyCommand: 'echo ok',
      runs: [],
    });
    appendJournalEntry(repo, {
      milestone: 'M005',
      type: 'usage_recording',
      operationId: 'op-1',
      payload: {},
    });

    const pending = derivePending(readJournal(repo));
    expect(pending).toHaveLength(1);
    expect(pending[0]?.operationId).toBe('op-1');
  });

  it('never appears in git status -- quick_change records share the same journal-invisibility as every other record kind', () => {
    appendQuickChangeRecord(repo, {
      id: 'qc-1',
      status: 'draft',
      objective: 'Fix the thing',
      scope: ['README.md'],
      verifyCommand: 'echo ok',
      runs: [],
    });
    const status = git(['status', '--porcelain'], repo).trim();
    expect(status).toBe('');
  });

  it('rejects a quick_change record missing required fields', () => {
    expect(() =>
      appendQuickChangeRecord(repo, {
        id: 'qc-1',
        // @ts-expect-error deliberately invalid status
        status: 'bogus',
        objective: 'Fix the thing',
        scope: ['README.md'],
        verifyCommand: 'echo ok',
        runs: [],
      }),
    ).toThrow(JournalError);
    expect(readJournal(repo)).toHaveLength(0);
  });

  it('supports appending more than one snapshot for the same id, preserving every prior snapshot append-only', () => {
    appendQuickChangeRecord(repo, {
      id: 'qc-1',
      status: 'draft',
      objective: 'Fix the thing',
      scope: ['README.md'],
      verifyCommand: 'echo ok',
      runs: [],
    });
    appendQuickChangeRecord(repo, {
      id: 'qc-1',
      status: 'approved',
      objective: 'Fix the thing',
      scope: ['README.md'],
      verifyCommand: 'echo ok',
      approvedHash: 'sha256:' + 'a'.repeat(64),
      runs: [],
    });

    const all = readJournal(repo).filter((r) => r.kind === 'quick_change');
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ status: 'draft' });
    expect(all[1]).toMatchObject({ status: 'approved', approvedHash: 'sha256:' + 'a'.repeat(64) });
  });
});

describe('task_verify_evidence records', () => {
  const baseRecord = {
    id: 'tve-1',
    milestone: 'M005',
    taskId: 'T001',
    attempts: 1,
    command: 'npm test',
    exitCode: 0,
    evidence: 'ok',
    durationMs: 42,
    terminationReason: 'exited' as const,
    fingerprint: { entries: [{ path: 'src/a.ts', state: 'present' as const, hash: 'sha256:' + 'a'.repeat(64) }] },
    at: '2026-08-19T00:00:00Z',
  };

  it('appends a task_verify_evidence record and reads it back', () => {
    const record = appendTaskVerifyEvidenceRecord(repo, baseRecord);
    expect(record.kind).toBe('task_verify_evidence');

    const all = readJournal(repo);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      kind: 'task_verify_evidence',
      id: 'tve-1',
      milestone: 'M005',
      taskId: 'T001',
      command: 'npm test',
      exitCode: 0,
    });
  });

  it('is excluded from derivePending the same way quick_change/auto_run already are', () => {
    appendTaskVerifyEvidenceRecord(repo, baseRecord);
    appendJournalEntry(repo, {
      milestone: 'M005',
      type: 'usage_recording',
      operationId: 'op-1',
      payload: {},
    });

    const pending = derivePending(readJournal(repo));
    expect(pending).toHaveLength(1);
    expect(pending[0]?.operationId).toBe('op-1');
  });

  it('never appears in git status -- shares the same journal-invisibility as every other record kind', () => {
    appendTaskVerifyEvidenceRecord(repo, baseRecord);
    const status = git(['status', '--porcelain'], repo).trim();
    expect(status).toBe('');
  });

  it('rejects a task_verify_evidence record missing required fields', () => {
    expect(() =>
      appendTaskVerifyEvidenceRecord(repo, {
        ...baseRecord,
        // @ts-expect-error deliberately invalid terminationReason
        terminationReason: 'bogus',
      }),
    ).toThrow(JournalError);
    expect(readJournal(repo)).toHaveLength(0);
  });

  it('supports optional passCount/failCount/typecheck fields', () => {
    const record = appendTaskVerifyEvidenceRecord(repo, {
      ...baseRecord,
      passCount: 5,
      failCount: 1,
      typecheck: { command: 'tsc --noEmit', exitCode: 0, evidence: 'clean' },
    });
    expect(record).toMatchObject({
      passCount: 5,
      failCount: 1,
      typecheck: { command: 'tsc --noEmit', exitCode: 0, evidence: 'clean' },
    });
  });
});

// AC001/AC008 (M015/T001): review_recording -- fourth entry-kind operation
// type, sharing the exact usage_recording/amendment mechanics (checkpoint-
// eligible via derivePending/resolveTargetPath), unlike the sibling record
// kinds (auto_run, quick_change, task_verify_evidence, worktree_*) which are
// structurally excluded from checkpointing.
describe('review_recording journal entries (M015/T001)', () => {
  it('appends a review_recording entry and reads it back', () => {
    const entry = appendJournalEntry(repo, {
      milestone: 'M015',
      type: 'review_recording',
      operationId: 'rr-1',
      target: 'rev-abc123',
      payload: { role: 'developer' },
    });
    expect(entry.kind).toBe('entry');

    const all = readJournal(repo);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      kind: 'entry',
      milestone: 'M015',
      type: 'review_recording',
      operationId: 'rr-1',
      target: 'rev-abc123',
    });
  });

  it('resolveTargetPath maps review_recording to the milestone reviews.yaml', () => {
    expect(resolveTargetPath({ type: 'review_recording' }, 'M015')).toBe(
      '.pitway/milestones/M015/reviews.yaml',
    );
  });

  it('is checkpoint-eligible exactly like usage_recording/amendments -- derivePending excludes it once checkpointed', () => {
    appendJournalEntry(repo, {
      milestone: 'M015',
      type: 'review_recording',
      operationId: 'rr-2',
      payload: {},
    });
    expect(derivePending(readJournal(repo)).map((e) => e.operationId)).toEqual(['rr-2']);

    appendCheckpointMarker(repo, 'M015', 'rr-2', 'deadbeef');
    expect(derivePending(readJournal(repo))).toHaveLength(0);
  });

  it('reconcilePending self-heals a review_recording entry the same way it does usage_recording/amendments', () => {
    const milestoneDir = join(repo, '.pitway', 'milestones', 'M015');
    mkdirSync(milestoneDir, { recursive: true });
    const reviewsPath = join(milestoneDir, 'reviews.yaml');
    writeFileSync(reviewsPath, 'schema_version: 1\nsessions: []\n');

    appendJournalEntry(repo, {
      milestone: 'M015',
      type: 'review_recording',
      operationId: 'rr-3',
      payload: {},
    });

    const relTarget = resolveTargetPath({ type: 'review_recording' }, 'M015');
    expect(relTarget).toBe('.pitway/milestones/M015/reviews.yaml');
    git(['add', '--', relTarget], repo);
    const message = composeMessage('workflow: complete T001', {
      'PitWay-Milestone': 'M015',
      'PitWay-Task': 'T001',
    });
    git(['commit', '-m', message], repo);
    const sha = git(['rev-parse', 'HEAD'], repo).trim();

    const created = reconcilePending(repo, 'M015');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ entryOperationId: 'rr-3', commitSha: sha });
    expect(derivePending(readJournal(repo))).toHaveLength(0);
  });
});

// M018/T001 (AC003): backlog_recording -- fifth checkpoint-eligible
// operation type, reused across add/promote/archive exactly the way
// task_amendment is reused by both task-add and task-amend. Unlike every
// other operation type, its resolveTargetPath case is root-level
// ('.pitway/backlog.yaml'), not nested under a milestone directory --
// derivePending/reconcilePending require no change to handle this
// generically, proven directly below.
describe('backlog_recording journal entries (M018/T001)', () => {
  it('appends a backlog_recording entry and reads it back', () => {
    const entry = appendJournalEntry(repo, {
      milestone: 'M018',
      type: 'backlog_recording',
      operationId: 'br-1',
      target: 'B001',
      payload: { operation: 'add' },
    });
    expect(entry.kind).toBe('entry');

    const all = readJournal(repo);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      kind: 'entry',
      milestone: 'M018',
      type: 'backlog_recording',
      operationId: 'br-1',
      target: 'B001',
    });
  });

  it('resolveTargetPath maps backlog_recording to the root-level backlog.yaml, ignoring milestoneDir', () => {
    expect(resolveTargetPath({ type: 'backlog_recording' }, 'M018')).toBe('.pitway/backlog.yaml');
    expect(resolveTargetPath({ type: 'backlog_recording' }, 'M999')).toBe('.pitway/backlog.yaml');
  });

  it('is checkpoint-eligible exactly like task_amendment -- derivePending excludes it once checkpointed', () => {
    appendJournalEntry(repo, {
      milestone: 'M018',
      type: 'backlog_recording',
      operationId: 'br-2',
      payload: {},
    });
    expect(derivePending(readJournal(repo)).map((e) => e.operationId)).toEqual(['br-2']);

    appendCheckpointMarker(repo, 'M018', 'br-2', 'deadbeef');
    expect(derivePending(readJournal(repo))).toHaveLength(0);
  });

  it('reconcilePending self-heals a backlog_recording entry with no code change needed for its root-level target', () => {
    mkdirSync(join(repo, '.pitway', 'milestones', 'M018'), { recursive: true });
    writeFileSync(join(repo, '.pitway', 'backlog.yaml'), 'schema_version: 1\nitems: []\n');

    appendJournalEntry(repo, {
      milestone: 'M018',
      type: 'backlog_recording',
      operationId: 'br-3',
      payload: {},
    });

    const relTarget = resolveTargetPath({ type: 'backlog_recording' }, 'M018');
    expect(relTarget).toBe('.pitway/backlog.yaml');
    git(['add', '--', relTarget], repo);
    const message = composeMessage('workflow: complete T001', {
      'PitWay-Milestone': 'M018',
      'PitWay-Task': 'T001',
    });
    git(['commit', '-m', message], repo);
    const sha = git(['rev-parse', 'HEAD'], repo).trim();

    const created = reconcilePending(repo, 'M018');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ entryOperationId: 'br-3', commitSha: sha });
    expect(derivePending(readJournal(repo))).toHaveLength(0);
  });
});

describe('layering: src/core/journal/ must not import node:fs or node:path', () => {
  it('contains zero direct fs/path imports across every file in src/core/journal/', () => {
    const dir = join(process.cwd(), 'src', 'core', 'journal');
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(join(dir, file), 'utf8');
      expect(text).not.toMatch(/from\s+['"]node:fs['"]/);
      expect(text).not.toMatch(/from\s+['"]node:path['"]/);
    }
  });
});

// AC004/T004 (M014): worktree_dispatch -- sixth sibling record kind, same
// discipline as its siblings: append-only, derivePending-excluded,
// git-invisible.
describe('worktree_dispatch records (M014/T004)', () => {
  const baseDispatch = {
    id: 'wtd-1',
    milestone: 'M014',
    taskId: 'T001',
    branch: 'pitway/task/M014-T001',
    worktreePath: '/tmp/repo/.pitway-worktrees/M014-T001',
    createdFrom: 'a'.repeat(40),
    at: '2026-08-20T00:00:00Z',
  };

  it('appends a worktree_dispatch record and reads it back', () => {
    const record = appendWorktreeDispatchRecord(repo, baseDispatch);
    expect(record.kind).toBe('worktree_dispatch');
    const all = readJournal(repo);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      kind: 'worktree_dispatch',
      id: 'wtd-1',
      milestone: 'M014',
      taskId: 'T001',
      branch: 'pitway/task/M014-T001',
    });
  });

  it('is excluded from derivePending like every sibling record kind', () => {
    appendWorktreeDispatchRecord(repo, baseDispatch);
    appendJournalEntry(repo, {
      milestone: 'M014',
      type: 'usage_recording',
      operationId: 'op-1',
      payload: {},
    });
    const pending = derivePending(readJournal(repo));
    expect(pending).toHaveLength(1);
    expect(pending[0]?.operationId).toBe('op-1');
  });

  it('never appears in git status', () => {
    appendWorktreeDispatchRecord(repo, baseDispatch);
    expect(git(['status', '--porcelain'], repo).trim()).toBe('');
  });

  it('rejects a record missing required fields, appending nothing', () => {
    expect(() =>
      appendWorktreeDispatchRecord(repo, {
        ...baseDispatch,
        // Runtime-invalid milestone id (zod regex), type-valid string.
        milestone: 'X1',
      }),
    ).toThrow(JournalError);
    expect(readJournal(repo)).toHaveLength(0);
  });
});

// AC006/T006 (M014): worktree_integrate -- closes a dispatch by dispatchId;
// same sibling-record discipline.
describe('worktree_integrate records (M014/T006)', () => {
  const baseIntegrate = {
    id: 'wti-1',
    dispatchId: 'wtd-1',
    milestone: 'M014',
    taskId: 'T001',
    workerSha: 'b'.repeat(40),
    at: '2026-08-20T00:00:00Z',
  };

  it('appends a worktree_integrate record and reads it back', () => {
    const record = appendWorktreeIntegrateRecord(repo, baseIntegrate);
    expect(record.kind).toBe('worktree_integrate');
    expect(readJournal(repo)[0]).toMatchObject({
      kind: 'worktree_integrate',
      dispatchId: 'wtd-1',
      taskId: 'T001',
    });
  });

  it('is excluded from derivePending and invisible to git status', () => {
    appendWorktreeIntegrateRecord(repo, baseIntegrate);
    expect(derivePending(readJournal(repo))).toHaveLength(0);
    expect(git(['status', '--porcelain'], repo).trim()).toBe('');
  });

  it('rejects a record missing required fields, appending nothing', () => {
    expect(() =>
      appendWorktreeIntegrateRecord(repo, {
        ...baseIntegrate,
        // @ts-expect-error deliberately missing workerSha
        workerSha: undefined,
      }),
    ).toThrow(JournalError);
    expect(readJournal(repo)).toHaveLength(0);
  });
});

// AC008/T008 (M014): worktree_discard -- closes a dispatch after abandonment;
// same sibling-record discipline.
describe('worktree_discard records (M014/T008)', () => {
  const baseDiscard = {
    id: 'wtx-1',
    dispatchId: 'wtd-1',
    milestone: 'M014',
    taskId: 'T001',
    reason: 'worker produced out-of-scope changes',
    discardedSha: 'c'.repeat(40) as string | null,
    at: '2026-08-20T00:00:00Z',
  };

  it('appends a worktree_discard record and reads it back', () => {
    const record = appendWorktreeDiscardRecord(repo, baseDiscard);
    expect(record.kind).toBe('worktree_discard');
    expect(readJournal(repo)[0]).toMatchObject({
      kind: 'worktree_discard',
      dispatchId: 'wtd-1',
      reason: 'worker produced out-of-scope changes',
    });
  });

  it('accepts a null discardedSha (branch already gone)', () => {
    const record = appendWorktreeDiscardRecord(repo, { ...baseDiscard, discardedSha: null });
    expect(record.discardedSha).toBeNull();
  });

  it('is excluded from derivePending and invisible to git status', () => {
    appendWorktreeDiscardRecord(repo, baseDiscard);
    expect(derivePending(readJournal(repo))).toHaveLength(0);
    expect(git(['status', '--porcelain'], repo).trim()).toBe('');
  });

  it('rejects a record missing the reason, appending nothing', () => {
    expect(() =>
      appendWorktreeDiscardRecord(repo, {
        ...baseDiscard,
        reason: '',
      }),
    ).toThrow(JournalError);
    expect(readJournal(repo)).toHaveLength(0);
  });
});

// M019/T001: milestone_merge -- ninth sibling record kind, same discipline
// as every sibling above: append-only, derivePending-excluded,
// git-invisible, no resolveTargetPath case needed.
describe('milestone_merge records (M019/T001)', () => {
  const baseMerge = {
    id: 'mm-1',
    milestone: 'M014',
    targetBranch: 'main',
    mergeCommitSha: 'a'.repeat(40),
    alreadyMerged: false,
    at: '2026-08-21T00:00:00Z',
  };

  it('appends a milestone_merge record and reads it back', () => {
    const record = appendMilestoneMergeRecord(repo, baseMerge);
    expect(record.kind).toBe('milestone_merge');
    const all = readJournal(repo);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      kind: 'milestone_merge',
      id: 'mm-1',
      milestone: 'M014',
      targetBranch: 'main',
      alreadyMerged: false,
    });
  });

  it('accepts an already-merged record (alreadyMerged: true)', () => {
    const record = appendMilestoneMergeRecord(repo, { ...baseMerge, alreadyMerged: true });
    expect(record.alreadyMerged).toBe(true);
  });

  it('is excluded from derivePending like every sibling record kind', () => {
    appendMilestoneMergeRecord(repo, baseMerge);
    appendJournalEntry(repo, {
      milestone: 'M014',
      type: 'usage_recording',
      operationId: 'op-1',
      payload: {},
    });
    const pending = derivePending(readJournal(repo));
    expect(pending).toHaveLength(1);
    expect(pending[0]?.operationId).toBe('op-1');
  });

  it('never appears in git status', () => {
    appendMilestoneMergeRecord(repo, baseMerge);
    expect(git(['status', '--porcelain'], repo).trim()).toBe('');
  });

  it('rejects a record missing required fields, appending nothing', () => {
    expect(() =>
      appendMilestoneMergeRecord(repo, {
        ...baseMerge,
        // Runtime-invalid milestone id (zod regex), type-valid string.
        milestone: 'X1',
      }),
    ).toThrow(JournalError);
    expect(readJournal(repo)).toHaveLength(0);
  });
});

// M021/T002 (AC006/B007): backlog_archive -- tenth sibling record kind,
// mirroring quick_change's own no-milestone-field precedent. Same
// discipline as every sibling above: append-only, derivePending-excluded,
// git-invisible, no resolveTargetPath case needed.
describe('backlog_archive records (M021/T002, B007)', () => {
  const baseArchive = {
    id: 'ba-1',
    target: 'B001',
    reason: 'No longer relevant.',
    at: '2026-08-22T00:00:00Z',
  };

  it('appends a backlog_archive record and reads it back', () => {
    const record = appendBacklogArchiveRecord(repo, baseArchive);
    expect(record.kind).toBe('backlog_archive');
    const all = readJournal(repo);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      kind: 'backlog_archive',
      id: 'ba-1',
      target: 'B001',
      reason: 'No longer relevant.',
    });
  });

  it('carries no milestone field, like quick_change', () => {
    const record = appendBacklogArchiveRecord(repo, baseArchive);
    expect(record).not.toHaveProperty('milestone');
  });

  it('is excluded from derivePending like every sibling record kind', () => {
    appendBacklogArchiveRecord(repo, baseArchive);
    appendJournalEntry(repo, {
      milestone: 'M014',
      type: 'usage_recording',
      operationId: 'op-1',
      payload: {},
    });
    const pending = derivePending(readJournal(repo));
    expect(pending).toHaveLength(1);
    expect(pending[0]?.operationId).toBe('op-1');
  });

  it('never appears in git status', () => {
    appendBacklogArchiveRecord(repo, baseArchive);
    expect(git(['status', '--porcelain'], repo).trim()).toBe('');
  });

  it('rejects a record missing required fields, appending nothing', () => {
    expect(() =>
      appendBacklogArchiveRecord(repo, {
        ...baseArchive,
        // Runtime-invalid: empty target.
        target: '',
      }),
    ).toThrow(JournalError);
    expect(readJournal(repo)).toHaveLength(0);
  });
});
