import { randomUUID } from 'node:crypto';
import { parse } from 'yaml';
import { appendJournalEntry } from '../../state/journal.js';
import { loadContract, loadReviews, readInputFile, saveReviews } from '../../state/store.js';
import { formatIssues } from '../../state/contract-file.js';
import {
  reviewRecordInputSchema,
  taskUsageSchema,
  type ReviewFindingEntry,
  type ReviewFindingsSnapshot,
  type TaskUsage,
} from '../../state/schemas.js';
import { computeCurrentReviewContentHash } from './session.js';

export class ReviewRecordError extends Error {}

export interface RecordReviewFindingsInputs {
  role: string;
  filePath: string;
  // Measured token usage as a JSON string: {input_tokens?, output_tokens?, total_tokens}.
  // Mirrors src/core/tasks/update.ts's parseUsageInput shape verbatim (its
  // own module-local duplication precedent, not a cross-module import) --
  // a measured figure only, never estimated. Omitted leaves usage null.
  usage?: string;
}

export interface RecordReviewView {
  milestone: string;
  sessionId: string;
  role: string;
  recordedAt: string;
  findingsCount: number;
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// AC005: trim + case-fold every declared target -- grouping (T006's report)
// and the unknown-ACnnn/Tnnn warning both operate on this normalized form.
// An unknown target is deliberately ACCEPTED here, never refused: a
// reviewer may legitimately target something a revision will rename.
function normalizeFindings(findings: ReviewFindingEntry[]): ReviewFindingEntry[] {
  return findings.map((f) =>
    f.targets === undefined ? f : { ...f, targets: f.targets.map((t) => t.trim().toLowerCase()) },
  );
}

function parseUsageInput(text: string): TaskUsage {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new ReviewRecordError(`invalid --usage JSON: ${(error as Error).message}`);
  }
  const parsed = taskUsageSchema.safeParse(data);
  if (!parsed.success) {
    throw new ReviewRecordError(`invalid --usage: ${formatIssues(parsed.error)}`);
  }
  return parsed.data;
}

function parseFindingsFile(path: string): ReviewFindingEntry[] {
  const text = readInputFile(path, 'findings');
  let data: unknown;
  try {
    data = parse(text);
  } catch (error) {
    throw new ReviewRecordError(`malformed YAML in findings file ${path}: ${(error as Error).message}`);
  }
  const result = reviewRecordInputSchema.safeParse(data);
  if (!result.success) {
    throw new ReviewRecordError(`invalid findings file ${path}: ${formatIssues(result.error)}`);
  }
  return normalizeFindings(result.data.findings);
}

// AC005: appends a full per-role findings snapshot (append-only; a
// re-recorded role's newer snapshot wins derivation, never mutating the
// prior one) and journal-records the mutation per AC001. Refuses: no open
// session; role not in session; terminal milestone; the same
// definition-hash staleness gate as brief (AC004), with the identical
// fresh-session/decide-rejected diagnostic. An empty findings list is
// valid -- a clean review is a result.
export function recordReviewFindings(
  root: string,
  milestoneId: string,
  inputs: RecordReviewFindingsInputs,
): RecordReviewView {
  const contract = loadContract(root, milestoneId);
  if (contract.frontmatter.status === 'completed' || contract.frontmatter.status === 'cancelled') {
    throw new ReviewRecordError(
      `cannot record findings for ${milestoneId}: milestone status is "${contract.frontmatter.status}" (terminal)`,
    );
  }

  const reviews = loadReviews(root, milestoneId);
  const session = reviews.sessions.find((s) => s.status === 'open');
  if (session === undefined) {
    throw new ReviewRecordError(`cannot record findings for ${milestoneId}: no open review session`);
  }
  if (!session.roles.includes(inputs.role)) {
    throw new ReviewRecordError(
      `role "${inputs.role}" is not part of the open session ${session.id} (roles: ${session.roles.join(', ')})`,
    );
  }

  const currentHash = computeCurrentReviewContentHash(root, milestoneId);
  if (currentHash !== session.content_hash) {
    throw new ReviewRecordError(
      `cannot record: ${milestoneId}'s contract/task content was revised since session ${session.id} ` +
        `opened -- start a fresh session (decide --outcome rejected abandons this stale one)`,
    );
  }

  const findings = parseFindingsFile(inputs.filePath);
  const usage = inputs.usage === undefined ? null : parseUsageInput(inputs.usage);
  const recordedAt = nowIso();
  const snapshot: ReviewFindingsSnapshot = { role: inputs.role, recorded_at: recordedAt, findings, usage };

  appendJournalEntry(root, {
    milestone: milestoneId,
    type: 'review_recording',
    operationId: randomUUID(),
    target: session.id,
    payload: { sessionId: session.id, action: 'record', role: inputs.role },
  });
  const updatedSessions = reviews.sessions.map((s) =>
    s.id === session.id ? { ...s, findings: [...s.findings, snapshot] } : s,
  );
  saveReviews(root, milestoneId, { schema_version: 1, sessions: updatedSessions });

  return {
    milestone: milestoneId,
    sessionId: session.id,
    role: inputs.role,
    recordedAt,
    findingsCount: findings.length,
  };
}
