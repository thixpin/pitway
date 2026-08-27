import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { assertOnMilestoneBranch } from '../../git/branch.js';
import { commitOrResume } from '../../git/commit-or-resume.js';
import { git } from '../../git/exec.js';
import { checkWorkingTreeClean, classifyDirtyPaths } from '../../git/safety.js';
import { composeMessage, resolveCommitSha } from '../../git/trailers.js';
import { trimTail } from '../verification/text-trim.js';
import { verificationRepairsRepoPath, verificationResultsRepoPath } from '../verification/repair.js';
import { formatIssues } from '../../state/contract-file.js';
import {
  readJournal,
  reconcilePending,
  type JournalTaskVerifyEvidence,
  type JournalTaskVerifyFingerprintEntry,
} from '../../state/journal.js';
import {
  taskStatusSchema,
  taskUsageSchema,
  type Task,
  type TaskStatus,
  type TaskUsage,
  type TasksFile,
} from '../../state/schemas.js';
import { loadContract, loadState, loadTasks, resolveMilestoneDirName, saveTasks } from '../../state/store.js';
import { deterministicBranchName } from '../milestones/confirm.js';
import { resolveReadyTasks } from './dependencies.js';
import { deriveLiveDispatches } from './dispatch.js';
import { transitionTask } from './state-machine.js';
import { MISSING_HASH_MARKER } from './verify.js';

// AC003/T003 (M012): resolves the branch this milestone's commits must land
// on, or null when no branch is tracked (main strategy, or an untracked
// milestone) -- a thin Core-layer composition of the persisted contract
// state and the same deterministic naming confirm.ts itself uses, so the
// Git-layer guard never has to know how that name is derived.
function expectedMilestoneBranch(root: string, milestoneId: string): string | null {
  const contract = loadContract(root, milestoneId);
  const { base_branch: baseBranch, title } = contract.frontmatter;
  return baseBranch != null ? deterministicBranchName(milestoneId, title) : null;
}

// AC005/T005 (M012): the milestone's own base_revision, when tracked, to
// bound trailer lookups -- undefined (unbounded, today's exact behavior)
// under main strategy or when no base_revision is recorded.
function milestoneSince(root: string, milestoneId: string): string | undefined {
  return loadContract(root, milestoneId).frontmatter.base_revision ?? undefined;
}

export class TaskUpdateError extends Error {}

export interface TaskUpdateInputs {
  // M029/T003 (AC003): runtime-reported driver/model traceability, stored in
  // PitWay-owned evidence (tasks.yaml) -- never added to Git trailers.
  driver?: string;
  model?: string;
  resultPath?: string;
  messagePath?: string;
  // Measured token usage as a JSON string: {input_tokens?, output_tokens?, total_tokens}.
  usage?: string;
  // Explicit task-verify evidence record id (T002/AC001). Absent means
  // implicit selection (the newest matching record for this milestone+task)
  // still runs -- absence is not "skip evidence entirely".
  evidenceId?: string;
}

export interface TaskUpdateView {
  id: string;
  status: TaskStatus;
  attempts: number | null;
  outcome: 'updated' | 'committed' | 'already-committed';
  commit: string | null;
  // M017/T003 (AC005): additive -- non-null only on a fresh completion of a
  // task that was worktree-dispatched at least once and received no
  // --usage. Detection only (never estimated); an inline sub-agent dispatch
  // leaves no journal record, so it is indistinguishable from driver-
  // executed work and never warns.
  usageWarning: string | null;
}

const resultSchema = z.strictObject({
  summary: z.string().min(1),
  evidence: z.string().min(1),
});

type TaskResult = z.infer<typeof resultSchema>;

// AC006: worker reports stay concise and machine-readable -- summary/
// evidence are bounded at a fixed character length rather than allowed to
// grow unbounded, reusing T001's shared trimTail helper (a preserved,
// tail-anchored truncation) instead of inventing a second scheme. The cap
// only ever applies to a fresh --result write (parseResultInput, below);
// the completed/re-entry path in completeTask reads task.result as already
// persisted and never re-parses or rewrites it.
const SUMMARY_CAP = 300;
const EVIDENCE_CAP = 1000;
const TRUNCATION_MARKER = '[truncated] ';

