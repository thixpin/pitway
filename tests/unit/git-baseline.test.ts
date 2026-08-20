import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computeExpectedBaselinePaths, createBaselineCommit } from '../../src/git/baseline.js';
import { GitError } from '../../src/git/exec.js';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'pitway-baseline-'));
  git(['init', '-q'], repo);
  git(['config', 'user.email', 'test@example.com'], repo);
  git(['config', 'user.name', 'Test'], repo);
  writeFileSync(join(repo, 'README.md'), 'hello\n');
  git(['add', 'README.md'], repo);
  git(['commit', '-q', '-m', 'init'], repo);
  mkdirSync(join(repo, '.pitway', 'milestones', 'M002'), { recursive: true });
  writeFileSync(join(repo, '.pitway', 'milestones', 'M002', 'contract.md'), 'x\n');
  writeFileSync(join(repo, '.pitway', 'state.yaml'), 'x\n');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

// M006 hotfix regression coverage: computeExpectedBaselinePaths previously
// had no direct unit coverage at all (only createBaselineCommit, above, was
// tested) -- this is what let the .claude/-asset gap go unnoticed until it
// surfaced as 79 integration failures.
describe('computeExpectedBaselinePaths', () => {
  it('returns exactly the .pitway/ baseline paths when no extra paths are given (existing behavior unchanged)', () => {
    expect(computeExpectedBaselinePaths('M002', null)).toEqual([
      '.pitway/config.yaml',
      '.pitway/state.yaml',
      '.pitway/milestones/M002/contract.md',
      '.pitway/milestones/M002/tasks.yaml',
      '.pitway/milestones/M002/verification-results.yaml',
      '.pitway/milestones/M002/verification-repairs.yaml',
      '.pitway/milestones/M002/usage.yaml',
      '.pitway/milestones/M002/reviews.yaml',
    ]);
  });

  it('still includes the requirement path when a requirement id is given, unchanged from before', () => {
    expect(computeExpectedBaselinePaths('M002', 'R001')).toContain('.pitway/requirements/R001.md');
  });

  it('appends exact extra paths verbatim -- never a directory prefix or glob', () => {
    const extra = ['.claude/protocol-driver.md', '.claude/commands/verify.md'];
    const result = computeExpectedBaselinePaths('M002', null, extra);
    expect(result).toEqual(expect.arrayContaining(extra));
    // Exactly the two given entries were appended -- nothing broader like a
    // bare ".claude" or ".claude/" prefix was synthesized.
    expect(result.filter((p) => p.startsWith('.claude')).sort()).toEqual([...extra].sort());
  });

  it('defaults extra paths to none when the parameter is omitted', () => {
    const withDefault = computeExpectedBaselinePaths('M002', null);
    const withExplicitEmpty = computeExpectedBaselinePaths('M002', null, []);
    expect(withDefault).toEqual(withExplicitEmpty);
  });
});

describe('createBaselineCommit', () => {
  it('stages only the intended paths and commits with the baseline message and PitWay-Milestone trailer only', () => {
    const sha = createBaselineCommit(repo, {
      milestoneId: 'M002',
      paths: ['.pitway/milestones/M002', '.pitway/state.yaml'],
    });
    const message = git(['log', '-1', '--format=%B', sha], repo);
    expect(message).toContain('workflow: add milestone M002');
    expect(message).toContain('PitWay-Milestone: M002');
    expect(message).not.toContain('PitWay-Task');
    expect(git(['status', '--porcelain'], repo).trim()).toBe('');
  });

  it('refuses and stages nothing when unrelated dirty changes are present outside the intended paths', () => {
    writeFileSync(join(repo, 'unrelated.txt'), 'wip\n');
    expect(() =>
      createBaselineCommit(repo, {
        milestoneId: 'M002',
        paths: ['.pitway/milestones/M002', '.pitway/state.yaml'],
      }),
    ).toThrowError(GitError);
    // nothing staged, unrelated file still untracked, intended files still untracked
    const status = git(['status', '--porcelain'], repo);
    expect(status).toContain('?? unrelated.txt');
    expect(status).toContain('.pitway/');
    // no new commit created
    expect(git(['log', '--oneline'], repo).trim().split('\n')).toHaveLength(1);
  });

  it('refuses to create an empty baseline commit when there is nothing to stage', () => {
    git(['add', '.pitway'], repo);
    git(['commit', '-q', '-m', 'pre-existing'], repo);
    expect(() =>
      createBaselineCommit(repo, {
        milestoneId: 'M002',
        paths: ['.pitway/milestones/M002', '.pitway/state.yaml'],
      }),
    ).toThrowError(/empty|nothing/i);
  });
});
