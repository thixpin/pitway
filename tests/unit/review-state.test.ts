import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadReviews, saveReviews, StateStoreError } from '../../src/state/store.js';
import {
  reviewDecisionSchema,
  reviewFindingEntrySchema,
  reviewSessionSchema,
  reviewsFileSchema,
  type ReviewsFile,
} from '../../src/state/schemas.js';
import {
  assertKnownReviewRoles,
  computeReviewContentHash,
  deriveLatestFindingsByRole,
  isKnownReviewRole,
  REVIEW_ROLES,
  ReviewRoleError,
} from '../../src/core/reviews/roles.js';
import type { Task } from '../../src/state/schemas.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pitway-review-state-'));
  mkdirSync(join(root, '.pitway', 'milestones', 'M001'), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const HASH = 'sha256:' + 'a'.repeat(64);

const sessionFixture: ReviewsFile = {
  schema_version: 1,
  sessions: [
    {
      id: 'rev-abc123',
      status: 'open',
      created_at: '2026-08-20T00:00:00Z',
      roles: ['developer', 'architect'],
      content_hash: HASH,
      findings: [],
      decision: null,
    },
  ],
};

describe('reviewsFileSchema round-trips (loadReviews/saveReviews)', () => {
  it('round-trips a reviews.yaml file that already exists', () => {
    saveReviews(root, 'M001', sessionFixture);
    expect(loadReviews(root, 'M001')).toEqual(sessionFixture);
  });

  it('loads an absent reviews.yaml as an empty, schema-valid store -- never created by milestone-add', () => {
    expect(loadReviews(root, 'M001')).toEqual({ schema_version: 1, sessions: [] });
  });

  it('refuses to save an invalid reviews.yaml', () => {
    expect(() =>
      saveReviews(root, 'M001', {
        schema_version: 1,
        // @ts-expect-error deliberately invalid session shape
        sessions: [{ id: 'bad-id' }],
      }),
    ).toThrowError(StateStoreError);
  });

  it('a malformed on-disk file still fails visibly, distinct from the absent-file tolerance', () => {
    const path = join(root, '.pitway', 'milestones', 'M001', 'reviews.yaml');
    writeFileSync(path, ': not valid yaml: [');
    expect(() => loadReviews(root, 'M001')).toThrowError(StateStoreError);
  });
});

describe('review finding-entry schema (AC001 caps)', () => {
  it('accepts a well-formed finding entry', () => {
    const result = reviewFindingEntrySchema.safeParse({
      severity: 'major',
      finding: 'The write_scope for T004 omits a file it clearly writes.',
      targets: ['T004'],
      recommendation: 'Add src/core/reviews/brief.ts to write_scope.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a finding text over the 1000-char cap', () => {
    const result = reviewFindingEntrySchema.safeParse({
      severity: 'minor',
      finding: 'x'.repeat(1001),
      recommendation: 'trim it',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a recommendation over the 300-char cap', () => {
    const result = reviewFindingEntrySchema.safeParse({
      severity: 'minor',
      finding: 'fine',
      recommendation: 'x'.repeat(301),
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional conflicts_with role ids and rejects a non-kebab-case one', () => {
    expect(
      reviewFindingEntrySchema.safeParse({
        severity: 'blocker',
        finding: 'Disagrees with the architect finding on layering.',
        recommendation: 'Reconcile before deciding.',
        conflicts_with: ['architect'],
      }).success,
    ).toBe(true);
    expect(
      reviewFindingEntrySchema.safeParse({
        severity: 'blocker',
        finding: 'x',
        recommendation: 'y',
        conflicts_with: ['Not_Kebab'],
      }).success,
    ).toBe(false);
  });
});

describe('review session schema shape', () => {
  it('round-trips a full session including a findings snapshot and decision', () => {
    const session = {
      id: 'rev-deadbeef',
      status: 'decided' as const,
      created_at: '2026-08-20T00:00:00Z',
      roles: ['developer'],
      content_hash: HASH,
      findings: [
        {
          role: 'developer',
          recorded_at: '2026-08-20T01:00:00Z',
          findings: [
            {
              severity: 'minor' as const,
              finding: 'Small naming nit.',
              recommendation: 'Rename for clarity.',
            },
          ],
        },
      ],
      decision: {
        outcome: 'accepted' as const,
        decided_at: '2026-08-20T02:00:00Z',
      },
    };
    const result = reviewSessionSchema.safeParse(session);
    expect(result.success).toBe(true);
  });

  it('rejects an unknown status value', () => {
    expect(
      reviewSessionSchema.safeParse({
        id: 'rev-1',
        status: 'racing',
        created_at: '2026-08-20T00:00:00Z',
        roles: ['developer'],
        content_hash: HASH,
        findings: [],
        decision: null,
      }).success,
    ).toBe(false);
  });

  it('rejects a session id not matching rev-<hex>', () => {
    expect(
      reviewSessionSchema.safeParse({
        id: 'session-1',
        status: 'open',
        created_at: '2026-08-20T00:00:00Z',
        roles: ['developer'],
        content_hash: HASH,
        findings: [],
        decision: null,
      }).success,
    ).toBe(false);
  });
});

describe('decision shape (AC007)', () => {
  it('accepts each outcome with and without an optional note', () => {
    for (const outcome of ['accepted', 'revision_requested', 'rejected'] as const) {
      expect(
        reviewDecisionSchema.safeParse({ outcome, decided_at: '2026-08-20T00:00:00Z' }).success,
      ).toBe(true);
      expect(
        reviewDecisionSchema.safeParse({
          outcome,
          note: 'reason',
          decided_at: '2026-08-20T00:00:00Z',
        }).success,
      ).toBe(true);
    }
  });

  it('rejects an unknown outcome and a note over the 300-char cap', () => {
    expect(
      reviewDecisionSchema.safeParse({ outcome: 'maybe', decided_at: '2026-08-20T00:00:00Z' }).success,
    ).toBe(false);
    expect(
      reviewDecisionSchema.safeParse({
        outcome: 'accepted',
        note: 'x'.repeat(301),
        decided_at: '2026-08-20T00:00:00Z',
      }).success,
    ).toBe(false);
  });
});

describe('reviewsFileSchema', () => {
  it('rejects an unknown top-level field (strictObject)', () => {
    const result = reviewsFileSchema.safeParse({ ...sessionFixture, extra: true });
    expect(result.success).toBe(false);
  });
});

describe('review role registry', () => {
  it('registers exactly nine roles with unique, kebab-case ids', () => {
    expect(REVIEW_ROLES).toHaveLength(9);
    const ids = REVIEW_ROLES.map((r) => r.id);
    expect(new Set(ids).size).toBe(9);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
    expect(ids).toEqual([
      'developer',
      'architect',
      'devops',
      'qa',
      'product',
      'business',
      'business-analyst',
      'ui-ux',
      'user',
    ]);
  });

  it('every role carries a non-empty focus text', () => {
    for (const role of REVIEW_ROLES) {
      expect(role.focus.length).toBeGreaterThan(0);
    }
  });

  it('isKnownReviewRole distinguishes registered from unregistered ids', () => {
    expect(isKnownReviewRole('developer')).toBe(true);
    expect(isKnownReviewRole('astronaut')).toBe(false);
  });

  it('assertKnownReviewRoles passes for all-registered ids', () => {
    expect(() => assertKnownReviewRoles(['developer', 'qa'])).not.toThrow();
  });

  it('unknown-role rejection: assertKnownReviewRoles throws naming every unregistered id', () => {
    expect(() => assertKnownReviewRoles(['developer', 'astronaut', 'wizard'])).toThrowError(
      ReviewRoleError,
    );
    try {
      assertKnownReviewRoles(['developer', 'astronaut', 'wizard']);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain('astronaut');
      expect((error as Error).message).toContain('wizard');
      expect((error as Error).message).not.toContain('developer');
    }
  });
});

describe('newest-per-role derivation (deriveLatestFindingsByRole)', () => {
  it('keeps only the newest snapshot per role, preserving append order elsewhere', () => {
    const snapshots = [
      { role: 'developer', recorded_at: '2026-08-20T01:00:00Z', findings: [] },
      { role: 'architect', recorded_at: '2026-08-20T01:00:00Z', findings: [] },
      {
        role: 'developer',
        recorded_at: '2026-08-20T02:00:00Z',
        findings: [
          { severity: 'minor' as const, finding: 'later snapshot', recommendation: 'x' },
        ],
      },
    ];
    const latest = deriveLatestFindingsByRole(snapshots);
    expect(latest.size).toBe(2);
    expect(latest.get('developer')?.recorded_at).toBe('2026-08-20T02:00:00Z');
    expect(latest.get('architect')?.recorded_at).toBe('2026-08-20T01:00:00Z');
  });

  it('handles duplicate role entries at the same timestamp by taking the later one in append order (last write wins)', () => {
    const snapshots = [
      { role: 'developer', recorded_at: '2026-08-20T01:00:00Z', findings: [] },
      {
        role: 'developer',
        recorded_at: '2026-08-20T01:00:00Z',
        findings: [{ severity: 'blocker' as const, finding: 're-recorded', recommendation: 'x' }],
      },
    ];
    const latest = deriveLatestFindingsByRole(snapshots);
    expect(latest.size).toBe(1);
    expect(latest.get('developer')?.findings[0]?.finding).toBe('re-recorded');
  });

  it('returns an empty map for an empty findings array', () => {
    expect(deriveLatestFindingsByRole([]).size).toBe(0);
  });
});

describe('computeReviewContentHash (AC001)', () => {
  const baseTask: Task = {
    id: 'T001',
    objective: 'Do the thing',
    status: 'ready',
    depends_on: [],
    acceptance_criteria: ['AC001'],
    write_scope: ['src/a.ts'],
    context_files: ['src/a.ts'],
    verification: { strategy: 'tdd', detail: 'npm test -- a.test.ts' },
    result: null,
    usage: null,
  };
  const baseContract = {
    frontmatter: {
      schema_version: 1 as const,
      id: 'M001',
      title: 'Example milestone',
      status: 'draft' as const,
      requirement: null,
      confirmed_at: null,
      verification_approved_hash: null,
      acceptance_criteria: [{ id: 'AC001', text: 'Behavior holds.' }],
      verification: [
        { id: 'CT001', criterion: 'AC001', type: 'manual' as const, instruction: 'Check it.' },
      ],
    },
    body: 'body\n',
  };

  it('is deterministic for the same inputs', () => {
    const a = computeReviewContentHash(baseContract, [baseTask]);
    const b = computeReviewContentHash(baseContract, [baseTask]);
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('changes when the contract body changes', () => {
    const a = computeReviewContentHash(baseContract, [baseTask]);
    const b = computeReviewContentHash({ ...baseContract, body: 'other body\n' }, [baseTask]);
    expect(a).not.toBe(b);
  });

  it('changes when a contract CONTENT field changes (title)', () => {
    const a = computeReviewContentHash(baseContract, [baseTask]);
    const b = computeReviewContentHash(
      { ...baseContract, frontmatter: { ...baseContract.frontmatter, title: 'Renamed' } },
      [baseTask],
    );
    expect(a).not.toBe(b);
  });

  it('changes when a task DEFINITION field changes (objective)', () => {
    const a = computeReviewContentHash(baseContract, [baseTask]);
    const b = computeReviewContentHash(baseContract, [{ ...baseTask, objective: 'Do a different thing' }]);
    expect(a).not.toBe(b);
  });

  it('does NOT change when only status/attempts/result/usage change (execution telemetry excluded)', () => {
    const a = computeReviewContentHash(baseContract, [baseTask]);
    const executed: Task = {
      ...baseTask,
      status: 'completed',
      attempts: 2,
      result: { summary: 'done', evidence: 'tests pass' },
      usage: { total_tokens: 42 },
    };
    const b = computeReviewContentHash(baseContract, [executed]);
    expect(a).toBe(b);
  });

  it('does NOT change when only the contract\'s own execution/lifecycle fields change (confirm never stales a session)', () => {
    const a = computeReviewContentHash(baseContract, [baseTask]);
    const confirmed = {
      ...baseContract,
      frontmatter: {
        ...baseContract.frontmatter,
        status: 'in_progress' as const,
        confirmed_at: '2026-08-21T00:00:00Z',
        verification_approved_hash: 'sha256:' + 'a'.repeat(64),
        base_branch: 'pitway/M001-example',
        base_revision: 'deadbeef',
      },
    };
    const b = computeReviewContentHash(confirmed, [baseTask]);
    expect(a).toBe(b);
  });
});
