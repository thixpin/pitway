import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MISSING_HASH_MARKER,
  buildFingerprint,
  hasVerifiedEvidence,
  isExecutionPassing,
  normalizeRepoRelativePath,
  resolveTaskVerifyEvidence,
  validateTaskVerifyEvidence,
} from '../../src/core/tasks/evidence.js';
import { TaskUpdateError } from '../../src/core/tasks/update.js';
import { appendTaskVerifyEvidenceRecord, type JournalTaskVerifyEvidence } from '../../src/state/journal.js';
import type { Task } from '../../src/state/schemas.js';

// M039/T001 (AC004): task-verify evidence fingerprinting, execution-outcome
// classification, staleness validation, and record selection, exercised
// directly. Every refusal is pinned by its message so the split cannot
// silently reword one.

let root: string;

function git(args: string[]): void {
  execFileSync('git', args, { cwd: root, stdio: 'pipe' });
}

function sha(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'T001',
    status: 'review',
    objective: 'x',
    depends_on: [],
    acceptance_criteria: ['x'],
    context_files: ['src/a.ts', 'src/b.ts'],
    write_scope: ['src/a.ts', 'src/b.ts'],
    verification: { strategy: 'command', detail: 'npm test' },
    result: null,
    usage: null,
    attempts: 1,
    ...overrides,
  };
}

function record(overrides: Partial<Omit<JournalTaskVerifyEvidence, 'kind'>> = {}): Omit<JournalTaskVerifyEvidence, 'kind'> {
  return {
    id: 'tve-1',
    milestone: 'M001',
    taskId: 'T001',
    attempts: 1,
    command: 'npm test',
    exitCode: 0,
    evidence: 'Tests 3 passed',
    durationMs: 10,
    terminationReason: 'exited',
    fingerprint: { entries: buildFingerprint(root, ['src/a.ts', 'src/b.ts']) },
    at: '2026-08-28T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pitway-task-evidence-'));
  git(['init', '-q']);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.ts'), 'a\n');
  writeFileSync(join(root, 'src', 'b.ts'), 'b\n');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('normalizeRepoRelativePath', () => {
  it('normalizes to posix repo-relative form and refuses a path outside the repository', () => {
    expect(normalizeRepoRelativePath(root, 'src/../src/a.ts')).toBe('src/a.ts');
    expect(() => normalizeRepoRelativePath(root, '../outside.ts')).toThrow(TaskUpdateError);
    expect(() => normalizeRepoRelativePath(root, '../outside.ts')).toThrow(
      'declared path resolves outside the repository: ../outside.ts',
    );
  });
});

describe('buildFingerprint', () => {
  it('hashes present files, marks missing ones with MISSING_HASH_MARKER, and sorts by path', () => {
    expect(MISSING_HASH_MARKER).toBe('MISSING');
    expect(buildFingerprint(root, ['src/b.ts', 'src/zzz.ts', 'src/a.ts'])).toEqual([
      { path: 'src/a.ts', state: 'present', hash: sha('a\n') },
      { path: 'src/b.ts', state: 'present', hash: sha('b\n') },
      { path: 'src/zzz.ts', state: 'missing', hash: 'MISSING' },
    ]);
  });
});

describe('isExecutionPassing', () => {
  it('passes only for an exited, zero-exit run whose optional typecheck also passed', () => {
    const base = { ...record(), kind: 'task_verify_evidence' as const };
    expect(isExecutionPassing(base)).toBe(true);
    expect(isExecutionPassing({ ...base, exitCode: 1 })).toBe(false);
    expect(isExecutionPassing({ ...base, terminationReason: 'timeout', exitCode: null })).toBe(false);
    expect(
      isExecutionPassing({ ...base, typecheck: { command: 'tsc', exitCode: 2, evidence: 'err' } }),
    ).toBe(false);
    expect(
      isExecutionPassing({ ...base, typecheck: { command: 'tsc', exitCode: 0, evidence: 'ok' } }),
    ).toBe(true);
  });
});

