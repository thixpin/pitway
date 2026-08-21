import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  approveQuickChange,
  cancelQuickChange,
  createQuickChange,
  deriveQuickChangeState,
  QuickChangeError,
  readAllQuickChanges,
} from '../../src/core/quick-change/create.js';
import { commitQuickChange } from '../../src/core/quick-change/commit.js';
import { promoteQuickChange } from '../../src/core/quick-change/promote.js';
import { runQuickChange } from '../../src/core/quick-change/run.js';
import { readJournal } from '../../src/state/journal.js';
import { loadState, saveState } from '../../src/state/store.js';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'pitway-quick-change-'));
  git(['init', '-q'], repo);
  git(['config', 'user.email', 'test@example.com'], repo);
  git(['config', 'user.name', 'Test'], repo);
  mkdirSync(join(repo, '.pitway'), { recursive: true });
  writeFileSync(join(repo, 'README.md'), 'hello\n');
  writeFileSync(join(repo, 'src.ts'), 'export const x = 1;\n');
  // .pitway/ is committed to git in real usage (see CLAUDE.md's State
  // section) -- state.yaml is written and committed here so the fixture
  // starts from a genuinely clean tree, the same starting condition create's
  // clean-working-tree check expects in a real repo.
  saveState(repo, { schema_version: 1, active_milestone: null, milestones: [] });
  git(['add', 'README.md', 'src.ts', '.pitway/state.yaml'], repo);
  git(['commit', '-q', '-m', 'init'], repo);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('createQuickChange', () => {
  it('creates a draft quick-change from a clean tree with no active milestone', () => {
    const view = createQuickChange(repo, {
      objective: 'Fix the gitignore rule',
      scope: ['README.md'],
      verifyCommand: 'echo ok',
    });
    expect(view.status).toBe('draft');
    expect(view.objective).toBe('Fix the gitignore rule');
    expect(view.scope).toEqual(['README.md']);
    expect(view.verifyCommand).toBe('echo ok');
    expect(view.approvedHash).toBeNull();
    expect(view.runs).toEqual([]);
    expect(view.id.length).toBeGreaterThan(0);

    const all = readAllQuickChanges(repo);
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe(view.id);
  });

  it('never appears in git status -- create performs no working-tree write', () => {
    createQuickChange(repo, {
      objective: 'Fix the gitignore rule',
      scope: ['README.md'],
      verifyCommand: 'echo ok',
    });
    const status = git(['status', '--porcelain'], repo).trim();
    expect(status).toBe('');
  });

  it('refuses an empty --objective', () => {
    expect(() =>
      createQuickChange(repo, { objective: '   ', scope: ['README.md'], verifyCommand: 'echo ok' }),
    ).toThrow(QuickChangeError);
  });

  it('refuses an empty --verify command', () => {
    expect(() =>
      createQuickChange(repo, { objective: 'Fix it', scope: ['README.md'], verifyCommand: '  ' }),
    ).toThrow(QuickChangeError);
  });

  it('refuses an empty --scope', () => {
    expect(() =>
      createQuickChange(repo, { objective: 'Fix it', scope: [], verifyCommand: 'echo ok' }),
    ).toThrow(QuickChangeError);
  });

  it('refuses a duplicate path within --scope', () => {
    expect(() =>
      createQuickChange(repo, {
        objective: 'Fix it',
        scope: ['README.md', 'README.md'],
        verifyCommand: 'echo ok',
      }),
    ).toThrow(/duplicate/);
  });

  it('refuses every path under .pitway/ as part of --scope', () => {
    expect(() =>
      createQuickChange(repo, {
        objective: 'Fix it',
        scope: ['.pitway/state.yaml'],
        verifyCommand: 'echo ok',
      }),
    ).toThrow(/protected/);
  });

  it('refuses a --scope path that resolves outside the repository', () => {
    expect(() =>
      createQuickChange(repo, {
        objective: 'Fix it',
        scope: ['../outside.txt'],
        verifyCommand: 'echo ok',
      }),
    ).toThrow(/outside the repository/);
  });

  it('refuses to create while a milestone is active (active_milestone is not null)', () => {
    saveState(repo, { schema_version: 1, active_milestone: 'M001', milestones: ['M001'] });
    expect(() =>
      createQuickChange(repo, { objective: 'Fix it', scope: ['README.md'], verifyCommand: 'echo ok' }),
    ).toThrow(/M001/);
  });

  it('refuses to create when the working tree is dirty', () => {
    writeFileSync(join(repo, 'README.md'), 'dirty\n');
    expect(() =>
      createQuickChange(repo, { objective: 'Fix it', scope: ['README.md'], verifyCommand: 'echo ok' }),
    ).toThrow(/not clean/);
  });

  it('two separate creates produce two distinct ids', () => {
    const first = createQuickChange(repo, {
      objective: 'Fix A',
      scope: ['README.md'],
      verifyCommand: 'echo ok',
    });
    const second = createQuickChange(repo, {
      objective: 'Fix B',
      scope: ['src.ts'],
      verifyCommand: 'echo ok',
    });
    expect(first.id).not.toBe(second.id);
  });
});

