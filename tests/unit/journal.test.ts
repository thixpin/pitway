import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendCheckpointMarker,
  appendJournalEntry,
  appendQuickChangeRecord,
  appendTaskVerifyEvidenceRecord,
  appendWorktreeDispatchRecord,
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
        // @ts-expect-error deliberately invalid milestone id
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
