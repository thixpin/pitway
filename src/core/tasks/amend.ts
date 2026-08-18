import { randomUUID } from 'node:crypto';
import { parse } from 'yaml';
import { formatIssues } from '../../state/contract-file.js';
import { appendJournalEntry, readJournal } from '../../state/journal.js';
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

const deepEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

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
  const task = tasksFile.tasks.find((t) => t.id === taskId);
  if (task === undefined) {
    throw new TaskAmendError(`task ${taskId} not found`);
  }

  const fields = parseAmendmentInput(inputs.filePath);
  // Shallow merge: an included key replaces the current value entirely, an
  // omitted key keeps its current value — then the FULL merged object is
  // validated, which is what enforces the context_files/write_scope
  // combination rule automatically (reusing taskSchema, not reimplementing it).
  const candidate = { ...task, ...fields };
  const parsed = taskSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new TaskAmendError(`invalid amended task ${taskId}: ${formatIssues(parsed.error)}`);
  }
  const mergedTask: Task = parsed.data;

  const writeMerged = (): void => {
    saveTasks(root, milestone, {
      schema_version: tasksFile.schema_version,
      tasks: tasksFile.tasks.map((t) => (t.id === taskId ? mergedTask : t)),
    });
  };

  // Pre-write idempotency, mirroring confirm.ts's runAmend pattern: at most
  // one pending task_amendment entry per task should ever exist at a time.
  const pending = derivePending(readJournal(root)).filter(
    (entry) => entry.type === 'task_amendment' && entry.target === taskId,
  );
  if (pending.length > 1) {
    throw new TaskAmendError(
      `ambiguous state: multiple pending task amendment journal entries exist for ${taskId}; inspect manually`,
    );
  }
  const pendingEntry = pending[0];
  if (pendingEntry !== undefined) {
    if (!deepEqual(pendingEntry.payload.fields, fields)) {
      throw new TaskAmendError(
        `ambiguous state: a different amendment is already pending for ${taskId}; ` +
          `checkpoint or resolve it before amending again`,
      );
    }
    // Duplicate re-invocation of the same amendment: harmless to re-write the
    // same content again, no new journal entry needed.
    writeMerged();
    return { id: taskId, milestone, operation: 'amend' };
  }

  // Zero pending: either genuinely new, or already fully materialized (and
  // possibly already checkpointed) by a prior invocation of this exact
  // amendment.
  if (deepEqual(task, mergedTask)) {
    return { id: taskId, milestone, operation: 'amend' };
  }

  appendJournalEntry(root, {
    milestone,
    type: 'task_amendment',
    operationId: randomUUID(),
    target: taskId,
    payload: { changeLogEvidence: inputs.changeLogEvidence, fields },
  });
  writeMerged();
  return { id: taskId, milestone, operation: 'amend' };
}
