import { describe, expect, it } from 'vitest';
import { isAutoRunAuthorized } from '../../src/core/journal/auto-run.js';
import type { JournalRecord } from '../../src/state/journal.js';

const HASH_A = 'sha256:' + 'a'.repeat(64);
const HASH_B = 'sha256:' + 'b'.repeat(64);

function enable(milestone: string, hash: string): JournalRecord {
  return { kind: 'auto_run', milestone, action: 'enable', hash };
}

function disable(milestone: string): JournalRecord {
  return { kind: 'auto_run', milestone, action: 'disable' };
}

function amendmentEntry(
  milestone: string,
  type: 'contract_amendment' | 'task_amendment',
): JournalRecord {
  return { kind: 'entry', milestone, type, operationId: `op-${type}`, payload: {} };
}

function usageEntry(milestone: string): JournalRecord {
  return { kind: 'entry', milestone, type: 'usage_recording', operationId: 'op-usage', payload: {} };
}

function checkpoint(milestone: string, entryOperationId: string): JournalRecord {
  return { kind: 'checkpoint', milestone, entryOperationId, commitSha: 'deadbeef' };
}

describe('isAutoRunAuthorized (pure)', () => {
  it('is not authorized, reason "never enabled", when no auto_run record exists for the milestone', () => {
    expect(isAutoRunAuthorized([], 'M005', HASH_A)).toEqual({
      authorized: false,
      reason: 'never enabled',
    });
  });

  it('is authorized when the latest record is enable and the hash matches, with no amendment since', () => {
    const records = [enable('M005', HASH_A)];
    expect(isAutoRunAuthorized(records, 'M005', HASH_A)).toEqual({
      authorized: true,
      reason: null,
    });
  });

  it('is not authorized, reason "explicitly disabled", when the latest record is disable', () => {
    const records = [enable('M005', HASH_A), disable('M005')];
    expect(isAutoRunAuthorized(records, 'M005', HASH_A)).toEqual({
      authorized: false,
      reason: 'explicitly disabled',
    });
  });

  it('re-enabling after a disable is authorized again against the new hash', () => {
    const records = [enable('M005', HASH_A), disable('M005'), enable('M005', HASH_B)];
    expect(isAutoRunAuthorized(records, 'M005', HASH_B)).toEqual({
      authorized: true,
      reason: null,
    });
  });

  it('is not authorized, reason "hash changed since", when the current hash no longer matches the recorded one', () => {
    const records = [enable('M005', HASH_A)];
    expect(isAutoRunAuthorized(records, 'M005', HASH_B)).toEqual({
      authorized: false,
      reason: 'hash changed since',
    });
  });

  it('treats a null current hash (e.g. a not-yet-confirmed milestone) as a hash mismatch, never authorized', () => {
    const records = [enable('M005', HASH_A)];
    expect(isAutoRunAuthorized(records, 'M005', null)).toEqual({
      authorized: false,
      reason: 'hash changed since',
    });
  });

  it('is not authorized, reason "amendment recorded since", when a contract_amendment entry follows the enable record', () => {
    const records = [enable('M005', HASH_A), amendmentEntry('M005', 'contract_amendment')];
    expect(isAutoRunAuthorized(records, 'M005', HASH_A)).toEqual({
      authorized: false,
      reason: 'amendment recorded since',
    });
  });

  it('is not authorized, reason "amendment recorded since", when a task_amendment entry follows the enable record', () => {
    const records = [enable('M005', HASH_A), amendmentEntry('M005', 'task_amendment')];
    expect(isAutoRunAuthorized(records, 'M005', HASH_A)).toEqual({
      authorized: false,
      reason: 'amendment recorded since',
    });
  });

  it('an amendment recorded BEFORE the enable record does not invalidate it', () => {
    const records = [amendmentEntry('M005', 'contract_amendment'), enable('M005', HASH_A)];
    expect(isAutoRunAuthorized(records, 'M005', HASH_A)).toEqual({
      authorized: true,
      reason: null,
    });
  });

  it('an unrelated usage_recording entry after enable never invalidates authorization', () => {
    const records = [enable('M005', HASH_A), usageEntry('M005')];
    expect(isAutoRunAuthorized(records, 'M005', HASH_A)).toEqual({
      authorized: true,
      reason: null,
    });
  });

  it('a checkpoint marker after enable never invalidates authorization', () => {
    const records = [enable('M005', HASH_A), checkpoint('M005', 'op-usage')];
    expect(isAutoRunAuthorized(records, 'M005', HASH_A)).toEqual({
      authorized: true,
      reason: null,
    });
  });

  it('records for a different milestone never affect the queried milestone', () => {
    const records = [enable('M001', HASH_A), disable('M001'), amendmentEntry('M001', 'contract_amendment')];
    expect(isAutoRunAuthorized(records, 'M005', HASH_A)).toEqual({
      authorized: false,
      reason: 'never enabled',
    });
  });

  it('is pure: calling it twice with the same inputs returns equal results, and it accepts a plain in-memory array', () => {
    const records = [enable('M005', HASH_A)];
    const first = isAutoRunAuthorized(records, 'M005', HASH_A);
    const second = isAutoRunAuthorized(records, 'M005', HASH_A);
    expect(first).toEqual(second);
  });
});
