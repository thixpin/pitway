import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import { formatIssues } from '../../state/contract-file.js';
import { appendJournalEntry, readJournal, type JournalEntry } from '../../state/journal.js';
import { taskSchema, type Task } from '../../state/schemas.js';
import { loadContract, loadState, loadTasks, readInputFile, saveTasks } from '../../state/store.js';
import { derivePending } from '../journal/operations.js';

export class TaskAmendError extends Error {}

export interface TaskAmendInputs {
  filePath: string;
  changeLogEvidence: string;
}

export interface TaskAmendView {
  id: string;
  milestone: string;
  operation: 'amend';
}

// The only fields a task-amend may touch — identity, status, dependency
// graph, and execution history stay immutable via this command.
const AMENDABLE_FIELDS = new Set([
  'objective',
  'acceptance_criteria',
  'relevant_files',
  'context_files',
  'write_scope',
  'verification',
]);

function resolveActiveMilestone(root: string, milestoneId: string | undefined): string {
  if (milestoneId !== undefined) return milestoneId;
  const state = loadState(root);
  if (!state.active_milestone) {
    throw new TaskAmendError('no active milestone; pass a milestone id explicitly');
  }
  return state.active_milestone;
}

// Replicates confirm.ts's assertChangeLogEntry logic locally: the operational
// meaning of "Change Log evidence" for a task amendment is that the
// milestone's currently persisted contract.md already documents a rationale
// (recorded separately, and earlier, via milestone-confirm --amend) — this
// command never appends prose to contract.md itself (see resolveTargetPath's
// one-target-per-entry-type mapping, which is why task_amendment must only
// ever dirty tasks.yaml).
function assertChangeLogEntry(milestoneId: string, body: string): void {
  const lines = body.split('\n');
  const headingAt = lines.findIndex((line) => line.trim() === '## Change Log');
  if (headingAt !== -1) {
    for (let i = headingAt + 1; i < lines.length; i++) {
      if (/^#{1,6}\s/.test(lines[i]!)) break;
      if (lines[i]!.trim().length > 0) return;
    }
  }
  throw new TaskAmendError(
    `cannot amend a task in ${milestoneId}: contract.md has no Change Log entry recorded; ` +
      `record the rationale via milestone-confirm --amend first`,
  );
}

// The proposed partial task update: an object whose keys are limited to the
// amendable fields above. Read/parse errors are wrapped the same way
// confirm.ts's parseAmendmentInput wraps them.
function parseAmendmentInput(path: string): Record<string, unknown> {
  let text: string;
  try {
    text = readInputFile(path, 'task amendment');
  } catch (error) {
    throw new TaskAmendError((error as Error).message);
  }
  let data: unknown;
  try {
    data = parse(text);
  } catch (error) {
    throw new TaskAmendError(`invalid amendment ${path}: ${(error as Error).message}`);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new TaskAmendError(`invalid amendment ${path}: must be a YAML object of task fields`);
  }
  const fields = data as Record<string, unknown>;
  const disallowed = Object.keys(fields).filter((key) => !AMENDABLE_FIELDS.has(key));
  if (disallowed.length > 0) {
    throw new TaskAmendError(
      `amendment ${path} contains field(s) that cannot be amended: ${disallowed.join(', ')}`,
    );
  }
  return fields;
}

// M005/T005 bootstrap repair (2026-08-19): the original design treated "one
// pending amendment per task" as the invariant, refusing any second
// amendment while the first was still pending — a real gap, discovered when
// T007 legitimately needed to widen its own scope twice before its first
// widening had reached a checkpoint. Corrected to cumulative chained
// amendments: an operation identity derived from content (milestone + task +
// base state + proposed fields) rather than a random one, so re-submitting
// the exact same amendment is naturally idempotent, while a genuinely new
// amendment based on the current (possibly already-amended) materialized
// state is allowed to chain — never a silent "latest wins," always validated
// against the pending chain's actual tip result.
const fingerprint = (value: unknown): string => JSON.stringify(value);

// Exported for tests exercising the defensive same-identity/different-payload
// safety net directly (structurally near-unreachable via normal calls, since
// the identity is derived from the payload itself).
export function computeTaskAmendOperationId(
  milestone: string,
  taskId: string,
  baseFingerprint: string,
  fields: Record<string, unknown>,
): string {
  return createHash('sha256')
    .update(JSON.stringify({ milestone, taskId, baseFingerprint, fields }))
    .digest('hex');
}

export function amendTask(
  root: string,
  milestoneId: string | undefined,
  taskId: string,
  inputs: TaskAmendInputs,
): TaskAmendView {
  const milestone = resolveActiveMilestone(root, milestoneId);

  if (inputs.changeLogEvidence.trim().length === 0) {
    throw new TaskAmendError('task-amend requires non-empty --change-log evidence');
  }

  const contract = loadContract(root, milestone);
  assertChangeLogEntry(milestone, contract.body);

  const tasksFile = loadTasks(root, milestone);
  // Freshly loaded — in normal operation this already reflects any prior
  // pending amendment's immediate materialization, which is what makes a
  // fresh read a valid "base" for a new amendment in the chain.
  const currentTask = tasksFile.tasks.find((t) => t.id === taskId);
  if (currentTask === undefined) {
    throw new TaskAmendError(`task ${taskId} not found`);
  }

  const fields = parseAmendmentInput(inputs.filePath);
  // Shallow merge: an included key replaces the current value entirely, an
  // omitted key keeps its current value — then the FULL merged object is
  // validated, which is what enforces the context_files/write_scope
  // combination rule automatically (reusing taskSchema, not reimplementing it).
  const candidate = { ...currentTask, ...fields };
  const parsed = taskSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new TaskAmendError(`invalid amended task ${taskId}: ${formatIssues(parsed.error)}`);
  }
  const mergedTask: Task = parsed.data;

  const writeMerged = (task: Task): void => {
    saveTasks(root, milestone, {
      schema_version: tasksFile.schema_version,
      tasks: tasksFile.tasks.map((t) => (t.id === taskId ? task : t)),
    });
  };

  const baseFp = fingerprint(currentTask);
  const resultFp = fingerprint(mergedTask);

  if (baseFp === resultFp) {
    // The proposed fields produce no actual change against the currently
    // materialized state — nothing to record or write.
    return { id: taskId, milestone, operation: 'amend' };
  }

  const operationId = computeTaskAmendOperationId(milestone, taskId, baseFp, fields);
  const allEntries = readJournal(root);

  // Re-entry: an entry (pending or already checkpointed) with this exact
  // content-derived operation identity already exists. Same identity + same
  // recorded payload/result is idempotent; same identity + a different
  // recorded payload/result is a defensive ambiguity refusal (structurally
  // near-unreachable via normal calls, since identity is derived from the
  // payload — this only fires if the journal was tampered with outside the
  // amend flow).
  const existingSameOp = allEntries.find(
    (e): e is JournalEntry => e.kind === 'entry' && e.operationId === operationId,
  );
  if (existingSameOp !== undefined) {
    if (
      existingSameOp.payload.baseFingerprint !== baseFp ||
      existingSameOp.payload.resultFingerprint !== resultFp
    ) {
      throw new TaskAmendError(
        `ambiguous state: operation ${operationId} for ${taskId} already recorded with a ` +
          `different payload/result; inspect manually`,
      );
    }
    // Duplicate re-invocation of the same amendment: harmless to re-write the
    // same content again, no new journal entry needed.
    writeMerged(mergedTask);
    return { id: taskId, milestone, operation: 'amend' };
  }

  // A genuinely new, distinct operation. If a pending amendment chain
  // already exists for this task, this proposal must be based on exactly
  // the chain's current tip result — cumulative chaining, never a
  // conflicting fork or a silent "latest wins." In normal operation this
  // always holds (currentTask was just freshly loaded, reflecting the tip's
  // materialization); it only fails when the journal's recorded chain has
  // diverged from what a fresh read actually produces.
  const pendingForTarget = derivePending(allEntries).filter(
    (entry) => entry.type === 'task_amendment' && entry.target === taskId,
  );
  if (pendingForTarget.length > 0) {
    const tip = pendingForTarget[pendingForTarget.length - 1]!;
    // Bootstrap-transition exception: an entry recorded before this
    // cumulative-chaining repair (M005/T005, 2026-08-19) has no
    // resultFingerprint to compare against — it predates the field. Its
    // effect is already immediately materialized into currentTask (that
    // invariant never changed), so a fresh read is trustworthy as the chain
    // tip without a fingerprint match. This applies only to that one-time
    // transition, never to entries recorded after the repair.
    if (tip.payload.resultFingerprint !== undefined && tip.payload.resultFingerprint !== baseFp) {
      throw new TaskAmendError(
        `conflict: proposed amendment for ${taskId} is not based on the current pending ` +
          `amendment chain's tip result; checkpoint or resolve the pending chain before amending again`,
      );
    }
  }

  appendJournalEntry(root, {
    milestone,
    type: 'task_amendment',
    operationId,
    target: taskId,
    payload: {
      changeLogEvidence: inputs.changeLogEvidence,
      fields,
      baseFingerprint: baseFp,
      resultFingerprint: resultFp,
    },
  });
  writeMerged(mergedTask);
  return { id: taskId, milestone, operation: 'amend' };
}
