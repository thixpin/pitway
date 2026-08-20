import { loadContract, loadReviews, loadTasks } from '../../state/store.js';
import type { ReviewFindingEntry, ReviewFindingsSnapshot, ReviewSession } from '../../state/schemas.js';
import { deriveLatestFindingsByRole } from './roles.js';

export class ReviewReportError extends Error {}

const SEVERITY_ORDER: Record<ReviewFindingEntry['severity'], number> = {
  blocker: 0,
  major: 1,
  minor: 2,
};

const AC_OR_TASK_SHAPE = /^(ac|t)\d+$/;

export interface ReviewReportFindingView {
  severity: ReviewFindingEntry['severity'];
  finding: string;
  targets: string[];
  unknownTargets: string[];
  recommendation: string;
  conflictsWith: string[];
}

export interface ReviewReportRoleView {
  role: string;
  recorded: boolean;
  recordedAt: string | null;
  supersededCount: number;
  findings: ReviewReportFindingView[];
}

export interface ReviewReportSharedTargetConflictView {
  target: string;
  entries: Array<{ role: string; finding: string; severity: ReviewFindingEntry['severity'] }>;
}

export interface ReviewReportDeclaredConflictView {
  role: string;
  finding: string;
  conflictsWith: string[];
}

export interface ReviewReportView {
  milestone: string;
  sessionId: string;
  status: ReviewSession['status'];
  roles: ReviewReportRoleView[];
  pendingRoles: string[];
  sharedTargetConflicts: ReviewReportSharedTargetConflictView[];
  declaredConflicts: ReviewReportDeclaredConflictView[];
  // AC006: Core never semantically reconciles -- this text states, as view
  // data, that reconciliation belongs to the developer/driver and that a
  // recorded finding is reviewer opinion-evidence, never proof requiring
  // implementation or runtime verification.
  honesty: string[];
}

const HONESTY_LINES = [
  'Reconciling these findings is the developer/driver\'s job -- PitWay only groups and lists them mechanically, never resolves them.',
  'A recorded finding is reviewer opinion-evidence, never proof: nothing here substitutes for implementation or runtime verification.',
];

function sortFindings(findings: ReviewFindingEntry[]): ReviewFindingEntry[] {
  return [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

function toFindingView(entry: ReviewFindingEntry, knownIds: Set<string>): ReviewReportFindingView {
  const targets = entry.targets ?? [];
  const unknownTargets = targets.filter((t) => AC_OR_TASK_SHAPE.test(t) && !knownIds.has(t));
  return {
    severity: entry.severity,
    finding: entry.finding,
    targets,
    unknownTargets,
    recommendation: entry.recommendation,
    conflictsWith: entry.conflicts_with ?? [],
  };
}

function countSuperseded(findings: ReviewFindingsSnapshot[], role: string): number {
  const count = findings.filter((f) => f.role === role).length;
  return count > 0 ? count - 1 : 0;
}

// AC006: derived mechanically as (a) declared conflicts_with pairs and (b)
// any target named by more than one role -- listed side by side per
// target. Both operate over each role's DERIVED (newest) snapshot only.
function buildConflicts(
  latestByRole: Map<string, ReviewFindingsSnapshot>,
): { shared: ReviewReportSharedTargetConflictView[]; declared: ReviewReportDeclaredConflictView[] } {
  const declared: ReviewReportDeclaredConflictView[] = [];
  const targetMap = new Map<string, Array<{ role: string; finding: string; severity: ReviewFindingEntry['severity'] }>>();

  for (const [role, snapshot] of latestByRole) {
    for (const entry of snapshot.findings) {
      if (entry.conflicts_with !== undefined && entry.conflicts_with.length > 0) {
        declared.push({ role, finding: entry.finding, conflictsWith: entry.conflicts_with });
      }
      for (const target of entry.targets ?? []) {
        const list = targetMap.get(target) ?? [];
        list.push({ role, finding: entry.finding, severity: entry.severity });
        targetMap.set(target, list);
      }
    }
  }

  const shared: ReviewReportSharedTargetConflictView[] = [];
  for (const [target, entries] of targetMap) {
    const roles = new Set(entries.map((e) => e.role));
    if (roles.size > 1) shared.push({ target, entries });
  }

  return { shared, declared };
}

// AC006: read-only report VIEW -- renders the most recently created
// session for this milestone (sessions are never CLI-addressable by id).
// Roles selected but not yet recorded are listed as pending, never
// omitted; a role's superseded-snapshot count is noted when re-recorded,
// with superseded history staying in the file, never rendered.
export function buildReviewReport(root: string, milestoneId: string): ReviewReportView {
  const contract = loadContract(root, milestoneId);
  const knownIds = new Set([
    ...contract.frontmatter.acceptance_criteria.map((ac) => ac.id.toLowerCase()),
    ...loadTasks(root, milestoneId).tasks.map((t) => t.id.toLowerCase()),
  ]);

  const reviews = loadReviews(root, milestoneId);
  const session = reviews.sessions[reviews.sessions.length - 1];
  if (session === undefined) {
    throw new ReviewReportError(`no review session recorded for ${milestoneId}`);
  }

  const latestByRole = deriveLatestFindingsByRole(session.findings);
  const pendingRoles = session.roles.filter((r) => !latestByRole.has(r));

  const roles: ReviewReportRoleView[] = session.roles.map((role) => {
    const snapshot = latestByRole.get(role);
    return {
      role,
      recorded: snapshot !== undefined,
      recordedAt: snapshot?.recorded_at ?? null,
      supersededCount: countSuperseded(session.findings, role),
      findings: snapshot === undefined ? [] : sortFindings(snapshot.findings).map((f) => toFindingView(f, knownIds)),
    };
  });

  const { shared, declared } = buildConflicts(latestByRole);

  return {
    milestone: milestoneId,
    sessionId: session.id,
    status: session.status,
    roles,
    pendingRoles,
    sharedTargetConflicts: shared,
    declaredConflicts: declared,
    honesty: HONESTY_LINES,
  };
}
