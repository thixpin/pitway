import { createHash } from 'node:crypto';
import type { ReviewFindingsSnapshot, Task } from '../../state/schemas.js';

export class ReviewRoleError extends Error {}

export interface ReviewRole {
  id: string;
  focus: string;
}

// AC001: nine built-in roles as registry data, engineering vocabulary ids.
// Role ids are kebab-case strings by schema (see reviewRoleIdSchema) so
// later registry additions need no schema change -- but MVP commands accept
// only these registered ids (extensible-by-code, disclosed as the
// deliberate MVP narrowing of the backlog doc's "extensible role
// identifiers"). Each focus is deliberately disjoint from its nearest
// neighbor (qa vs developer testability; ui-ux vs user; business-analyst vs
// business/product) so multi-role selections stay independent
// perspectives, not duplicates.
export const REVIEW_ROLES: readonly ReviewRole[] = [
  {
    id: 'developer',
    focus:
      'task granularity, implementation feasibility, write_scope accuracy, testability, implementation edge cases',
  },
  {
    id: 'architect',
    focus: 'layering, dependencies, invariants, state/concurrency, design consistency, agent-agnosticism',
  },
  {
    id: 'devops',
    focus:
      'CI/CD, Git/branching, deployment, rollback, infrastructure, observability, operational safety, failure recovery, permissions, automation and release risk',
  },
  {
    id: 'qa',
    focus:
      'test strategy and tier coverage, verification-check quality and AC-to-check mapping, edge/failure/regression cases, evidence quality',
  },
  {
    id: 'product',
    focus: 'requirement coverage, scope, acceptance criteria, product behavior',
  },
  {
    id: 'business',
    focus: 'business value, operational impact, cost, risk and priority',
  },
  {
    id: 'business-analyst',
    focus:
      'requirement elicitation and traceability, acceptance-criteria completeness/testability/measurability, requirement-to-contract scope alignment, process fit',
  },
  {
    id: 'ui-ux',
    focus:
      "interface and interaction design of the delivered surfaces -- for PitWay's CLI: command ergonomics, output readability and consistency, terminology, error-message clarity and actionability",
  },
  {
    id: 'user',
    focus: 'usability, clarity, workflow experience and user-facing behavior',
  },
] as const;

const ROLE_MAP = new Map(REVIEW_ROLES.map((role) => [role.id, role]));

export function isKnownReviewRole(id: string): boolean {
  return ROLE_MAP.has(id);
}

export function getReviewRole(id: string): ReviewRole | undefined {
  return ROLE_MAP.get(id);
}

// AC002's own role validation (unknown/duplicate/empty refused, naming
// offenders) lives in T002's session.ts -- this helper only answers the
// single, registry-only question "is this id known," reused by every
// caller (start, brief, record) that needs to check a role against the
// registry.
export function assertKnownReviewRoles(ids: string[]): void {
  const unknown = ids.filter((id) => !isKnownReviewRole(id));
  if (unknown.length > 0) {
    throw new ReviewRoleError(`unknown review role(s): ${unknown.join(', ')}`);
  }
}

// Newest-per-role derivation (AC001): findings[] is an append-only sequence
// of full per-role snapshots -- a later snapshot for a role supersedes the
// prior one only in this derived view, never by mutating or removing the
// earlier one on disk. Iteration order is append order, so a later Map.set
// for the same role naturally overwrites the earlier snapshot while
// preserving each role's first-seen position in the returned Map's key
// order.
export function deriveLatestFindingsByRole(
  findings: ReviewFindingsSnapshot[],
): Map<string, ReviewFindingsSnapshot> {
  const latest = new Map<string, ReviewFindingsSnapshot>();
  for (const snapshot of findings) {
    latest.set(snapshot.role, snapshot);
  }
  return latest;
}

// Task-definition projection (AC001): exactly the fields that define a
// task's CONTENT, deliberately excluding status/attempts/result/usage --
// execution telemetry is not a revision, so task transitions and confirm's
// own planned->waiting/ready promotion never stale a review session's hash.
// Only fields actually present on the task are included (mirrors the
// schema's own either/or scope-declaration shape), so hashing stays stable
// across the legacy relevant_files / context_files+write_scope split.
interface TaskDefinitionProjection {
  id: string;
  name?: string;
  objective: string;
  depends_on: string[];
  acceptance_criteria: string[];
  context_files?: string[];
  write_scope?: string[];
  relevant_files?: string[];
  mapped_ac_ids?: string[];
  required_skills?: string[];
  verification: { strategy: string; detail: string };
}

function projectTaskDefinition(task: Task): TaskDefinitionProjection {
  return {
    id: task.id,
    ...(task.name !== undefined ? { name: task.name } : {}),
    objective: task.objective,
    depends_on: task.depends_on,
    acceptance_criteria: task.acceptance_criteria,
    ...(task.context_files !== undefined ? { context_files: task.context_files } : {}),
    ...(task.write_scope !== undefined ? { write_scope: task.write_scope } : {}),
    ...(task.relevant_files !== undefined ? { relevant_files: task.relevant_files } : {}),
    ...(task.mapped_ac_ids !== undefined ? { mapped_ac_ids: task.mapped_ac_ids } : {}),
    ...(task.required_skills !== undefined ? { required_skills: task.required_skills } : {}),
    verification: { strategy: task.verification.strategy, detail: task.verification.detail },
  };
}

// AC001's content_hash: sha256 over the raw contract.md bytes PLUS a
// canonical JSON projection of every task's DEFINITION -- the same
// canonicalize-then-hash discipline as verification_approved_hash
// (src/core/contracts/verification-hash.ts), which hashes the canonical
// verification block rather than raw file bytes. `tasks` is expected in
// tasks.yaml's own on-disk order; a stable projection order (not sorted by
// id) means reordering tasks.yaml would itself count as content revision,
// which is the intended, disclosed behavior -- content_hash covers the
// milestone's CONTENT as currently persisted, not a normalized abstraction
// of it.
export function computeReviewContentHash(contractText: string, tasks: Task[]): string {
  const projection = tasks.map(projectTaskDefinition);
  const canonical = JSON.stringify(projection);
  const combined = `${contractText}\n${canonical}`;
  return `sha256:${createHash('sha256').update(combined).digest('hex')}`;
}