describe('approveQuickChange', () => {
  it('hashes and locks the declared scope + verify command, transitioning draft -> approved', () => {
    const created = createQuickChange(repo, {
      objective: 'Fix it',
      scope: ['README.md'],
      verifyCommand: 'echo ok',
    });
    const approved = approveQuickChange(repo, created.id);
    expect(approved.status).toBe('approved');
    expect(approved.approvedHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(approved.scope).toEqual(['README.md']);
    expect(approved.verifyCommand).toBe('echo ok');

    // The hash is a pure function of (scope, verifyCommand): re-deriving it
    // for two changes declaring the identical scope/verify pair yields the
    // identical hash.
    const other = createQuickChange(repo, {
      objective: 'A different objective entirely',
      scope: ['README.md'],
      verifyCommand: 'echo ok',
    });
    const otherApproved = approveQuickChange(repo, other.id);
    expect(otherApproved.approvedHash).toBe(approved.approvedHash);
  });

  it('appends a new record rather than mutating the draft record', () => {
    const created = createQuickChange(repo, {
      objective: 'Fix it',
      scope: ['README.md'],
      verifyCommand: 'echo ok',
    });
    approveQuickChange(repo, created.id);

    const all = readJournal(repo).filter((r) => r.kind === 'quick_change');
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ status: 'draft' });
    expect(all[1]).toMatchObject({ status: 'approved' });
  });

  it('refuses to approve an unknown change id', () => {
    expect(() => approveQuickChange(repo, 'qc-does-not-exist')).toThrow(/unknown/);
  });

  it('refuses to approve a change that is already approved', () => {
    const created = createQuickChange(repo, {
      objective: 'Fix it',
      scope: ['README.md'],
      verifyCommand: 'echo ok',
    });
    approveQuickChange(repo, created.id);
    expect(() => approveQuickChange(repo, created.id)).toThrow(QuickChangeError);
  });
});

describe('cancelQuickChange', () => {
  it('cancels a draft change, appending a new record and performing no git operation', () => {
    const created = createQuickChange(repo, {
      objective: 'Fix it',
      scope: ['README.md'],
      verifyCommand: 'echo ok',
    });
    const cancelled = cancelQuickChange(repo, created.id);
    expect(cancelled.status).toBe('cancelled');

    const status = git(['status', '--porcelain'], repo).trim();
    expect(status).toBe('');
    const all = readJournal(repo).filter((r) => r.kind === 'quick_change');
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ status: 'draft' });
  });

  it('cancels an approved change, carrying its approvedHash forward onto the cancelled record', () => {
    const created = createQuickChange(repo, {
      objective: 'Fix it',
      scope: ['README.md'],
      verifyCommand: 'echo ok',
    });
    const approved = approveQuickChange(repo, created.id);
    const cancelled = cancelQuickChange(repo, created.id);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.approvedHash).toBe(approved.approvedHash);
  });

  it('refuses to cancel an unknown change id', () => {
    expect(() => cancelQuickChange(repo, 'qc-does-not-exist')).toThrow(/unknown/);
  });

  it('refuses to cancel an already-cancelled change (never a transition out of a terminal state)', () => {
    const created = createQuickChange(repo, {
      objective: 'Fix it',
      scope: ['README.md'],
      verifyCommand: 'echo ok',
    });
    cancelQuickChange(repo, created.id);
    expect(() => cancelQuickChange(repo, created.id)).toThrow(QuickChangeError);
  });
});

describe('QuickChangeError identity across lifecycle modules', () => {
  // Regression for the M016/AC004 defect: QuickChangeError was declared as
  // two textually-identical but distinct classes (create.ts and run.ts each
  // `export class QuickChangeError extends Error {}`), with commit.ts
  // importing run.ts's class and promote.ts importing create.ts's -- so an
  // `instanceof QuickChangeError` check written against one site's import
  // silently failed to catch an error thrown by the other's code path. Now
  // that run.ts/commit.ts/promote.ts all import the single class create.ts
  // exports (rather than redeclaring or cross-importing it), an error thrown
  // by any of them passes `instanceof` the same canonical class.
  it('an unknown-id error thrown by run.ts is instanceof the same class create.ts throws', () => {
    expect(() => runQuickChange(repo, 'qc-does-not-exist')).toThrow(QuickChangeError);
  });

  it('an unknown-id error thrown by commit.ts is instanceof the same class create.ts throws', () => {
    expect(() => commitQuickChange(repo, 'qc-does-not-exist')).toThrow(QuickChangeError);
  });

  it('an unknown-id error thrown by promote.ts is instanceof the same class create.ts throws', () => {
    expect(() => promoteQuickChange(repo, 'qc-does-not-exist')).toThrow(QuickChangeError);
  });
});

describe('deriveQuickChangeState', () => {
  it('returns undefined for an id with no records', () => {
    expect(deriveQuickChangeState([], 'qc-none')).toBeUndefined();
  });

  it('is pure: folds over records for one id, taking the latest, independent of unrelated ids', () => {
    const records = [
      {
        kind: 'quick_change' as const,
        id: 'qc-a',
        status: 'draft' as const,
        objective: 'A',
        scope: ['a.ts'],
        verifyCommand: 'echo a',
        runs: [],
      },
      {
        kind: 'quick_change' as const,
        id: 'qc-b',
        status: 'draft' as const,
        objective: 'B',
        scope: ['b.ts'],
        verifyCommand: 'echo b',
        runs: [],
      },
      {
        kind: 'quick_change' as const,
        id: 'qc-a',
        status: 'approved' as const,
        objective: 'A',
        scope: ['a.ts'],
        verifyCommand: 'echo a',
        approvedHash: 'sha256:' + 'c'.repeat(64),
        runs: [],
      },
    ];
    expect(deriveQuickChangeState(records, 'qc-a')).toMatchObject({ status: 'approved' });
    expect(deriveQuickChangeState(records, 'qc-b')).toMatchObject({ status: 'draft' });
  });
});

// Sanity check that loadState/saveState round-trip the way this test file
// (and createQuickChange internally) relies on.
describe('fixture sanity', () => {
  it('active_milestone starts null after the beforeEach setup', () => {
    expect(loadState(repo).active_milestone).toBeNull();
  });
});
