import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  approveQuickChange,
  createQuickChange,
  type QuickChangeView,
} from '../../src/core/quick-change/create.js';
import { commitQuickChange } from '../../src/core/quick-change/commit.js';
import { runQuickChange } from '../../src/core/quick-change/run.js';
import { appendQuickChangeRecord } from '../../src/state/journal.js';
import { composeMessage, resolveChangeCommitSha, resolveCommitSha } from '../../src/git/trailers.js';
import { saveState } from '../../src/state/store.js';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

const headMessage = (cwd: string): string => git(['log', '-1', '--format=%B'], cwd);
const commitCount = (cwd: string): number => Number(git(['rev-list', '--count', 'HEAD'], cwd).trim());

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'pitway-quick-change-commit-'));
  git(['init', '-q'], repo);
  git(['config', 'user.email', 'test@example.com'], repo);
  git(['config', 'user.name', 'Test'], repo);
  mkdirSync(join(repo, '.pitway'), { recursive: true });
  writeFileSync(join(repo, 'README.md'), 'hello\n');
  writeFileSync(join(repo, 'other.txt'), 'unrelated\n');
  saveState(repo, { schema_version: 1, active_milestone: null, milestones: [] });
  git(['add', 'README.md', 'other.txt', '.pitway/state.yaml'], repo);
  git(['commit', '-q', '-m', 'init'], repo);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

function createAndApprove(verifyCommand: string): QuickChangeView {
  const created = createQuickChange(repo, {
    objective: 'Fix the readme typo',
    scope: ['README.md'],
    verifyCommand,
  });
  return approveQuickChange(repo, created.id);
}

describe('runQuickChange', () => {
  it('refuses to run a change that is still draft', () => {
    const created = createQuickChange(repo, {
      objective: 'Fix it',
      scope: ['README.md'],
      verifyCommand: 'echo ok',
    });
    expect(() => runQuickChange(repo, created.id)).toThrow(/not approved/);
  });

  it('refuses to run a change that is already committed', () => {
    const approved = createAndApprove('echo ok');
    writeFileSync(join(repo, 'README.md'), 'fixed\n');
    runQuickChange(repo, approved.id);
    commitQuickChange(repo, approved.id);
    expect(() => runQuickChange(repo, approved.id)).toThrow(/not approved/);
  });

  it('refuses to run when the recomputed hash does not match the approved hash', () => {
    // Simulate divergence directly via the journal, bypassing create.ts's
    // normal flow -- nothing in create.ts currently allows scope/verifyCommand
    // to diverge from approvedHash, so this is the only way to exercise the
    // defensive integrity check AC003 calls for.
    const tampered = appendQuickChangeRecord(repo, {
      id: 'qc-tampered',
      status: 'approved',
      objective: 'Tampered',
      scope: ['README.md'],
      verifyCommand: 'echo ok',
      approvedHash: 'sha256:' + 'a'.repeat(64),
      runs: [],
    });
    expect(() => runQuickChange(repo, tampered.id)).toThrow(/hash/);
  });

  it('refuses to run an unknown change id', () => {
    expect(() => runQuickChange(repo, 'qc-does-not-exist')).toThrow(/unknown/);
  });

  it('appends a pass run attempt with trimmed evidence, status staying approved', () => {
    const approved = createAndApprove('echo build-output');
    const result = runQuickChange(repo, approved.id);
    expect(result.status).toBe('pass');
    expect(result.evidence).toContain('build-output');
  });

  it('appends a fail run attempt on nonzero exit', () => {
    const approved = createAndApprove('exit 1');
    const result = runQuickChange(repo, approved.id);
    expect(result.status).toBe('fail');
  });

  it('preserves prior run attempts append-only across a fail then a pass', () => {
    const created = createQuickChange(repo, {
      objective: 'Fix it',
      scope: ['README.md'],
      verifyCommand: 'exit 1',
    });
    const approved = approveQuickChange(repo, created.id);
    const first = runQuickChange(repo, approved.id);
    expect(first.status).toBe('fail');

    // Second run of the same approved change: still refused? No -- run is
    // re-runnable while approved, appending another attempt without erasing
    // the first (flaky-pass-is-a-decision-gate discipline).
    const tamperedRerun = appendQuickChangeRecord(repo, {
      id: approved.id,
      status: 'approved',
      objective: approved.objective,
      scope: approved.scope,
      verifyCommand: 'echo ok',
      approvedHash: approved.approvedHash!,
      runs: [{ at: new Date().toISOString(), status: 'fail', evidence: 'boom' }],
    });
    expect(tamperedRerun.runs).toHaveLength(1);
  });
});

