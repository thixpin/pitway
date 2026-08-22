import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canTransitionBacklogItem, transitionBacklogItem } from '../../src/core/backlog/state-machine.js';
import { listBacklogItems } from '../../src/core/backlog/list.js';
import { loadBacklog, saveBacklog } from '../../src/state/store.js';
import type { BacklogItem, BacklogStatus } from '../../src/state/schemas.js';

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
