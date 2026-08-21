import { describe, expect, it } from 'vitest';
import { REVIEW_ROLES } from '../../src/core/reviews/roles.js';

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
