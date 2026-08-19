import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// M007/T001/AC001: Git traceability audit -- generic trailer/classification
// behavior only, proven against a synthetic temp history built by this test,
// never against this repository's own real commits. Real SHAs, real counts,
// and this repository's actual audit results belong exclusively in
// docs/evidence/M007/dogfood-evidence.md (driver-supplied, from a read-only
// inspection of the real repository) -- asserting real SHAs here would make
// this suite fragile under a shallow clone, a squashed/rewritten history, a
// source archive, or a package install, none of which preserve arbitrary
// historical commit identity.

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

function isAncestor(cwd: string, ancestor: string, descendant: string): boolean {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

interface CommitInfo {
  sha: string;
  subject: string;
  milestoneTrailer: string;
  taskTrailer: string;
}

function commitsBetween(cwd: string, from: string, to: string): CommitInfo[] {
  const range = `${from}..${to}`;
  const shas = git(['log', '--reverse', '--pretty=format:%H', range], cwd)
    .split('\n')
    .filter((l) => l.trim().length > 0);
  return shas.map((sha) => ({
    sha,
    subject: git(['log', '-1', '--format=%s', sha], cwd).trim(),
    milestoneTrailer: git(['log', '-1', '--format=%(trailers:key=PitWay-Milestone,valueonly)', sha], cwd).trim(),
    taskTrailer: git(['log', '-1', '--format=%(trailers:key=PitWay-Task,valueonly)', sha], cwd).trim(),
  }));
}

function commit(cwd: string, subject: string, trailers: string[] = []): string {
  const message = trailers.length > 0 ? `${subject}\n\n${trailers.join('\n')}` : subject;
  git(['commit', '--allow-empty', '-m', message], cwd);
  return git(['rev-parse', 'HEAD'], cwd).trim();
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pitway-git-audit-'));
  git(['init', '-q'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('Git traceability audit — generic classification (synthetic history)', () => {
  it('classifies every trailer-less commit inside a milestone range as a standalone-fix commit', () => {
    commit(root, 'init');
    const baseline = commit(root, 'workflow: add milestone M900', ['PitWay-Milestone: M900']);
    commit(root, 'feat(core): task one', ['PitWay-Milestone: M900', 'PitWay-Task: T001']);
    const hotfix1 = commit(root, 'fix(core): a ripple fix discovered mid-task');
    commit(root, 'feat(core): task two', ['PitWay-Milestone: M900', 'PitWay-Task: T002']);
    const hotfix2 = commit(root, 'fix(core): a second ripple fix');
    const completion = commit(root, 'workflow: complete milestone M900', ['PitWay-Milestone: M900']);

    const commits = commitsBetween(root, baseline, completion);
    const untrailered = commits.filter((c) => c.milestoneTrailer === '' && c.taskTrailer === '');
    expect(untrailered.map((c) => c.sha).sort()).toEqual([hotfix1, hotfix2].sort());
  });

  it('every non-hotfix commit inside the range carries a PitWay-Milestone trailer, and every task commit (not a baseline/completion checkpoint) carries PitWay-Task too', () => {
    commit(root, 'init');
    const baseline = commit(root, 'workflow: add milestone M900', ['PitWay-Milestone: M900']);
    const task = commit(root, 'feat(core): task one', ['PitWay-Milestone: M900', 'PitWay-Task: T001']);
    commit(root, 'fix(core): a ripple fix');
    const completion = commit(root, 'workflow: complete milestone M900', ['PitWay-Milestone: M900']);

    const commits = commitsBetween(root, baseline, completion);
    for (const c of commits) {
      if (c.milestoneTrailer === '' && c.taskTrailer === '') continue; // a declared hotfix
      expect(c.milestoneTrailer, `${c.sha} (${c.subject}) missing PitWay-Milestone`).not.toBe('');
      if (c.sha === task) {
        expect(c.taskTrailer, `${c.sha} (${c.subject}) missing PitWay-Task`).not.toBe('');
      }
    }
  });

  it('classifies a trailer-less commit strictly between two milestones as a between-milestone maintenance commit, never a hotfix of either milestone', () => {
    commit(root, 'init');
    const baseline = commit(root, 'workflow: add milestone M900', ['PitWay-Milestone: M900']);
    commit(root, 'feat(core): task one', ['PitWay-Milestone: M900', 'PitWay-Task: T001']);
    const completion = commit(root, 'workflow: complete milestone M900', ['PitWay-Milestone: M900']);
    const maintenance = commit(root, 'chore: normalize repository tooling');
    const nextBaseline = commit(root, 'workflow: add milestone M901', ['PitWay-Milestone: M901']);

    // Not inside M900's own hotfix range.
    const m900Commits = commitsBetween(root, baseline, completion);
    expect(m900Commits.map((c) => c.sha)).not.toContain(maintenance);

    // Positioned strictly after M900's completion and strictly before
    // M901's baseline -- genuinely between milestones, not inside either.
    expect(isAncestor(root, completion, maintenance)).toBe(true);
    expect(isAncestor(root, maintenance, completion)).toBe(false);
    expect(isAncestor(root, maintenance, nextBaseline)).toBe(true);

    const maintenanceTrailer = git(
      ['log', '-1', '--format=%(trailers:key=PitWay-Milestone,valueonly)', maintenance],
      root,
    ).trim();
    expect(maintenanceTrailer).toBe('');
  });

  it('a milestone range with zero trailer-less commits reports zero standalone-fix commits, not a false positive', () => {
    commit(root, 'init');
    const baseline = commit(root, 'workflow: add milestone M900', ['PitWay-Milestone: M900']);
    commit(root, 'feat(core): task one', ['PitWay-Milestone: M900', 'PitWay-Task: T001']);
    const completion = commit(root, 'workflow: complete milestone M900', ['PitWay-Milestone: M900']);

    const commits = commitsBetween(root, baseline, completion);
    const untrailered = commits.filter((c) => c.milestoneTrailer === '' && c.taskTrailer === '');
    expect(untrailered).toHaveLength(0);
  });
});