describe('validateTaskVerifyEvidence', () => {
  const full = (o: Partial<Omit<JournalTaskVerifyEvidence, 'kind'>> = {}): JournalTaskVerifyEvidence => ({
    kind: 'task_verify_evidence',
    ...record(o),
  });

  it('accepts a fresh, matching, passing record', () => {
    expect(() => validateTaskVerifyEvidence(root, task(), full())).not.toThrow();
  });

  it('refuses a task mismatch', () => {
    expect(() => validateTaskVerifyEvidence(root, task(), full({ taskId: 'T002' }))).toThrow(
      'evidence record tve-1 is stale: task mismatch (recorded for T002, current task T001)',
    );
  });

  it('refuses a failing run, naming the typecheck exit code when that is what failed', () => {
    expect(() => validateTaskVerifyEvidence(root, task(), full({ exitCode: 1 }))).toThrow(
      'evidence record tve-1 represents a failing run (terminationReason=exited, exitCode=1)',
    );
    expect(() =>
      validateTaskVerifyEvidence(root, task(), full({ typecheck: { command: 'tsc', exitCode: 2, evidence: 'e' } })),
    ).toThrow('evidence record tve-1 represents a failing run (terminationReason=exited, exitCode=0, typecheck.exitCode=2)');
  });

  it('refuses an attempt mismatch', () => {
    expect(() => validateTaskVerifyEvidence(root, task({ attempts: 2 }), full())).toThrow(
      'evidence record tve-1 is stale: attempt mismatch (recorded 1, current 2)',
    );
  });

  it('refuses a command mismatch', () => {
    expect(() => validateTaskVerifyEvidence(root, task(), full({ command: 'npm run other' }))).toThrow(
      'evidence record tve-1 is stale: command mismatch (recorded "npm run other", current "npm test")',
    );
  });

  it('refuses a write_scope mismatch', () => {
    const t = task({ context_files: ['src/a.ts'], write_scope: ['src/a.ts'] });
    expect(() => validateTaskVerifyEvidence(root, t, full())).toThrow(
      'evidence record tve-1 is stale: write_scope mismatch (declared src/a.ts, evidence covers src/a.ts, src/b.ts)',
    );
  });

  it('refuses a fingerprint mismatch once a declared file changed', () => {
    const rec = full();
    writeFileSync(join(root, 'src', 'a.ts'), 'changed\n');
    expect(() => validateTaskVerifyEvidence(root, task(), rec)).toThrow(TaskUpdateError);
    expect(() => validateTaskVerifyEvidence(root, task(), rec)).toThrow(
      `evidence record tve-1 is stale: fingerprint mismatch for src/a.ts (recorded present/${sha('a\n')}, current present/${sha('changed\n')})`,
    );
  });
});

describe('resolveTaskVerifyEvidence', () => {
  it('returns undefined when no record exists for the milestone+task (implicit)', () => {
    expect(resolveTaskVerifyEvidence(root, 'M001', task(), undefined)).toBeUndefined();
  });

  it('implicitly selects the newest execution-passing record, skipping a later failing one', () => {
    appendTaskVerifyEvidenceRecord(root, record({ id: 'tve-old', evidence: 'old pass' }));
    appendTaskVerifyEvidenceRecord(root, record({ id: 'tve-pass', evidence: 'newest pass' }));
    appendTaskVerifyEvidenceRecord(root, record({ id: 'tve-fail', exitCode: 1, evidence: 'later fail' }));
    expect(resolveTaskVerifyEvidence(root, 'M001', task(), undefined)?.id).toBe('tve-pass');
  });

  it('falls through to the newest record\'s own failing-run refusal when nothing passed', () => {
    appendTaskVerifyEvidenceRecord(root, record({ id: 'tve-f1', exitCode: 1 }));
    appendTaskVerifyEvidenceRecord(root, record({ id: 'tve-f2', exitCode: 2 }));
    expect(() => resolveTaskVerifyEvidence(root, 'M001', task(), undefined)).toThrow(
      'evidence record tve-f2 represents a failing run (terminationReason=exited, exitCode=2)',
    );
  });

  it('resolves an explicit id strictly (no backward search) and refuses an unknown id', () => {
    appendTaskVerifyEvidenceRecord(root, record({ id: 'tve-pass' }));
    appendTaskVerifyEvidenceRecord(root, record({ id: 'tve-fail', exitCode: 1 }));
    expect(resolveTaskVerifyEvidence(root, 'M001', task(), 'tve-pass')?.id).toBe('tve-pass');
    expect(() => resolveTaskVerifyEvidence(root, 'M001', task(), 'tve-fail')).toThrow(
      'evidence record tve-fail represents a failing run',
    );
    expect(() => resolveTaskVerifyEvidence(root, 'M001', task(), 'tve-nope')).toThrow(TaskUpdateError);
    expect(() => resolveTaskVerifyEvidence(root, 'M001', task(), 'tve-nope')).toThrow('unknown evidence id: tve-nope');
  });
});

describe('hasVerifiedEvidence', () => {
  it('is true only when a record for this milestone+task carries the persisted result evidence', () => {
    const done = task({ status: 'completed', result: { summary: 's', evidence: 'Tests 3 passed' } });
    expect(hasVerifiedEvidence(root, 'M001', done)).toBe(false);
    appendTaskVerifyEvidenceRecord(root, record({ id: 'tve-1', evidence: 'Tests 3 passed' }));
    expect(hasVerifiedEvidence(root, 'M001', done)).toBe(true);
    expect(hasVerifiedEvidence(root, 'M002', done)).toBe(false);
    expect(hasVerifiedEvidence(root, 'M001', task({ status: 'completed', result: null }))).toBe(false);
    expect(
      hasVerifiedEvidence(root, 'M001', task({ status: 'completed', result: { summary: 's', evidence: 'other' } })),
    ).toBe(false);
  });
});

// M039/T002 (AC003): verify.ts must not carry its own fingerprint or marker
// definition -- one implementation, in evidence.ts.
describe('verify.ts shares evidence.ts\'s fingerprint implementation', () => {
  it('defines neither buildFingerprint nor MISSING_HASH_MARKER locally', () => {
    const text = readFileSync(join(process.cwd(), 'src', 'core', 'tasks', 'verify.ts'), 'utf8');
    expect(text).not.toMatch(/function buildFingerprint\(/);
    expect(text).not.toMatch(/const MISSING_HASH_MARKER\s*=/);
    expect(text).toMatch(/import \{ buildFingerprint \} from '\.\/evidence\.js'/);
  });
});