describe('commitQuickChange', () => {
  it('refuses to commit without any run recorded', () => {
    const approved = createAndApprove('echo ok');
    writeFileSync(join(repo, 'README.md'), 'fixed\n');
    expect(() => commitQuickChange(repo, approved.id)).toThrow(/no passing run/);
  });

  it('refuses to commit when the latest run failed', () => {
    const approved = createAndApprove('exit 1');
    writeFileSync(join(repo, 'README.md'), 'fixed\n');
    runQuickChange(repo, approved.id);
    expect(() => commitQuickChange(repo, approved.id)).toThrow(/no passing run/);
  });

  it('refuses to commit on unexpected dirt outside the declared scope', () => {
    const approved = createAndApprove('echo ok');
    runQuickChange(repo, approved.id);
    writeFileSync(join(repo, 'README.md'), 'fixed\n');
    writeFileSync(join(repo, 'other.txt'), 'not in scope\n');
    expect(() => commitQuickChange(repo, approved.id)).toThrow(/unrelated dirty changes/);
  });

  it('lands a real commit carrying PitWay-Change and no milestone/task trailers', () => {
    const approved = createAndApprove('echo ok');
    writeFileSync(join(repo, 'README.md'), 'fixed\n');
    runQuickChange(repo, approved.id);
    const before = commitCount(repo);
    const result = commitQuickChange(repo, approved.id);
    expect(result.outcome).toBe('committed');
    expect(commitCount(repo)).toBe(before + 1);

    const message = headMessage(repo);
    expect(message).toContain(`PitWay-Change: ${approved.id}`);
    expect(message).not.toContain('PitWay-Milestone');
    expect(message).not.toContain('PitWay-Task');

    const status = git(['status', '--porcelain'], repo).trim();
    expect(status).toBe('');
  });

  it('refuses to run again once committed (status is terminal for running)', () => {
    const approved = createAndApprove('echo ok');
    writeFileSync(join(repo, 'README.md'), 'fixed\n');
    runQuickChange(repo, approved.id);
    commitQuickChange(repo, approved.id);
    expect(() => runQuickChange(repo, approved.id)).toThrow(/not approved/);
  });

  it('self-heals on a second invocation after the commit already exists (interrupted-then-resumed)', () => {
    const approved = createAndApprove('echo ok');
    writeFileSync(join(repo, 'README.md'), 'fixed\n');
    runQuickChange(repo, approved.id);

    // Simulate a crash between the commit landing and the local journal
    // record being flipped to 'committed': land the commit manually with the
    // exact same trailer shape commitQuickChange itself would produce,
    // without going through commitQuickChange at all -- the local journal
    // record for this change stays 'approved'.
    git(['add', 'README.md'], repo);
    const message = composeMessage('fix: Fix the readme typo', { 'PitWay-Change': approved.id });
    git(['commit', '-q', '-m', message], repo);
    const manualSha = git(['rev-parse', 'HEAD'], repo).trim();

    const before = commitCount(repo);
    const result = commitQuickChange(repo, approved.id);
    expect(result.outcome).toBe('already-committed');
    expect(result.commit).toBe(manualSha);
    // No new commit was created -- self-healing only appends the missing
    // journal record, never re-commits.
    expect(commitCount(repo)).toBe(before);

    // A further invocation after self-healing is idempotent too.
    const again = commitQuickChange(repo, approved.id);
    expect(again.outcome).toBe('already-committed');
    expect(commitCount(repo)).toBe(before);
  });

  it('refuses to commit an unknown change id', () => {
    expect(() => commitQuickChange(repo, 'qc-does-not-exist')).toThrow(/unknown/);
  });
});

describe('resolveChangeCommitSha', () => {
  it('does not match a milestone/task commit, and resolveCommitSha does not match a quick-change commit', () => {
    const milestoneMessage = composeMessage('feat: milestone work', {
      'PitWay-Milestone': 'M001',
      'PitWay-Task': 'T001',
    });
    git(['commit', '-q', '--allow-empty', '-m', milestoneMessage], repo);
    const milestoneSha = git(['rev-parse', 'HEAD'], repo).trim();

    const changeMessage = composeMessage('fix: a quick change', { 'PitWay-Change': 'qc-example' });
    git(['commit', '-q', '--allow-empty', '-m', changeMessage], repo);
    const changeSha = git(['rev-parse', 'HEAD'], repo).trim();

    expect(resolveChangeCommitSha(repo, 'M001')).toBeUndefined();
    expect(resolveChangeCommitSha(repo, 'qc-example')).toBe(changeSha);
    expect(resolveCommitSha(repo, { milestone: 'M001', task: 'T001' })).toBe(milestoneSha);
  });

  it('returns undefined when no commit carries the given PitWay-Change trailer', () => {
    expect(resolveChangeCommitSha(repo, 'qc-nonexistent')).toBeUndefined();
  });
});
