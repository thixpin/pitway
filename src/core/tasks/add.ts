import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import { formatIssues } from '../../state/contract-file.js';
import { appendJournalEntry } from '../../state/journal.js';
import { taskSchema, type Task } from '../../state/schemas.js';
import { assertFileScopedTasks } from '../milestones/create.js';
import { loadContract, loadTasks, readInputFile, saveTasks } from '../../state/store.js';
import { resolveReadyTasks } from './dependencies.js';

export class TaskAddError extends Error {}

export interface TaskAddInputs {
  filePath: string;
  changeLogEvidence: string;
}

export interface TaskAddView {
  id: string;
  milestone: string;
  operation: 'add';
}

// Execution-only fields the new task's own status/history must derive, never
// accept from the caller — same intent as task-amend's whitelist, inverted
// into a blacklist because a new task otherwise carries the full schema.
const EXECUTION_ONLY_FIELDS = new Set(['status', 'result', 'usage', 'attempts']);

// Replicated locally from confirm.ts/amend.ts (each already keeps its own
// copy — see amend.ts's comment on this same logic) rather than extracted
// into a shared helper, matching the codebase's existing precedent and
// staying inside T002's write_scope.
function assertChangeLogEntry(milestoneId: string, body: string): void {
  const lines = body.split('\n');
  const headingAt = lines.findIndex((line) => line.trim() === '## Change Log');
  if (headingAt !== -1) {
    for (let i = headingAt + 1; i < lines.length; i++) {
      if (/^#{1,6}\s/.test(lines[i]!)) break;
      if (lines[i]!.trim().length > 0) return;
    }
  }
  throw new TaskAddError(
    `cannot add a task to ${milestoneId}: contract.md has no Change Log entry recorded; ` +
      `record the rationale via milestone-confirm --amend first`,
  );
}

function parseTaskDefinitionInput(path: string): Record<string, unknown> {
  let text: string;
  try {
    text = readInputFile(path, 'task definition');
  } catch (error) {
    throw new TaskAddError((error as Error).message);
  }
  let data: unknown;
  try {
    data = parse(text);
  } catch (error) {
    throw new TaskAddError(`invalid task definition ${path}: ${(error as Error).message}`);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new TaskAddError(`invalid task definition ${path}: must be a YAML object of task fields`);
  }
  const fields = data as Record<string, unknown>;
  const disallowed = Object.keys(fields).filter((key) => EXECUTION_ONLY_FIELDS.has(key));
  if (disallowed.length > 0) {
    throw new TaskAddError(
      `task definition ${path} contains execution-only field(s) that cannot be set on add: ${disallowed.join(', ')}`,
    );
  }
  return fields;
}

function nextSequentialTaskId(tasks: Task[]): string {
  const max = tasks.reduce((acc, t) => {
    const match = /^T(\d{3})$/.exec(t.id);
    return match ? Math.max(acc, Number(match[1])) : acc;
  }, 0);
  return `T${String(max + 1).padStart(3, '0')}`;
}

export function addTask(
  root: string,
  milestoneId: string,
  inputs: TaskAddInputs,
): TaskAddView {
  if (inputs.changeLogEvidence.trim().length === 0) {
    throw new TaskAddError('task-add requires non-empty --change-log evidence');
  }

  const contract = loadContract(root, milestoneId);
  const status = contract.frontmatter.status;
  if (status === 'draft') {
    throw new TaskAddError(
      `cannot add a task to ${milestoneId}: milestone is still draft; use milestone-add --replace instead`,
    );
  }
  if (status === 'review') {
    throw new TaskAddError(
      `cannot add a task to ${milestoneId}: milestone is awaiting verification (review); ` +
        `run verify / milestone-complete first, or resolve failed verification before growing the task graph`,
    );
  }
  if (status === 'completed' || status === 'cancelled') {
    throw new TaskAddError(`cannot add a task to ${milestoneId}: milestone is ${status}`);
  }
  assertChangeLogEntry(milestoneId, contract.body);

  const fields = parseTaskDefinitionInput(inputs.filePath);
  if (typeof fields.name !== 'string' || fields.name.trim().length === 0) {
    throw new TaskAddError('task-add requires a non-empty name for the new task');
  }

  const tasksFile = loadTasks(root, milestoneId);
  const nextId = nextSequentialTaskId(tasksFile.tasks);
  if (fields.id !== nextId) {
    throw new TaskAddError(
      `task-add requires id ${nextId} (the next sequential task id); got ${JSON.stringify(fields.id)}`,
    );
  }

  const candidate = { ...fields, status: 'waiting', result: null, usage: null };
  const parsed = taskSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new TaskAddError(`invalid new task ${nextId}: ${formatIssues(parsed.error)}`);
  }
  const newTask: Task = parsed.data;
  // M045/T002 (W2): same file-only scope rule as milestone-add.
  assertFileScopedTasks(root, [newTask], (m) => { throw new TaskAddError(m); });

  const byId = new Map(tasksFile.tasks.map((t) => [t.id, t]));
  for (const depId of newTask.depends_on) {
    const dep = byId.get(depId);
    if (dep === undefined) {
      throw new TaskAddError(`task-add: depends_on references unknown task ${depId}`);
    }
    if (dep.status === 'cancelled') {
      throw new TaskAddError(
        `task-add: depends_on references cancelled task ${depId}, which would never complete`,
      );
    }
  }

  const withNewTask = resolveReadyTasks([...tasksFile.tasks, newTask]);

  const operationId = createHash('sha256')
    .update(JSON.stringify({ milestone: milestoneId, taskId: nextId, fields }))
    .digest('hex');

  appendJournalEntry(root, {
    milestone: milestoneId,
    type: 'task_amendment',
    operationId,
    target: nextId,
    payload: {
      operation: 'add',
      changeLogEvidence: inputs.changeLogEvidence,
      fields,
    },
  });
  saveTasks(root, milestoneId, {
    schema_version: tasksFile.schema_version,
    tasks: withNewTask,
  });

  return { id: nextId, milestone: milestoneId, operation: 'add' };
}