function capField(value: string, cap: number): string {
  if (value.length <= cap) return value;
  const budget = Math.max(0, cap - TRUNCATION_MARKER.length);
  return `${TRUNCATION_MARKER}${trimTail(value, { cap: budget, lines: Number.MAX_SAFE_INTEGER })}`;
}

// Directory names are assigned once at creation and never renamed (AC007),
// so resolving against the current on-disk listing is correct even when
// looking up content at a past commit via git show.
const tasksRepoPath = (root: string, milestoneId: string): string =>
  `.pitway/milestones/${resolveMilestoneDirName(root, milestoneId)}/tasks.yaml`;

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
  return {
    summary: capField(parsed.data.summary, SUMMARY_CAP),
    evidence: capField(parsed.data.evidence, EVIDENCE_CAP),
  };
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

// Mirrors src/core/tasks/verify.ts's own normalizeRepoRelativePath (itself a
// local copy of src/core/verification/repair.ts's convention) -- written
// locally rather than imported, matching this codebase's established
// per-task duplication of small helpers rather than a cross-task dependency
// on a sibling module for a five-line function.
function normalizeRepoRelativePath(root: string, inputPath: string): string {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(root, inputPath);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(resolvedRoot + sep)) {
    throw new TaskUpdateError(`declared path resolves outside the repository: ${inputPath}`);
  }
  return relative(resolvedRoot, resolvedPath).split(sep).join('/');
}

// Mirrors verify.ts's buildFingerprint exactly (same declared-path sort,
// same present/missing marker logic, same MISSING_HASH_MARKER import) so a
// freshly recomputed fingerprint is directly comparable, entry-for-entry,
// against a record's persisted one.
function buildFingerprint(root: string, declaredPaths: string[]): JournalTaskVerifyFingerprintEntry[] {
  return [...declaredPaths].sort().map((relPath) => {
    const abs = resolve(root, relPath);
    if (!existsSync(abs)) {
      return { path: relPath, state: 'missing', hash: MISSING_HASH_MARKER };
    }
    const content = readFileSync(abs);
    return {
      path: relPath,
      state: 'present',
      hash: `sha256:${createHash('sha256').update(content).digest('hex')}`,
    };
  });
}

// M030/T001 (AC001): a record's execution outcome alone, independent of
// staleness -- shared by validateTaskVerifyEvidence's pass/fail check below
// and resolveTaskVerifyEvidence's backward search, so the two never define
// "passing" differently.
function isExecutionPassing(record: JournalTaskVerifyEvidence): boolean {
  const typecheckFailed = record.typecheck !== undefined && record.typecheck.exitCode !== 0;
  return record.terminationReason === 'exited' && record.exitCode === 0 && !typecheckFailed;
}

