import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canTransitionBacklogItem, transitionBacklogItem } from '../../src/core/backlog/state-machine.js';
import { listBacklogItems } from '../../src/core/backlog/list.js';
import { loadBacklog, saveBacklog } from '../../src/state/store.js';
import type { BacklogItem, BacklogStatus } from '../../src/state/schemas.js';
import {
  appendBacklogAddUnscopedRecord,
  appendJournalEntry,
  JournalError,
  readJournal,
} from '../../src/state/journal.js';
import { derivePending } from '../../src/core/journal/operations.js';

const ALL_STATUSES: BacklogStatus[] = ['pending', 'promoted', 'archived'];

const LEGAL: Array<[BacklogStatus, BacklogStatus]> = [
  ['pending', 'promoted'],
  ['pending', 'archived'],
];

describe('backlog item state machine (M018/T002)', () => {
  it.each(LEGAL)('allows %s -> %s', (from, to) => {
    expect(canTransitionBacklogItem(from, to)).toBe(true);
    expect(transitionBacklogItem(from, to)).toBe(to);
  });

  const legalSet = new Set(LEGAL.map(([from, to]) => `${from}->${to}`));
  const illegal: Array<[BacklogStatus, BacklogStatus]> = [];
  for (const from of ALL_STATUSES) {
    for (const to of ALL_STATUSES) {
      if (from === to) continue;
      if (!legalSet.has(`${from}->${to}`)) illegal.push([from, to]);
    }
  }

  it.each(illegal)('rejects %s -> %s (both promoted/archived are terminal)', (from, to) => {
    expect(canTransitionBacklogItem(from, to)).toBe(false);
    expect(() => transitionBacklogItem(from, to)).toThrowError(/allowed/);
  });

  it('error message names the allowed target states', () => {
    expect(() => transitionBacklogItem('promoted', 'archived')).toThrowError(/promoted/);
  });

  it('error message reports "(none — terminal state)" for a terminal status', () => {
    expect(() => transitionBacklogItem('archived', 'pending')).toThrowError(/terminal state/);
  });

  it('rejects a self-transition from pending, naming the real allowed targets (not the terminal text)', () => {
    expect(canTransitionBacklogItem('pending', 'pending')).toBe(false);
    expect(() => transitionBacklogItem('pending', 'pending')).toThrowError(
      /allowed target states: promoted, archived/,
    );
  });
});

