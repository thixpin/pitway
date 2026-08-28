import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findCompletionCommit, milestoneSince, tasksRepoPath } from '../../src/core/tasks/completion-commit.js';
import { TaskUpdateError } from '../../src/core/tasks/update.js';
import { saveContract } from '../../src/state/store.js';
import type { ContractFrontmatter } from '../../src/state/schemas.js';

// M039/T001 (AC004): the completion-commit identity lookup (AC018 of the
// original design), exercised directly against a real temp repository.

let root: string;

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString().trim();
}

function frontmatter(opts: { base_revision?: string } = {}): ContractFrontmatter {
  return {
    schema_version: 1,
    id: 'M001',
    title: 'Test Milestone',
    status: 'in_progress',
    requirement: null,
    confirmed_at: null,
    verification_approved_hash: null,
    acceptance_criteria: [{ id: 'AC001', text: 'x' }],
    verification: [{ id: 'CT001', criterion: 'AC001', type: 'command', command: 'npm test' }],
    ...opts,
  };
}

function commitTasksYaml(content: string, message: string): string {
  writeFileSync(join(root, '.pitway', 'milestones', 'M001', 'tasks.yaml'), content);
  git(['add', '-A']);
  git(['commit', '-q', '-m', message]);
  return git(['rev-parse', 'HEAD']);
}

const persisted = { summary: 'built it', evidence: '3 passed' };
const completedYaml = `schema_version: 1\ntasks:\n  - id: T001\n    status: completed\n    result:\n      summary: built it\n      evidence: 3 passed\n`;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pitway-completion-commit-'));
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  mkdirSync(join(root, '.pitway', 'milestones', 'M001'), { recursive: true });
  saveContract(root, 'M001', { frontmatter: frontmatter(), body: '\n' });
  commitTasksYaml('schema_version: 1\ntasks: []\n', 'workflow: add milestone M001\n\nPitWay-Milestone: M001');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('tasksRepoPath / milestoneSince', () => {
  it('resolves the on-disk milestone directory name and the optional base_revision bound', () => {
    expect(tasksRepoPath(root, 'M001')).toBe('.pitway/milestones/M001/tasks.yaml');
    expect(milestoneSince(root, 'M001')).toBeUndefined();
    saveContract(root, 'M001', { frontmatter: frontmatter({ base_revision: 'a'.repeat(40) }), body: '\n' });
    expect(milestoneSince(root, 'M001')).toBe('a'.repeat(40));
  });
});

describe('findCompletionCommit', () => {
  it('returns undefined when no commit carries the task completion trailers', () => {
    expect(findCompletionCommit(root, 'M001', 'T001', persisted)).toBeUndefined();
  });

  it('returns the sha whose committed tasks.yaml shows the task completed with the persisted result', () => {
    const sha = commitTasksYaml(completedYaml, 'feat: T001\n\nPitWay-Milestone: M001\nPitWay-Task: T001');
    expect(findCompletionCommit(root, 'M001', 'T001', persisted)).toBe(sha);
  });

  it('refuses as ambiguous when the trailers match but the committed record differs from the persisted result', () => {
    const sha = commitTasksYaml(completedYaml, 'feat: T001\n\nPitWay-Milestone: M001\nPitWay-Task: T001');
    const other = { summary: 'something else', evidence: '3 passed' };
    expect(() => findCompletionCommit(root, 'M001', 'T001', other)).toThrow(TaskUpdateError);
    expect(() => findCompletionCommit(root, 'M001', 'T001', other)).toThrow(
      `ambiguous state: commit ${sha} carries the T001 completion trailers but its committed record does not match the persisted result; inspect manually`,
    );
  });
});
