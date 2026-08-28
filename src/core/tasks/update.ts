import { assertOnMilestoneBranch } from '../../git/branch.js';
import { commitOrResume } from '../../git/commit-or-resume.js';
import { checkWorkingTreeClean, classifyDirtyPaths } from '../../git/safety.js';
import { resolvePendingJournalTargets } from '../journal/pending-targets.js';
import { composeMessage, resolveCommitSha } from '../../git/trailers.js';
import { verificationRepairsRepoPath, verificationResultsRepoPath } from '../verification/repair.js';
import { readJournal, reconcilePending } from '../../state/journal.js';
import { taskStatusSchema, type Task, type TaskStatus, type TasksFile } from '../../state/schemas.js';
import { loadContract, loadState, loadTasks, saveTasks } from '../../state/store.js';
import { deterministicBranchName } from '../milestones/confirm.js';
import { findCompletionCommit, milestoneSince, tasksRepoPath } from './completion-commit.js';
import { resolveReadyTasks } from './dependencies.js';
import { deriveLiveDispatches } from './dispatch.js';
import { resolveTaskVerifyEvidence } from './evidence.js';
import { parseResultInput, readInput, type TaskResult } from './result-input.js';
import { transitionTask } from './state-machine.js';
import { TaskUpdateError } from './update-error.js';
import { accumulateUsage, computeUsageWarning, parseUsageInput } from './usage.js';

// M039/T001: this module is orchestration only -- the task state
// transitions and the completion commit. Evidence resolution lives in
// ./evidence.ts, --usage handling in ./usage.ts, --result parsing in
// ./result-input.ts, the completion-commit identity lookup in
// ./completion-commit.ts, and hasVerifiedEvidence in ./evidence.ts.
// TaskUpdateError is re-exported so existing importers keep working.
export { TaskUpdateError } from './update-error.js';

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
    journalTargetPaths: resolvePendingJournalTargets(root, milestoneId),
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
      journalTargetPaths: resolvePendingJournalTargets(root, milestoneId),
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