// M025/T008 (AC010): listBacklogItems filters over source.milestone / source.task, combinable.
describe('backlog list filters core (M025/T008)', () => {
  let root: string;

  function makeItem(overrides: Partial<BacklogItem> & { id: string }): BacklogItem {
    const now = new Date().toISOString();
    const base: BacklogItem = {
      id: 'B000',
      title: 'T',
      reason: 'R',
      status: 'pending',
      source: { milestone: 'M001', task: null },
      created_at: now,
      resolved_at: null,
      promoted_to: null,
      archived_reason: null,
    };
    const merged = { ...base, ...overrides } as BacklogItem;
    // Fill required fields for terminal states so schema validation passes
    if (merged.status === 'archived') {
      if (merged.resolved_at === null) merged.resolved_at = now;
      if (merged.archived_reason === null) merged.archived_reason = 'archived';
      merged.promoted_to = null;
    } else if (merged.status === 'promoted') {
      if (merged.resolved_at === null) merged.resolved_at = now;
      if (merged.promoted_to === null) merged.promoted_to = { milestone: 'M001', task: 'T001' };
      merged.archived_reason = null;
    } else {
      merged.resolved_at = null;
      merged.promoted_to = null;
      merged.archived_reason = null;
    }
    return merged;
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pitway-backlog-state-'));
    mkdirSync(join(root, '.pitway'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function seed(items: BacklogItem[]): void {
    saveBacklog(root, { schema_version: 1, items });
  }

  it('returns all items with no filters', () => {
    seed([makeItem({ id: 'B001' }), makeItem({ id: 'B002', source: { milestone: 'M002', task: null } })]);
    expect(listBacklogItems(root).map((i) => i.id)).toEqual(['B001', 'B002']);
  });

  it('filters by milestone alone', () => {
    seed([
      makeItem({ id: 'B001', source: { milestone: 'M001', task: null } }),
      makeItem({ id: 'B002', source: { milestone: 'M002', task: null } }),
    ]);
    expect(listBacklogItems(root, { milestone: 'M002' }).map((i) => i.id)).toEqual(['B002']);
    // positional overload still works (backward compat)
    expect(listBacklogItems(root, undefined, 'M002').map((i) => i.id)).toEqual(['B002']);
  });

  it('filters by task alone', () => {
    seed([
      makeItem({ id: 'B001', source: { milestone: 'M001', task: null } }),
      makeItem({ id: 'B002', source: { milestone: 'M001', task: 'T001' } }),
    ]);
    expect(listBacklogItems(root, { task: 'T001' }).map((i) => i.id)).toEqual(['B002']);
    expect(listBacklogItems(root, undefined, undefined, 'T001').map((i) => i.id)).toEqual(['B002']);
  });

  it('filters combine: status + milestone + task (AND, including empty)', () => {
    seed([
      makeItem({ id: 'B001', status: 'pending', source: { milestone: 'M001', task: null } }),
      makeItem({ id: 'B002', status: 'archived', source: { milestone: 'M001', task: null } }),
      makeItem({ id: 'B003', status: 'pending', source: { milestone: 'M002', task: null } }),
      makeItem({ id: 'B004', status: 'pending', source: { milestone: 'M001', task: 'T001' } }),
    ]);
    expect(listBacklogItems(root, { status: 'pending', milestone: 'M001' }).map((i) => i.id)).toEqual([
      'B001',
      'B004',
    ]);
    expect(
      listBacklogItems(root, { status: 'pending', milestone: 'M001', task: 'T001' }).map((i) => i.id),
    ).toEqual(['B004']);
    // no-match empty: well-formed but nonexistent
    expect(listBacklogItems(root, { milestone: 'M999' })).toEqual([]);
    expect(listBacklogItems(root, { status: 'pending', milestone: 'M999' })).toEqual([]);
    expect(listBacklogItems(root, { task: 'T999' })).toEqual([]);
  });

  it('status filter still works alone (positional and object)', () => {
    seed([
      makeItem({ id: 'B001', status: 'pending', source: { milestone: 'M001', task: null } }),
      makeItem({ id: 'B002', status: 'archived', source: { milestone: 'M001', task: null } }),
    ]);
    expect(listBacklogItems(root, 'pending').map((i) => i.id)).toEqual(['B001']);
    expect(listBacklogItems(root, { status: 'archived' }).map((i) => i.id)).toEqual(['B002']);
  });

  it('read-only: list never writes backlog.yaml or journal', () => {
    seed([makeItem({ id: 'B001' })]);
    const before = loadBacklog(root).items.length;
    listBacklogItems(root, { milestone: 'M001' });
    listBacklogItems(root, { task: 'T001' });
    listBacklogItems(root, { status: 'pending', milestone: 'M001', task: 'T001' });
    expect(loadBacklog(root).items).toHaveLength(before);
  });
});

// T002: backlog_add_unscoped -- a new sibling journal record kind, no
// milestone field, appended by `backlog add` when no milestone is active
// (mirrors backlog_archive's own no-milestone-field precedent). Exercised
// directly against src/state/journal.ts, the same tier as this file's
// existing state-machine/list coverage.
describe('backlog_add_unscoped journal record (T002)', () => {
  let root: string;

  const baseRecord = {
    id: 'bau-1',
    target: 'B001',
    title: 'Discovered mid-task',
    reason: 'Out of scope, no active milestone.',
    sourceMilestone: null as string | null,
    sourceTask: null as string | null,
    at: '2026-08-25T00:00:00Z',
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pitway-backlog-journal-'));
    // resolvePitwayJournalPath resolves the journal path via git -- a real
    // (even if minimal) repo is required, mirroring tests/unit/journal.test.ts's
    // own setup for the same reason.
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
    writeFileSync(join(root, 'README.md'), 'hello\n');
    execFileSync('git', ['add', 'README.md'], { cwd: root });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: root });
    mkdirSync(join(root, '.pitway'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('appends a backlog_add_unscoped record and reads it back', () => {
    const record = appendBacklogAddUnscopedRecord(root, baseRecord);
    expect(record.kind).toBe('backlog_add_unscoped');
    const all = readJournal(root);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      kind: 'backlog_add_unscoped',
      id: 'bau-1',
      target: 'B001',
      title: 'Discovered mid-task',
      reason: 'Out of scope, no active milestone.',
      sourceMilestone: null,
      sourceTask: null,
    });
  });

  it('carries no milestone field, like backlog_archive', () => {
    const record = appendBacklogAddUnscopedRecord(root, baseRecord);
    expect(record).not.toHaveProperty('milestone');
  });

  it('is excluded from derivePending like every other sibling record kind', () => {
    appendBacklogAddUnscopedRecord(root, baseRecord);
    appendJournalEntry(root, {
      milestone: 'M001',
      type: 'usage_recording',
      operationId: 'op-1',
      payload: {},
    });
    const pending = derivePending(readJournal(root));
    expect(pending).toHaveLength(1);
    expect(pending[0]?.operationId).toBe('op-1');
  });

  it('rejects a record missing required fields, appending nothing', () => {
    expect(() =>
      appendBacklogAddUnscopedRecord(root, {
        ...baseRecord,
        // Runtime-invalid: empty target.
        target: '',
      }),
    ).toThrow(JournalError);
    expect(readJournal(root)).toHaveLength(0);
  });

  it('allows an explicit sourceMilestone/sourceTask (no active milestone, but --milestone/--task given)', () => {
    const record = appendBacklogAddUnscopedRecord(root, {
      ...baseRecord,
      sourceMilestone: 'M002',
      sourceTask: 'T001',
    });
    expect(record.sourceMilestone).toBe('M002');
    expect(record.sourceTask).toBe('T001');
  });
});
