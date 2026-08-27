import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolvePendingJournalTargets } from '../../src/core/journal/pending-targets.js';
import { appendCheckpointMarker, appendJournalEntry } from '../../src/state/journal.js';

// M038/T002 (AC005, AC006): the Core helper that replaced the journal-reading
// branch inside src/git/safety.ts's classifyDirtyPaths. Same scenarios that
// branch used to cover, now proven at the helper: the result is what
// callers pass to classifyDirtyPaths as `journalTargetPaths`.

let repo: string;

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function milestoneDir(id: string): string {
  const dir = join(repo, '.pitway', 'milestones', id);
  mkdirSync(dir, { recursive: true });
  return dir;
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'pitway-pending-targets-'));
  git(['init', '-q'], repo);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('resolvePendingJournalTargets', () => {
  it('returns [] when the journal has no entries at all', () => {
    milestoneDir('M005');
    expect(resolvePendingJournalTargets(repo, 'M005')).toEqual([]);
  });

  it('maps a pending entry for the milestone to its repo-relative target file', () => {
    milestoneDir('M005');
    appendJournalEntry(repo, {
      milestone: 'M005',
      type: 'usage_recording',
      operationId: 'op-usage-1',
      payload: { total_tokens: 10 },
    });
    expect(resolvePendingJournalTargets(repo, 'M005')).toEqual(['.pitway/milestones/M005/usage.yaml']);
  });

  it('resolves a slugged milestone directory name, not just the bare id', () => {
    milestoneDir('M005-some-title');
    appendJournalEntry(repo, {
      milestone: 'M005',
      type: 'contract_amendment',
      operationId: 'op-amend-1',
      payload: {},
    });
    expect(resolvePendingJournalTargets(repo, 'M005')).toEqual([
      '.pitway/milestones/M005-some-title/contract.md',
    ]);
  });

  it('excludes an entry that has already been checkpointed', () => {
    milestoneDir('M005');
    appendJournalEntry(repo, {
      milestone: 'M005',
      type: 'usage_recording',
      operationId: 'op-usage-2',
      payload: { total_tokens: 10 },
    });
    appendCheckpointMarker(repo, 'M005', 'op-usage-2', 'deadbeef');
    expect(resolvePendingJournalTargets(repo, 'M005')).toEqual([]);
  });

  it('excludes a pending entry that belongs to a different milestone', () => {
    milestoneDir('M005');
    milestoneDir('M006');
    appendJournalEntry(repo, {
      milestone: 'M005',
      type: 'usage_recording',
      operationId: 'op-usage-3',
      payload: { total_tokens: 10 },
    });
    expect(resolvePendingJournalTargets(repo, 'M006')).toEqual([]);
  });

  it('maps a backlog_recording entry to the root-level .pitway/backlog.yaml', () => {
    milestoneDir('M018');
    writeFileSync(join(repo, '.pitway', 'backlog.yaml'), 'schema_version: 1\nitems: []\n');
    appendJournalEntry(repo, {
      milestone: 'M018',
      type: 'backlog_recording',
      operationId: 'op-backlog-1',
      payload: {},
    });
    expect(resolvePendingJournalTargets(repo, 'M018')).toEqual(['.pitway/backlog.yaml']);
  });

  it('returns [] without throwing when the milestone directory cannot be resolved', () => {
    // A pending entry exists, but no .pitway/milestones/M007* directory
    // does -- the old safety.ts branch swallowed this and classified
    // nothing expected; the helper preserves exactly that.
    mkdirSync(join(repo, '.pitway', 'milestones'), { recursive: true });
    appendJournalEntry(repo, {
      milestone: 'M007',
      type: 'usage_recording',
      operationId: 'op-usage-4',
      payload: { total_tokens: 1 },
    });
    expect(() => resolvePendingJournalTargets(repo, 'M007')).not.toThrow();
    expect(resolvePendingJournalTargets(repo, 'M007')).toEqual([]);
  });

  it('deduplicates two pending entries that target the same file', () => {
    milestoneDir('M005');
    for (const operationId of ['op-usage-5', 'op-usage-6']) {
      appendJournalEntry(repo, {
        milestone: 'M005',
        type: 'usage_recording',
        operationId,
        payload: { total_tokens: 1 },
      });
    }
    expect(resolvePendingJournalTargets(repo, 'M005')).toEqual(['.pitway/milestones/M005/usage.yaml']);
  });
});
