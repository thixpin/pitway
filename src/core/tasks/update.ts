import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'zod';
import { commitOrResume } from '../../git/commit-or-resume.js';
import { git } from '../../git/exec.js';
import { checkWorkingTreeClean } from '../../git/safety.js';
import { composeMessage, resolveCommitSha } from '../../git/trailers.js';
import { formatIssues } from '../../state/contract-file.js';
import {
  taskStatusSchema,
  taskUsageSchema,
  type Task,
  type TaskStatus,
  type TaskUsage,
  type TasksFile,
} from '../../state/schemas.js';
import { loadState, loadTasks, saveTasks } from '../../state/store.js';
import { resolveReadyTasks } from './dependencies.js';
import { transitionTask } from './state-machine.js';

export class TaskUpdateError extends Error {}

export interface TaskUpdateInputs {
  resultPath?: string;
  messagePath?: string;
  // Measured token usage as a JSON string: {input_tokens?, output_tokens?, total_tokens}.
  usage?: string;
}

export interface TaskUpdateView {
  id: string;
  status: TaskStatus;
  attempts: number | null;
  outcome: 'updated' | 'committed' | 'already-committed';
  commit: string | null;
}

const resultSchema = z.strictObject({
  summary: z.string().min(1),
  evidence: z.string().min(1),
});

type TaskResult = z.infer<typeof resultSchema>;

const tasksRepoPath = (milestoneId: string): string => `.pitway/milestones/${milestoneId}/tasks.yaml`;

function resolveActiveMilestone(root: string): string {
  const state = loadState(root);
  if (!state.active_milestone) {
    throw new TaskUpdateError('no active milestone; run milestone-add first');
  }
  return state.active_milestone;
}

function findTask(tasks: Task[], id: string): Task {
  const task = tasks.find((t) => t.id === id);
  if (!task) throw new TaskUpdateError(`task ${id} not found`);
  return task;
}

function readInput(path: string, label: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    throw new TaskUpdateError(`cannot read ${label} file ${path}: ${(error as Error).message}`);
  }
}

function parseResultInput(path: string): TaskResult {
  const text = readInput(path, 'result');
  let data: unknown;
  try {
    data = parse(text);
  } catch (error) {
    throw new TaskUpdateError(`malformed YAML in result file ${path}: ${(error as Error).message}`);
  }
  const parsed = resultSchema.safeParse(data);
  if (!parsed.success) {
    throw new TaskUpdateError(`invalid result file ${path}: ${formatIssues(parsed.error)}`);
  }
  return parsed.data;
}

function parseUsageInput(text: string): TaskUsage {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new TaskUpdateError(`invalid --usage JSON: ${(error as Error).message}`);
  }
  const parsed = taskUsageSchema.safeParse(data);
  if (!parsed.success) {
    throw new TaskUpdateError(`invalid --usage: ${formatIssues(parsed.error)}`);
  }
  return parsed.data;
}

// AC016: accumulate honestly onto prior measured usage — sum what was
// measured, keep a field absent when neither side measured it, never estimate.
function accumulateUsage(prior: TaskUsage, delta: TaskUsage): TaskUsage {
  if (delta === null) return prior;
  if (prior === null) return delta;
  const sum = (a: number | undefined, b: number | undefined): number | undefined =>
    a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
  const input = sum(prior.input_tokens, delta.input_tokens);
  const output = sum(prior.output_tokens, delta.output_tokens);
  return {
    ...(input !== undefined ? { input_tokens: input } : {}),
    ...(output !== undefined ? { output_tokens: output } : {}),
    total_tokens: prior.total_tokens + delta.total_tokens,
  };
}

// AC009-style refusal before anything is staged, committed, or written.
function assertDirtySubset(root: string, expectedPaths: string[]): void {
  const expected = new Set(expectedPaths);
  const unexpected = checkWorkingTreeClean(root).dirtyPaths.filter((p) => !expected.has(p));
  if (unexpected.length > 0) {
    throw new TaskUpdateError(
      `cannot safely proceed: unrelated dirty changes present: ${unexpected.join(', ')}`,
    );
  }
}

function persistTask(root: string, milestoneId: string, tasksFile: TasksFile, updated: Task): void {
  saveTasks(root, milestoneId, {
    schema_version: tasksFile.schema_version,
    tasks: tasksFile.tasks.map((t) => (t.id === updated.id ? updated : t)),
  });
}

interface CommittedTaskRecord {
  id?: unknown;
  status?: unknown;
  result?: { summary?: unknown; evidence?: unknown } | null;
}

// AC018 task-specific identity: candidate matched by both trailers; identity
// holds iff, in the committed tasks.yaml at that SHA, the target task's record
// alone shows completed with a result equal to the persisted one. Sibling task
// changes are ignored — this is a parsed comparison, not byte equality.
function findCompletionCommit(
  root: string,
  milestoneId: string,
  taskId: string,
  persisted: TaskResult,
): string | undefined {
  const sha = resolveCommitSha(root, { milestone: milestoneId, task: taskId });
  if (sha === undefined) return undefined;
  let record: CommittedTaskRecord | undefined;
  try {
    const data = parse(git(['show', `${sha}:${tasksRepoPath(milestoneId)}`], root)) as {
      tasks?: CommittedTaskRecord[];
    };
    record = data.tasks?.find((t) => t.id === taskId);
  } catch {
    record = undefined;
  }
  const matches =
    record !== undefined &&
    record.status === 'completed' &&
    record.result != null &&
    record.result.summary === persisted.summary &&
    record.result.evidence === persisted.evidence;
  if (!matches) {
    throw new TaskUpdateError(
      `ambiguous state: commit ${sha} carries the ${taskId} completion trailers but its ` +
        `committed record does not match the persisted result; inspect manually`,
    );
  }
  return sha;
}