// Selection-then-validate (T002/AC001): validates a single already-selected
// candidate record, naming exactly what differs on any mismatch -- never
// falling back to search for an older record that happens to match.
function validateTaskVerifyEvidence(root: string, task: Task, record: JournalTaskVerifyEvidence): void {
  if (record.taskId !== task.id) {
    throw new TaskUpdateError(
      `evidence record ${record.id} is stale: task mismatch (recorded for ${record.taskId}, current task ${task.id})`,
    );
  }
  if (!isExecutionPassing(record)) {
    const typecheckFailed = record.typecheck !== undefined && record.typecheck.exitCode !== 0;
    throw new TaskUpdateError(
      `evidence record ${record.id} represents a failing run (terminationReason=${record.terminationReason}, ` +
        `exitCode=${record.exitCode}${typecheckFailed ? `, typecheck.exitCode=${record.typecheck?.exitCode}` : ''})`,
    );
  }
  const currentAttempts = task.attempts ?? 0;
  if (record.attempts !== currentAttempts) {
    throw new TaskUpdateError(
      `evidence record ${record.id} is stale: attempt mismatch (recorded ${record.attempts}, current ${currentAttempts})`,
    );
  }
  if (record.command !== task.verification.detail) {
    throw new TaskUpdateError(
      `evidence record ${record.id} is stale: command mismatch (recorded "${record.command}", ` +
        `current "${task.verification.detail}")`,
    );
  }
  const declared = new Set(
    (task.write_scope ?? task.relevant_files ?? []).map((p) => normalizeRepoRelativePath(root, p)),
  );
  const recordPaths = new Set(record.fingerprint.entries.map((e) => e.path));
  const declaredList = [...declared].sort();
  const recordList = [...recordPaths].sort();
  if (declared.size !== recordPaths.size || declaredList.some((p, i) => p !== recordList[i])) {
    throw new TaskUpdateError(
      `evidence record ${record.id} is stale: write_scope mismatch (declared ${declaredList.join(', ')}, ` +
        `evidence covers ${recordList.join(', ')})`,
    );
  }
  const fresh = buildFingerprint(root, declaredList);
  const freshByPath = new Map(fresh.map((e) => [e.path, e]));
  for (const entry of record.fingerprint.entries) {
    const current = freshByPath.get(entry.path);
    if (current === undefined || current.hash !== entry.hash || current.state !== entry.state) {
      throw new TaskUpdateError(
        `evidence record ${record.id} is stale: fingerprint mismatch for ${entry.path} ` +
          `(recorded ${entry.state}/${entry.hash}, current ${current?.state ?? 'absent'}/${current?.hash ?? 'absent'})`,
      );
    }
  }
}

// Implicit (M030/T001, AC001): matches are searched newest-to-oldest by
// append order for the first record whose *execution* passed
// (isExecutionPassing) -- so a later execution-failing record never masks
// an earlier execution-passing one. That single candidate then undergoes
// the same validateTaskVerifyEvidence staleness check as before; a
// staleness mismatch on it still refuses immediately, citing that record --
// the backward search never crosses into staleness, it only skips
// execution-failing records. When no record's execution passed at all,
// falls through to the newest record's own failing-run error, matching
// today's behavior. Explicit (--evidence <id>): the id alone is the lookup
// key, never a milestone/task filter, and never a backward search -- an
// unknown id is its own distinct refusal, separate from a found-but-
// diverged record's mismatch refusal. No record at all (implicit, nothing
// matches; explicit, never supplied) falls through to the existing
// --result/--message path unchanged.
function resolveTaskVerifyEvidence(
  root: string,
  milestoneId: string,
  task: Task,
  evidenceId: string | undefined,
): JournalTaskVerifyEvidence | undefined {
  const records = readJournal(root);
  const isEvidence = (r: (typeof records)[number]): r is JournalTaskVerifyEvidence =>
    r.kind === 'task_verify_evidence';

  if (evidenceId !== undefined) {
    const matches = records.filter((r) => isEvidence(r) && r.id === evidenceId) as JournalTaskVerifyEvidence[];
    const record = matches.length > 0 ? matches[matches.length - 1] : undefined;
    if (record === undefined) {
      throw new TaskUpdateError(`unknown evidence id: ${evidenceId}`);
    }
    validateTaskVerifyEvidence(root, task, record);
    return record;
  }

  const matches = records.filter(
    (r) => isEvidence(r) && r.milestone === milestoneId && r.taskId === task.id,
  ) as JournalTaskVerifyEvidence[];
  if (matches.length === 0) return undefined;

  const passing = [...matches].reverse().find(isExecutionPassing);
  // matches.length > 0 was just checked above, so the fallback index is
  // always in bounds; the non-null assertion documents that invariant for
  // noUncheckedIndexedAccess rather than widening selected's type.
  const selected = passing ?? matches[matches.length - 1]!;
  validateTaskVerifyEvidence(root, task, selected);
  return selected;
}

