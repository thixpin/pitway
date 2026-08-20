import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { allChecksPassed, computeLatestCheckResults } from '../../src/core/verification/status.js';
import { createMilestoneDir, saveVerificationResults } from '../../src/state/store.js';
import type { ContractFile } from '../../src/state/contract-file.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pitway-verification-status-'));
  createMilestoneDir(root, 'M001', 'Fixture milestone');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function contractWithChecks(checkIds: string[]): ContractFile {
  return {
    frontmatter: {
      schema_version: 1,
      id: 'M001',
      title: 'Fixture milestone',
      status: 'confirmed',
      requirement: null,
      confirmed_at: '2026-08-20T00:00:00Z',
      verification_approved_hash: null,
      acceptance_criteria: [{ id: 'AC001', text: 'x' }],
      verification: checkIds.map((id) => ({
        id,
        criterion: 'AC001',
        type: 'command' as const,
        command: 'echo ok',
      })),
    },
    body: '',
  };
}

describe('computeLatestCheckResults (M013/T001/AC008)', () => {
  it('returns the latest recorded status per check, later entries winning', () => {
    saveVerificationResults(root, 'M001', {
      schema_version: 1,
      results: [
        { check: 'CT001', status: 'fail', at: '2026-08-20T00:00:00Z', evidence: 'x', recorded_by: 'command' },
        { check: 'CT001', status: 'pass', at: '2026-08-20T00:01:00Z', evidence: 'y', recorded_by: 'command' },
        { check: 'CT002', status: 'pass', at: '2026-08-20T00:02:00Z', evidence: 'z', recorded_by: 'developer' },
      ],
    });
    const latest = computeLatestCheckResults(root, 'M001');
    expect(latest.get('CT001')).toBe('pass');
    expect(latest.get('CT002')).toBe('pass');
    expect(latest.has('CT003')).toBe(false);
  });

  it('returns an empty map when no results have been recorded yet', () => {
    saveVerificationResults(root, 'M001', { schema_version: 1, results: [] });
    expect(computeLatestCheckResults(root, 'M001').size).toBe(0);
  });
});

describe('allChecksPassed (M013/T001/AC008)', () => {
  it('is true only when every declared check has a latest result of pass', () => {
    const contract = contractWithChecks(['CT001', 'CT002']);
    saveVerificationResults(root, 'M001', {
      schema_version: 1,
      results: [
        { check: 'CT001', status: 'pass', at: '2026-08-20T00:00:00Z', evidence: 'x', recorded_by: 'command' },
        { check: 'CT002', status: 'pass', at: '2026-08-20T00:00:00Z', evidence: 'x', recorded_by: 'command' },
      ],
    });
    expect(allChecksPassed(contract, computeLatestCheckResults(root, 'M001'))).toBe(true);
  });

  it('is false when a declared check has no recorded result at all', () => {
    const contract = contractWithChecks(['CT001', 'CT002']);
    saveVerificationResults(root, 'M001', {
      schema_version: 1,
      results: [
        { check: 'CT001', status: 'pass', at: '2026-08-20T00:00:00Z', evidence: 'x', recorded_by: 'command' },
      ],
    });
    expect(allChecksPassed(contract, computeLatestCheckResults(root, 'M001'))).toBe(false);
  });

  it('is false when a declared check has fail as its latest result', () => {
    const contract = contractWithChecks(['CT001', 'CT002']);
    saveVerificationResults(root, 'M001', {
      schema_version: 1,
      results: [
        { check: 'CT001', status: 'pass', at: '2026-08-20T00:00:00Z', evidence: 'x', recorded_by: 'command' },
        { check: 'CT002', status: 'fail', at: '2026-08-20T00:00:00Z', evidence: 'x', recorded_by: 'command' },
        { check: 'CT002', status: 'pass', at: '2026-08-20T00:01:00Z', evidence: 'x', recorded_by: 'command' },
        { check: 'CT002', status: 'fail', at: '2026-08-20T00:02:00Z', evidence: 'x', recorded_by: 'command' },
      ],
    });
    expect(allChecksPassed(contract, computeLatestCheckResults(root, 'M001'))).toBe(false);
  });
});
