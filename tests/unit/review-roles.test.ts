import { describe, expect, it } from 'vitest';
import {
  assertKnownReviewRoles,
  computeReviewContentHash,
  computeReviewUsageTotal,
  deriveLatestFindingsByRole,
  getReviewRole,
  isKnownReviewRole,
  REVIEW_ROLES,
  ReviewRoleError,
} from '../../src/core/reviews/roles.js';
import type { ContractFrontmatter, ReviewFindingsSnapshot, ReviewsFile, Task } from '../../src/state/schemas.js';

// Snapshot of focus values as they existed before T004 (AC014's own
// requirement: focus is never edited by this task). This is the diff target
// proving focus stayed byte-for-byte unchanged.
const ORIGINAL_FOCUS: Record<string, string> = {
  developer:
    'task granularity, implementation feasibility, write_scope accuracy, testability, implementation edge cases',
  architect: 'layering, dependencies, invariants, state/concurrency, design consistency, agent-agnosticism',
  devops:
    'CI/CD, Git/branching, deployment, rollback, infrastructure, observability, operational safety, failure recovery, permissions, automation and release risk',
  qa: 'test strategy and tier coverage, verification-check quality and AC-to-check mapping, edge/failure/regression cases, evidence quality',
  product: 'requirement coverage, scope, acceptance criteria, product behavior',
  business: 'business value, operational impact, cost, risk and priority',
  'business-analyst':
    'requirement elicitation and traceability, acceptance-criteria completeness/testability/measurability, requirement-to-contract scope alignment, process fit',
  'ui-ux':
    "interface and interaction design of the delivered surfaces -- for PitWay's CLI: command ergonomics, output readability and consistency, terminology, error-message clarity and actionability",
  user: 'usability, clarity, workflow experience and user-facing behavior',
};

const ORIGINAL_IDS = [
  'developer',
  'architect',
  'devops',
  'qa',
  'product',
  'business',
  'business-analyst',
  'ui-ux',
  'user',
];

describe('REVIEW_ROLES label field (AC014)', () => {
  it('keeps the 9 role ids unchanged -- no role added, removed, or renamed', () => {
    expect(REVIEW_ROLES.map((role) => role.id)).toEqual(ORIGINAL_IDS);
  });

  it('leaves every focus value byte-for-byte unchanged', () => {
    for (const role of REVIEW_ROLES) {
      expect(role.focus).toBe(ORIGINAL_FOCUS[role.id]);
    }
  });

  it('gives every role a label field, 3-8 words, distinct from its focus', () => {
    for (const role of REVIEW_ROLES) {
      expect(typeof role.label).toBe('string');
      expect(role.label.length).toBeGreaterThan(0);
      const wordCount = role.label.trim().split(/\s+/).length;
      expect(wordCount).toBeGreaterThanOrEqual(3);
      expect(wordCount).toBeLessThanOrEqual(8);
      expect(role.label).not.toBe(role.focus);
    }
  });
});

describe('registry lookups', () => {
  it('isKnownReviewRole answers for registered and unregistered ids', () => {
    expect(isKnownReviewRole('qa')).toBe(true);
    expect(isKnownReviewRole('racing-engineer')).toBe(false);
  });

  it('getReviewRole returns the registry entry, or undefined for an unknown id', () => {
    expect(getReviewRole('architect')?.label).toBe('System design & architecture');
    expect(getReviewRole('nobody')).toBeUndefined();
  });

  it('assertKnownReviewRoles passes silently on all-known ids', () => {
    expect(() => assertKnownReviewRoles(['developer', 'qa'])).not.toThrow();
  });

  it('assertKnownReviewRoles names every unknown id in a ReviewRoleError', () => {
    expect(() => assertKnownReviewRoles(['qa', 'ghost', 'phantom'])).toThrowError(ReviewRoleError);
    expect(() => assertKnownReviewRoles(['qa', 'ghost', 'phantom'])).toThrowError(
      /unknown review role\(s\): ghost, phantom/,
    );
  });
});

describe('deriveLatestFindingsByRole', () => {
  const snapshot = (role: string, at: string): ReviewFindingsSnapshot =>
    ({ role, recorded_at: at, findings: [] }) as ReviewFindingsSnapshot;

  it('keeps the latest snapshot per role while preserving first-seen key order', () => {
    const latest = deriveLatestFindingsByRole([
      snapshot('qa', '2026-08-20T00:00:00Z'),
      snapshot('developer', '2026-08-20T01:00:00Z'),
      snapshot('qa', '2026-08-20T02:00:00Z'),
    ]);
    expect([...latest.keys()]).toEqual(['qa', 'developer']);
    expect(latest.get('qa')?.recorded_at).toBe('2026-08-20T02:00:00Z');
  });

  it('returns an empty map for no findings', () => {
    expect(deriveLatestFindingsByRole([]).size).toBe(0);
  });
});