function completeTask(
  root: string,
  milestoneId: string,
  tasksFile: TasksFile,
  task: Task,
  inputs: TaskUpdateInputs,
): TaskUpdateView {
  const tasksPath = tasksRepoPath(milestoneId);
  const expectedPaths = [...task.relevant_files, tasksPath];
  const trailers = { 'PitWay-Milestone': milestoneId, 'PitWay-Task': task.id };
  const attempts = task.attempts ?? null;

  if (task.status === 'completed') {
    // AC018 re-entry: the persisted result and usage stand; resupplied
    // --result/--usage are ignored.
    const persisted = task.result;
    if (persisted === null) {
      throw new TaskUpdateError(
        `${task.id} is completed but has no recorded result; inspect manually`,
      );
    }
    const existing = findCompletionCommit(root, milestoneId, task.id, persisted);
    if (existing !== undefined) {
      return { id: task.id, status: 'completed', attempts, outcome: 'already-committed', commit: existing };
    }
    if (inputs.messagePath === undefined) {
      throw new TaskUpdateError(
        `completion commit for ${task.id} is pending; resupply --message to resume`,
      );
    }
    const committed = commitOrResume(root, {
      expectedPaths,
      findExistingCommit: () => findCompletionCommit(root, milestoneId, task.id, persisted),
      localStateAdvanced: true,
      message: composeMessage(readInput(inputs.messagePath, 'message'), trailers),
    });
    return { id: task.id, status: 'completed', attempts, outcome: committed.outcome, commit: committed.sha };
  }

  // AC013: the pure state machine gates completion before anything else.
  transitionTask(task.status, 'completed');
  const candidate = resolveCommitSha(root, { milestone: milestoneId, task: task.id });
  if (candidate !== undefined) {
    throw new TaskUpdateError(
      `ambiguous state: commit ${candidate} already carries the ${task.id} completion trailers ` +
        `but the task is "${task.status}"; inspect manually`,
    );
  }
  if (inputs.resultPath === undefined || inputs.messagePath === undefined) {
    throw new TaskUpdateError('task-update to completed requires --result and --message');
  }
  const result = parseResultInput(inputs.resultPath);
  const message = readInput(inputs.messagePath, 'message');
  const usageDelta = inputs.usage === undefined ? null : parseUsageInput(inputs.usage);
  // AC015: any violation refuses the entire operation before tasks.yaml is written.
  assertDirtySubset(root, expectedPaths);

  const completed: Task = {
    ...task,
    status: 'completed',
    result,
    usage: accumulateUsage(task.usage, usageDelta),
  };
  // AC010: promote any waiting dependent whose dependencies are now all
  // completed within this same persisted write, so the completion commit
  // and the promotion land together.
  const resolvedTasks = resolveReadyTasks(
    tasksFile.tasks.map((t) => (t.id === completed.id ? completed : t)),
  );
  saveTasks(root, milestoneId, { schema_version: tasksFile.schema_version, tasks: resolvedTasks });
  const committed = commitOrResume(root, {
    expectedPaths,
    findExistingCommit: () => findCompletionCommit(root, milestoneId, task.id, result),
    localStateAdvanced: true,
    message: composeMessage(message, trailers),
  });
  return { id: task.id, status: 'completed', attempts, outcome: committed.outcome, commit: committed.sha };
}

export function updateTask(
  root: string,
  taskId: string,
  targetStatus: string,
  inputs: TaskUpdateInputs = {},
): TaskUpdateView {
  const parsedStatus = taskStatusSchema.safeParse(targetStatus);
  if (!parsedStatus.success) {
    throw new TaskUpdateError(
      `unknown task status "${targetStatus}"; valid statuses: ${taskStatusSchema.options.join(', ')}`,
    );
  }
  const target = parsedStatus.data;
  const milestoneId = resolveActiveMilestone(root);
  const tasksFile = loadTasks(root, milestoneId);
  const task = findTask(tasksFile.tasks, taskId);

  if (target === 'completed') {
    return completeTask(root, milestoneId, tasksFile, task, inputs);
  }

  // AC013: every transition passes through the pure state machine; an illegal
  // transition throws (naming the allowed targets) before anything is written.
  const next = transitionTask(task.status, target);
  const updated: Task = { ...task, status: next };
  if (target === 'in_progress') {
    // AC014: execution starts here — the tree must be clean except tasks.yaml,
    // and attempts increments exactly once per (re)start, deterministically.
    assertDirtySubset(root, [tasksRepoPath(milestoneId)]);
    updated.attempts = (task.attempts ?? 0) + 1;
  }
  // AC017: every non-completion write touches tasks.yaml only and never commits.
  persistTask(root, milestoneId, tasksFile, updated);
  return {
    id: task.id,
    status: next,
    attempts: updated.attempts ?? null,
    outcome: 'updated',
    commit: null,
  };
}
