import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { composeMessage } from '../../src/git/trailers.js';
import { createCommit } from '../../src/git/commit.js';
import { GitError } from '../../src/git/exec.js';

describe('composeMessage', () => {
  it('appends only the given trailers to a plain message', () => {
    const result = composeMessage('feat: do the thing', {
      'PitWay-Milestone': 'M002',
      'PitWay-Task': 'T002',
    });
    expect(result).toBe('feat: do the thing\n\nPitWay-Milestone: M002\nPitWay-Task: T002\n');
  });

  it('strips a Claude-Session trailer while keeping other trailers', () => {
    const input = 'feat: do the thing\n\nPitWay-Task: T001\nClaude-Session: https://claude.ai/code/session_x';
    const result = composeMessage(input, { 'PitWay-Milestone': 'M002' });
    expect(result).not.toContain('Claude-Session');
    expect(result).toContain('PitWay-Task: T001');
    expect(result).toContain('PitWay-Milestone: M002');
  });

  it('strips Codex-Session and Gemini-Session trailers', () => {
    const input =
      'feat: x\n\nCodex-Session: abc\nGemini-Session: def\nPitWay-Task: T001';
    const result = composeMessage(input, {});
    expect(result).not.toContain('Codex-Session');
    expect(result).not.toContain('Gemini-Session');
    expect(result).toContain('PitWay-Task: T001');
  });

  it('preserves every Co-Authored-By trailer verbatim -- PitWay maintains no AI co-author identity (M029/AC003)', () => {
    const input = 'feat: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>';
    const result = composeMessage(input, {});
    expect(result).toContain('Co-Authored-By: Claude <noreply@anthropic.com>');
  });

  it('preserves a legitimate human Co-Authored-By trailer', () => {
    const input = 'feat: x\n\nCo-Authored-By: Jane Doe <jane@example.com>';
    const result = composeMessage(input, { 'PitWay-Task': 'T001' });
    expect(result).toContain('Co-Authored-By: Jane Doe <jane@example.com>');
    expect(result).toContain('PitWay-Task: T001');
  });

  it('does not strip a human co-author merely named "Claude" (no name-based matching)', () => {
    const input = 'feat: x\n\nCo-Authored-By: Claude Martin <claude.martin@example.com>';
    const result = composeMessage(input, {});
    expect(result).toContain('Co-Authored-By: Claude Martin <claude.martin@example.com>');
  });

  it('does not treat body prose as a trailer block when it is not the trailing key:value paragraph', () => {
    const input = 'feat: x\n\nNote: this line looks like a trailer but is body prose.\n\nMore prose here.';
    const result = composeMessage(input, { 'PitWay-Task': 'T001' });
    expect(result).toContain('Note: this line looks like a trailer but is body prose.');
    expect(result).toContain('More prose here.');
    expect(result).toContain('PitWay-Task: T001');
  });
});

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'pitway-commit-'));
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

describe('createCommit', () => {
  it('creates a commit from staged changes and returns its SHA', () => {
    writeFileSync(join(repo, 'a.txt'), 'x\n');
    git(['add', 'a.txt'], repo);
    const sha = createCommit(repo, 'feat: add a.txt\n\nPitWay-Task: T001\n');
    const head = git(['rev-parse', 'HEAD'], repo).trim();
    expect(sha).toBe(head);
  });

  it('refuses to create an empty commit', () => {
    expect(() => createCommit(repo, 'feat: nothing staged\n')).toThrowError(GitError);
    expect(() => createCommit(repo, 'feat: nothing staged\n')).toThrowError(/empty/i);
  });
});