describe('computeReviewUsageTotal (B026)', () => {
  const session = (
    id: string,
    findings: ReviewFindingsSnapshot[],
  ): ReviewsFile['sessions'][number] => ({
    id: id as `rev-${string}`,
    status: 'decided',
    created_at: '2026-08-24T00:00:00Z',
    roles: findings.map((f) => f.role),
    content_hash: `sha256:${'a'.repeat(64)}` as `sha256:${string}`,
    findings,
    decision: { outcome: 'accepted', decided_at: '2026-08-24T01:00:00Z' },
  });

  it('returns null/0 for a milestone with no review sessions at all', () => {
    expect(computeReviewUsageTotal({ schema_version: 1, sessions: [] })).toEqual({
      total: null,
      missing: 0,
    });
  });

  it('sums measured usage and counts an un-recorded role as missing, never estimating', () => {
    const reviews: ReviewsFile = {
      schema_version: 1,
      sessions: [
        session('rev-a', [
          { role: 'developer', recorded_at: '2026-08-24T00:00:00Z', findings: [], usage: { total_tokens: 300 } },
          { role: 'architect', recorded_at: '2026-08-24T00:00:00Z', findings: [], usage: null },
        ]),
      ],
    };
    expect(computeReviewUsageTotal(reviews)).toEqual({ total: 300, missing: 1 });
  });

  it('sums across multiple sessions and dedupes a superseded snapshot within one session', () => {
    const reviews: ReviewsFile = {
      schema_version: 1,
      sessions: [
        session('rev-a', [
          { role: 'developer', recorded_at: '2026-08-24T00:00:00Z', findings: [], usage: { total_tokens: 100 } },
          // Superseded within this same session -- only the later one counts.
          { role: 'developer', recorded_at: '2026-08-24T01:00:00Z', findings: [], usage: { total_tokens: 250 } },
        ]),
        session('rev-b', [
          { role: 'qa', recorded_at: '2026-08-24T02:00:00Z', findings: [], usage: { total_tokens: 50 } },
        ]),
      ],
    };
    expect(computeReviewUsageTotal(reviews)).toEqual({ total: 300, missing: 0 });
  });
});

describe('computeReviewContentHash', () => {
  const frontmatter = (overrides: Partial<ContractFrontmatter> = {}): ContractFrontmatter =>
    ({
      schema_version: 1,
      id: 'M001',
      title: 'Reviewable milestone',
      status: 'in_progress',
      requirement: null,
      confirmed_at: '2026-08-20T00:00:00Z',
      verification_approved_hash: 'sha256:' + 'a'.repeat(64),
      acceptance_criteria: [{ id: 'AC001', text: 'Behavior holds.' }],
      verification: [
        { id: 'CT001', criterion: 'AC001', type: 'command', command: 'npm test' },
      ],
      ...overrides,
    }) as ContractFrontmatter;

  // A task carrying every optional definition field the projection covers.
  const fullTask: Task = {
    id: 'T001',
    name: 'Full task',
    objective: 'Do the full thing.',
    status: 'completed',
    depends_on: [],
    acceptance_criteria: ['It works'],
    context_files: ['src/a.ts'],
    write_scope: ['src/a.ts'],
    mapped_ac_ids: ['AC001'],
    required_skills: ['task-verify'],
    verification: { strategy: 'tdd', detail: 'npm test' },
    result: { summary: 'done', evidence: 'tests pass' },
    usage: null,
  } as Task;

  // A legacy-shaped task omitting every optional field the projection guards.
  const legacyTask: Task = {
    id: 'T002',
    objective: 'Do the legacy thing.',
    status: 'planned',
    depends_on: ['T001'],
    acceptance_criteria: ['It also works'],
    relevant_files: ['src/b.ts'],
    verification: { strategy: 'command', detail: 'npm run lint' },
    result: null,
    usage: null,
  } as Task;

  const contract = { frontmatter: frontmatter(), body: '\n# Contract\n' };

  it('is deterministic and shaped like a sha256 hash', () => {
    const a = computeReviewContentHash(contract, [fullTask, legacyTask]);
    const b = computeReviewContentHash(contract, [fullTask, legacyTask]);
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('changes when a task definition field changes', () => {
    const base = computeReviewContentHash(contract, [fullTask]);
    const edited = computeReviewContentHash(contract, [
      { ...fullTask, objective: 'Do something else.' } as Task,
    ]);
    expect(edited).not.toBe(base);
  });

  it('ignores task execution telemetry: status/attempts/result/usage changes never stale the hash', () => {
    const base = computeReviewContentHash(contract, [fullTask]);
    const transitioned = computeReviewContentHash(contract, [
      {
        ...fullTask,
        status: 'in_progress',
        attempts: 3,
        result: null,
        usage: { total_tokens: 999, attempts: 3 },
      } as unknown as Task,
    ]);
    expect(transitioned).toBe(base);
  });

  it('ignores contract lifecycle fields: confirm\'s own status/hash rewrite never stales the hash', () => {
    const base = computeReviewContentHash(contract, [legacyTask]);
    const confirmed = computeReviewContentHash(
      {
        frontmatter: frontmatter({
          status: 'review',
          confirmed_at: '2026-08-21T12:00:00Z',
          verification_approved_hash: 'sha256:' + 'b'.repeat(64),
        }),
        body: contract.body,
      },
      [legacyTask],
    );
    expect(confirmed).toBe(base);
  });

  it('covers contract CONTENT: a title or body change is a revision', () => {
    const base = computeReviewContentHash(contract, [legacyTask]);
    expect(
      computeReviewContentHash({ frontmatter: frontmatter({ title: 'Renamed' }), body: contract.body }, [
        legacyTask,
      ]),
    ).not.toBe(base);
    expect(
      computeReviewContentHash({ frontmatter: frontmatter(), body: '\n# Different prose\n' }, [legacyTask]),
    ).not.toBe(base);
  });

  it('treats presence vs absence of an optional definition field as different content', () => {
    const withName = computeReviewContentHash(contract, [fullTask]);
    const { name: _name, ...rest } = fullTask;
    const withoutName = computeReviewContentHash(contract, [rest as Task]);
    expect(withoutName).not.toBe(withName);
  });

  it('treats task order as content: reordering tasks.yaml is itself a revision', () => {
    const ab = computeReviewContentHash(contract, [fullTask, legacyTask]);
    const ba = computeReviewContentHash(contract, [legacyTask, fullTask]);
    expect(ba).not.toBe(ab);
  });
});
