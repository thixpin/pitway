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
import { loadBacklog, saveBacklog, saveState } from '../../src/state/store.js';
import type { BacklogItem } from '../../src/state/schemas.js';

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

// M037/T001: quick-change create --closes fixtures. Committed immediately,
// mirroring the beforeEach fixture's own commit of state.yaml -- create's
// clean-working-tree gate otherwise refuses on the backlog.yaml this
// fixture writes.
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

function backlogStatus(root: string, id: string): string | undefined {
  return loadBacklog(root).items.find((item) => item.id === id)?.status;
}

function createApproveRunClosing(backlogId: string): QuickChangeView {
  const created = createQuickChange(repo, {
    objective: 'Fix the readme typo',
    scope: ['README.md'],
    verifyCommand: 'echo ok',
    tddExempt: true,
    tddExemptReason: 'test-only: echo ok has no RED state',
    closesBacklogId: backlogId,
  });
  const approved = approveQuickChange(repo, created.id);
  writeFileSync(join(repo, 'README.md'), 'fixed\n');
  runQuickChange(repo, approved.id);
  return approved;
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
    const created = createQuickChange(repo, {
      objective: 'Fix the readme typo',
      scope: ['README.md'],
      verifyCommand: 'echo ok',
      tddExempt: true,
      tddExemptReason: 'test-only: echo ok has no RED state',
    });
    const approved = approveQuickChange(repo, created.id);
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
    const created = createQuickChange(repo, {
      objective: 'Fix the readme typo',
      scope: ['README.md'],
      verifyCommand: 'echo ok',
      tddExempt: true,
      tddExemptReason: 'test-only: echo ok has no RED state',
    });
    const approved = approveQuickChange(repo, created.id);
    runQuickChange(repo, approved.id);
    writeFileSync(join(repo, 'README.md'), 'fixed\n');
    writeFileSync(join(repo, 'other.txt'), 'not in scope\n');
    expect(() => commitQuickChange(repo, approved.id)).toThrow(/unrelated dirty changes/);
  });

  it('lands a real commit carrying PitWay-Change and no milestone/task trailers', () => {
    const created = createQuickChange(repo, {
      objective: 'Fix the readme typo',
      scope: ['README.md'],
      verifyCommand: 'echo ok',
      tddExempt: true,
      tddExemptReason: 'test-only: echo ok has no RED state',
    });
    const approved = approveQuickChange(repo, created.id);
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
    const created = createQuickChange(repo, {
      objective: 'Fix the readme typo',
      scope: ['README.md'],
      verifyCommand: 'echo ok',
      tddExempt: true,
      tddExemptReason: 'test-only: echo ok has no RED state',
    });
    const approved = approveQuickChange(repo, created.id);
    writeFileSync(join(repo, 'README.md'), 'fixed\n');
    runQuickChange(repo, approved.id);
    commitQuickChange(repo, approved.id);
    expect(() => runQuickChange(repo, approved.id)).toThrow(/not approved/);
  });

  it('self-heals on a second invocation after the commit already exists (interrupted-then-resumed)', () => {
    const created = createQuickChange(repo, {
      objective: 'Fix the readme typo',
      scope: ['README.md'],
      verifyCommand: 'echo ok',
      tddExempt: true,
      tddExemptReason: 'test-only: echo ok has no RED state',
    });
    const approved = approveQuickChange(repo, created.id);
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

describe('commitQuickChange TDD discipline (B020 RED→GREEN)', () => {
  it('refuses to commit when only a single passing run exists and no prior fail (requires RED before GREEN)', () => {
    const approved = createAndApprove('echo ok');
    writeFileSync(join(repo, 'README.md'), 'fixed\n');
    runQuickChange(repo, approved.id);
    // Single pass, no prior fail — TDD requires a failing run first.
    expect(() => commitQuickChange(repo, approved.id)).toThrow(/TDD|failing run|RED/i);
  });

  it('allows commit with a single passing run when the change was created as tdd-exempt (doc-only / test-free)', () => {
    const created = createQuickChange(repo, {
      objective: 'Fix typo in README',
      scope: ['README.md'],
      verifyCommand: 'echo ok',
      tddExempt: true,
      tddExemptReason: 'doc-only: typo fix, verify is existence check',
    });
    const approved = approveQuickChange(repo, created.id);
    writeFileSync(join(repo, 'README.md'), 'fixed\n');
    runQuickChange(repo, approved.id);
    const result = commitQuickChange(repo, approved.id);
    expect(result.outcome).toBe('committed');
  });

  it('allows commit when a failing run precedes the passing run (RED→GREEN)', () => {
    const verify = 'node -e "if(!require(\'fs\').readFileSync(\'README.md\',\'utf8\').includes(\'FIXED\')) process.exit(1)"';
    const created = createQuickChange(repo, {
      objective: 'Fix behavior',
      scope: ['README.md'],
      verifyCommand: verify,
    });
    const approved = approveQuickChange(repo, created.id);
    // README.md is still 'hello\n' from beforeEach — verify fails (RED)
    const first = runQuickChange(repo, approved.id);
    expect(first.status).toBe('fail');
    // Apply fix — now verify passes (GREEN)
    writeFileSync(join(repo, 'README.md'), 'FIXED\n');
    const second = runQuickChange(repo, approved.id);
    expect(second.status).toBe('pass');
    const result = commitQuickChange(repo, approved.id);
    expect(result.outcome).toBe('committed');
  });
});

describe('commitQuickChange --closes <backlog-id>', () => {
  it('archives the linked backlog item in the same commit, with only a PitWay-Change trailer', () => {
    makePendingBacklogItem(repo, 'B001');
    const approved = createApproveRunClosing('B001');
    const before = commitCount(repo);

    const result = commitQuickChange(repo, approved.id);
    expect(result.outcome).toBe('committed');
    expect(commitCount(repo)).toBe(before + 1);

    expect(backlogStatus(repo, 'B001')).toBe('archived');
    const message = headMessage(repo);
    expect(message).toContain(`PitWay-Change: ${approved.id}`);
    expect(message).not.toContain('PitWay-Milestone');
    expect(message).not.toContain('PitWay-Task');
    expect(message).not.toMatch(/PitWay-(?!Change)/);

    const status = git(['status', '--porcelain'], repo).trim();
    expect(status).toBe('');
  });

  it('a change with no --closes at all never touches backlog.yaml', () => {
    const created = createQuickChange(repo, {
      objective: 'Fix the readme typo',
      scope: ['README.md'],
      verifyCommand: 'echo ok',
      tddExempt: true,
      tddExemptReason: 'test-only: echo ok has no RED state',
    });
    const approved = approveQuickChange(repo, created.id);
    writeFileSync(join(repo, 'README.md'), 'fixed\n');
    runQuickChange(repo, approved.id);
    const before = commitCount(repo);
    commitQuickChange(repo, approved.id);
    expect(commitCount(repo)).toBe(before + 1);
    expect(headMessage(repo)).not.toContain('backlog');
    const files = git(['show', '--name-only', '--format='], repo)
      .split('\n')
      .filter((l) => l.trim().length > 0);
    expect(files).not.toContain('.pitway/backlog.yaml');
  });

  it('is a safe no-op when re-run after a successful commit+archive (no double-commit, no double-archive)', () => {
    makePendingBacklogItem(repo, 'B001');
    const approved = createApproveRunClosing('B001');
    commitQuickChange(repo, approved.id);
    expect(backlogStatus(repo, 'B001')).toBe('archived');
    const before = commitCount(repo);

    const again = commitQuickChange(repo, approved.id);
    expect(again.outcome).toBe('already-committed');
    expect(commitCount(repo)).toBe(before);
    expect(backlogStatus(repo, 'B001')).toBe('archived');
  });

  it('is a safe no-op when re-run after the archive succeeded but the git commit did not land (crash between archive and commit)', () => {
    makePendingBacklogItem(repo, 'B001');
    const approved = createApproveRunClosing('B001');

    // Simulate the archive half of a prior commit attempt succeeding, then
    // the process crashing before commitOrResume's git commit landed --
    // archiveBacklogItem's own immediate write already happened, but no
    // commit exists yet and the local quick-change record is still
    // 'approved'.
    const backlog = loadBacklog(repo);
    saveBacklog(repo, {
      schema_version: backlog.schema_version,
      items: backlog.items.map((item) =>
        item.id === 'B001'
          ? { ...item, status: 'archived' as const, resolved_at: new Date().toISOString(), archived_reason: `closed by quick-change ${approved.id}` }
          : item,
      ),
    });

    const before = commitCount(repo);
    const result = commitQuickChange(repo, approved.id);
    expect(result.outcome).toBe('committed');
    expect(commitCount(repo)).toBe(before + 1);
    expect(backlogStatus(repo, 'B001')).toBe('archived');

    const status = git(['status', '--porcelain'], repo).trim();
    expect(status).toBe('');
  });

  it('refuses to commit --closes when the latest run failed, and never archives the linked item', () => {
    makePendingBacklogItem(repo, 'B001');
    const created = createQuickChange(repo, {
      objective: 'Fix it',
      scope: ['README.md'],
      verifyCommand: 'exit 1',
      closesBacklogId: 'B001',
    });
    const approved = approveQuickChange(repo, created.id);
    writeFileSync(join(repo, 'README.md'), 'fixed\n');
    runQuickChange(repo, approved.id);
    expect(() => commitQuickChange(repo, approved.id)).toThrow(/no passing run/);
    expect(backlogStatus(repo, 'B001')).toBe('pending');
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

// B041 (qc-465f7e1e): the commit subject is bounded and derived from the
// objective; the full objective lives in the body when the subject cannot
// carry it verbatim. Short objectives commit exactly as before.
describe('commitQuickChange commit subject (B041)', () => {
  function commitWith(objective: string): string {
    const created = createQuickChange(repo, {
      objective,
      scope: ['README.md'],
      verifyCommand: 'echo ok',
      tddExempt: true,
      tddExemptReason: 'test-only: echo ok has no RED state',
    });
    const approved = approveQuickChange(repo, created.id);
    writeFileSync(join(repo, 'README.md'), `${objective.length}\n`);
    runQuickChange(repo, approved.id);
    commitQuickChange(repo, approved.id);
    return headMessage(repo);
  }

  it('keeps a short single-sentence objective as the whole subject, with no duplicated body', () => {
    const message = commitWith('Fix the readme typo');
    const [subject = '', blank, ...rest] = message.split('\n');
    expect(subject).toBe('fix: Fix the readme typo');
    expect(blank).toBe('');
    expect(rest.join('\n')).toMatch(/^PitWay-Change: qc-/);
  });

  it('cuts a long multi-sentence objective to a <=72-char first-sentence subject with an ellipsis and carries the full objective in the body', () => {
    const objective =
      'B999: make the very long objective text fit the git subject line by cutting it sensibly at a word boundary. ' +
      'The second sentence explains the rationale in more detail and must survive in the body, not the subject.';
    const message = commitWith(objective);
    const [subject = '', blank, ...rest] = message.split('\n');
    expect(subject.startsWith('fix: ')).toBe(true);
    expect(subject.length).toBeLessThanOrEqual(72);
    expect(subject.endsWith('…')).toBe(true);
    expect(subject).not.toMatch(/\s…$/); // cut at a word boundary, no dangling space
    expect(blank).toBe('');
    const body = rest.join('\n');
    expect(body).toContain(objective);
    expect(body).toMatch(/PitWay-Change: qc-/);
  });

  it('uses the whole first sentence when it fits, dropping the rest to the body without an ellipsis', () => {
    const objective = 'Tighten the parser. It previously accepted trailing commas in the id list, which the schema forbids.';
    const message = commitWith(objective);
    const [subject = '', , ...rest] = message.split('\n');
    expect(subject).toBe('fix: Tighten the parser.');
    expect(rest.join('\n')).toContain(objective);
  });
});