// AC007 (M013): evidence-honest labeling for a completed task -- there is no
// field on the task record itself distinguishing a task-verify-backed
// completion from a plain --result/--message one; provenance lives only in
// the append-only journal. True only when a task_verify_evidence record for
// this exact milestone+task carries the same evidence text now persisted in
// task.result -- proving the currently-recorded result actually came from
// that record, not merely that a verify run happened at some point.
// Deliberately does not call validateTaskVerifyEvidence -- this is a
// historical-provenance check on an already-completed task, not a
// freshness/staleness gate on a not-yet-completed one.
export function hasVerifiedEvidence(root: string, milestoneId: string, task: Task): boolean {
  if (task.result === null) return false;
  const records = readJournal(root).filter(
    (r): r is JournalTaskVerifyEvidence =>
      r.kind === 'task_verify_evidence' && r.milestone === milestoneId && r.taskId === task.id,
  );
  return records.some((r) => r.evidence === task.result!.evidence);
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
  const since = milestoneSince(root, milestoneId);
  const sha = resolveCommitSha(root, {
    milestone: milestoneId,
    task: taskId,
    ...(since !== undefined ? { since } : {}),
  });
  if (sha === undefined) return undefined;
  let record: CommittedTaskRecord | undefined;
  try {
    const data = parse(git(['show', `${sha}:${tasksRepoPath(root, milestoneId)}`], root)) as {
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

// M017/T003 (AC005): fresh-completion-only detection -- a task with no
// worktree_dispatch record at all (never dispatched, or an inline sub-agent
// dispatch that leaves none) never warns; supplying --usage always
// suppresses it regardless of dispatch history.
// B019 (qc-f0f57dfa): warning is actionable -- it names the dispatch.md MUST
// rule (forward the sub-agent tool-result usage via --usage).
// B033 (qc-20ca12b6): the fallback this used to name -- pitway usage-add
// <id> --category task -- never existed (usage-add only supports
// milestone-level planning|qa; task-amend cannot touch usage either).
// There is genuinely no retroactive path once a task completes without
// --usage, so the warning says that plainly instead of pointing at a
// dead-end command.
function computeUsageWarning(
  root: string,
  milestoneId: string,
  taskId: string,
  usageProvided: boolean,
): string | null {
  if (usageProvided) return null;
  const wasWorktreeDispatched = readJournal(root).some(
    (r) => r.kind === 'worktree_dispatch' && r.milestone === milestoneId && r.taskId === taskId,
  );
  if (!wasWorktreeDispatched) return null;
  return (
    `${taskId} was completed after a worktree dispatch with no --usage supplied; ` +
    `its usage stays null -> N/A (detection only, never estimated). ` +
    `Forward the dispatched sub-agent's reported usage via --usage on this completing call per dispatch.md step 8 -- ` +
    `this cannot be added retroactively once the task is completed; if the usage is genuinely unavailable, null is correct`
  );
}

function completeTask(
  root: string,
  milestoneId: string,
  tasksFile: TasksFile,
  task: Task,
  inputs: TaskUpdateInputs,
): TaskUpdateView {
  const tasksPath = tasksRepoPath(root, milestoneId);
  // write_scope (M005/T003) is the enforced completion-staging boundary when
  // present; relevant_files is the legacy fallback for tasks that still use
  // the old-style single field (M001-M005, and any future task that omits
  // write_scope). A task never carries both (schema-enforced), so this is a
  // straight either/or, not a merge.
  //
  // Any usage.yaml/contract.md already materialized by a pending journal
  // entry (usage-add / milestone-confirm --amend, both immediate-write, no
  // commit of their own — see src/core/metrics/aggregate.ts and
  // src/core/milestones/confirm.ts) is expected to ride along in this
  // completion commit rather than being refused as unrelated dirt.
  const journalExpected = classifyDirtyPaths(root, {
    journalMilestone: milestoneId,
    // B029: same rationale as the in_progress transition above -- a prior
    // verify run's dirty verification-results.yaml/verification-repairs.yaml
    // rides along into this completion commit rather than refusing it.
    pendingTransitionPaths: [
      verificationResultsRepoPath(root, milestoneId),
      verificationRepairsRepoPath(root, milestoneId),
    ],
  }).expected;
  const expectedPaths = [
    ...new Set([...(task.write_scope ?? task.relevant_files ?? []), tasksPath, ...journalExpected]),
  ];
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
      // Safe/idempotent regardless of whether this commit was the one that
      // actually captured a pending journal entry — reconcilePending derives
      // that from HEAD's content itself.
      reconcilePending(root, milestoneId);
      return {
        id: task.id,
        status: 'completed',
        attempts,
        outcome: 'already-committed',
        commit: existing,
        usageWarning: null,
      };
    }
    if (inputs.messagePath === undefined) {
      throw new TaskUpdateError(
        `completion commit for ${task.id} is pending; resupply --message to resume`,
      );
    }
    assertOnMilestoneBranch(root, expectedMilestoneBranch(root, milestoneId));
    const committed = commitOrResume(root, {
      expectedPaths,
      findExistingCommit: () => findCompletionCommit(root, milestoneId, task.id, persisted),
      localStateAdvanced: true,
      message: composeMessage(readInput(inputs.messagePath, 'message'), trailers),
    });
    reconcilePending(root, milestoneId);
    return {
      id: task.id,
      status: 'completed',
      attempts,
      outcome: committed.outcome,
      commit: committed.sha,
      usageWarning: null,
    };
  }

  // AC013: the pure state machine gates completion before anything else.
  transitionTask(task.status, 'completed');
  const candidateSince = milestoneSince(root, milestoneId);
  const candidate = resolveCommitSha(root, {
    milestone: milestoneId,
    task: task.id,
    ...(candidateSince !== undefined ? { since: candidateSince } : {}),
  });
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
  // AC003/T003 (M012): checked before tasks.yaml is written too -- a
  // wrong-branch attempt leaves nothing dirty, not even the state write.
  assertOnMilestoneBranch(root, expectedMilestoneBranch(root, milestoneId));

  // T002/AC001: when a valid task-verify evidence record is resolved (implicit
  // or explicit --evidence), its captured evidence unconditionally replaces
  // whatever evidence text --result's file carried -- a plain precedence
  // rule, never a conflict check. --result's summary is always used as given.
  const evidenceRecord = resolveTaskVerifyEvidence(root, milestoneId, task, inputs.evidenceId);
  const finalResult: TaskResult =
    evidenceRecord === undefined ? result : { summary: result.summary, evidence: evidenceRecord.evidence };

  const completed: Task = {
    ...task,
    status: 'completed',
    result: finalResult,
    usage: accumulateUsage(task.usage, usageDelta),
    // M029/T003 (AC003): traceability metadata accepted on the completing
    // transition too -- same validation, never reaching Git trailers.
    ...(inputs.driver !== undefined
      ? (inputs.driver.length < 1 || inputs.driver.length > 80
          ? (() => { throw new TaskUpdateError('--driver must be a string of 1..80 characters'); })()
          : { driver: inputs.driver })
      : {}),
    ...(inputs.model !== undefined
      ? (inputs.model.length < 1 || inputs.model.length > 80
          ? (() => { throw new TaskUpdateError('--model must be a string of 1..80 characters'); })()
          : { model: inputs.model })
      : {}),
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
    findExistingCommit: () => findCompletionCommit(root, milestoneId, task.id, finalResult),
    localStateAdvanced: true,
    message: composeMessage(message, trailers),
  });
  reconcilePending(root, milestoneId);
  const usageWarning = computeUsageWarning(root, milestoneId, task.id, inputs.usage !== undefined);
  return {
    id: task.id,
    status: 'completed',
    attempts,
    outcome: committed.outcome,
    commit: committed.sha,
    usageWarning,
  };
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

  // AC008/T008 (M014): a dispatched task's only legal exits from the main
  // root are task-integrate and task-discard until its dispatch record is
  // closed -- any direct status change (blocked included) would bypass the
  // worktree lifecycle and strand the worktree/branch. The circular import
  // with dispatch.ts is call-time-only (dispatch.ts calls updateTask, this
  // calls deriveLiveDispatches; neither at module evaluation).
  const liveDispatch = deriveLiveDispatches(readJournal(root), milestoneId).find(
    (d) => d.taskId === taskId,
  );
  if (liveDispatch !== undefined) {
    throw new TaskUpdateError(
      `task ${taskId} has a live worktree dispatch (${liveDispatch.id}); ` +
        `close it first with task-integrate ${taskId} or task-discard ${taskId} — ` +
        `direct status changes would strand its worktree`,
    );
  }

  if (target === 'completed') {
    return completeTask(root, milestoneId, tasksFile, task, inputs);
  }

  // AC013: every transition passes through the pure state machine; an illegal
  // transition throws (naming the allowed targets) before anything is written.
  const next = transitionTask(task.status, target);
  const updated: Task = { ...task, status: next };
  // M029/T003: attach/refresh traceability metadata on any non-completion
  // transition when supplied; absent flags leave prior values untouched.
  if (inputs.driver !== undefined) {
    if (inputs.driver.length < 1 || inputs.driver.length > 80) {
      throw new TaskUpdateError('--driver must be a string of 1..80 characters');
    }
    updated.driver = inputs.driver;
  }
  if (inputs.model !== undefined) {
    if (inputs.model.length < 1 || inputs.model.length > 80) {
      throw new TaskUpdateError('--model must be a string of 1..80 characters');
    }
    updated.model = inputs.model;
  }
  if (target === 'in_progress') {
    // AC014/M005-T004: execution starts here — the tree must be clean except
    // tasks.yaml and any path already materialized by a pending journal entry
    // for THIS milestone (a contract/usage/task amendment recorded between
    // tasks — see src/state/journal.ts). Without this, an amendment
    // materialized while no task is in_progress would strand the milestone:
    // it has no commit of its own, and no other task could ever start to
    // reach the completion checkpoint that would fold it in. Attempts
    // increments exactly once per (re)start, deterministically.
    //
    // M030/T002 (AC002): a RETRY into in_progress -- from review (recovery),
    // or from ready after failed/blocked -- carries genuinely dirty
    // write_scope/relevant_files from the task's own prior, uncommitted
    // attempt (none of review/failed/blocked ever commit). taskAttempts > 0
    // is true exactly on a retry (attempts is immutable outside this one
    // increment, per task-amend's AMENDABLE_FIELDS), so it uniformly grants
    // the task's own declared paths expected-dirty status via
    // classifyDirtyPaths' purpose-built taskWriteScope/verifiedCleanStart
    // option, without needing to know which prior status led here. A
    // genuine first attempt (taskAttempts === 0) keeps verifiedCleanStart
    // false, leaving this guarantee exactly as strict as before.
    const taskAttempts = task.attempts ?? 0;
    const classified = classifyDirtyPaths(root, {
      journalMilestone: milestoneId,
      taskWriteScope: task.write_scope ?? task.relevant_files ?? [],
      verifiedCleanStart: taskAttempts > 0,
      // B029: a `pitway verify` run between tasks leaves verification-
      // results.yaml (and, mid-repair, verification-repairs.yaml) dirty
      // with no journal entry of its own (deliberately -- see journal.ts) --
      // always expected here, never gated on write_scope/verifiedCleanStart.
      pendingTransitionPaths: [
        verificationResultsRepoPath(root, milestoneId),
        verificationRepairsRepoPath(root, milestoneId),
      ],
    });
    assertDirtySubset(root, [tasksRepoPath(root, milestoneId), ...classified.expected]);
    updated.attempts = taskAttempts + 1;
  }
  // AC017: every non-completion write touches tasks.yaml only and never commits.
  persistTask(root, milestoneId, tasksFile, updated);
  return {
    id: task.id,
    status: next,
    attempts: updated.attempts ?? null,
    outcome: 'updated',
    commit: null,
    usageWarning: null,
  };
}
