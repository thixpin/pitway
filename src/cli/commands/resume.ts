import type { Command } from 'commander';
import { currentBranch } from '../../git/branch.js';
import { deterministicBranchName } from '../../core/milestones/confirm.js';
import { computeMilestoneProgress } from '../../core/milestones/progress.js';
import { computeRacingFooter, resolveNextTask } from '../../core/milestones/footer.js';
import { allChecksPassed, computeLatestCheckResults } from '../../core/verification/status.js';
import { loadConfig, loadContract, loadReviews, loadState, loadTasks } from '../../state/store.js';
import { deriveQuickChangeState, readAllQuickChanges } from '../../core/quick-change/create.js';
import { deriveLiveDispatches } from '../../core/tasks/dispatch.js';
import { deriveLatestFindingsByRole } from '../../core/reviews/roles.js';
import { listTaskWorktrees } from '../../git/worktree.js';
import { renderOutput } from '../output.js';
import { taskStatusLabel } from '../format.js';
import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { resolveExecutionStrategy, type MilestoneStatus, type Task, type TaskStatus } from '../../state/schemas.js';
import { readJournal, type JournalQuickChange, type JournalQuickChangeStatus } from '../../state/journal.js';

export interface PendingQuickChange {
  id: string;
  status: JournalQuickChangeStatus;
  objective: string;
}

// AC004/T004 (M012): present only when the active milestone tracks a branch
// (base_branch non-null under branch_strategy: milestone) -- absent, not
// merely blank, for a main-strategy or untracked milestone.
export interface ResumeBranchView {
  expected: string;
  actual: string;
  matches: boolean;
}

// AC008/T008 (M014): read-only residue classification under
// parallel_worktrees. Every abnormal dispatch/worktree combination a crash
// can leave behind maps to exactly one class here, so resume can always
// NAME the state -- it never removes anything.
export interface DispatchResidue {
  class:
    | 'vanished-worktree' // live record, worktree missing -> task-discard
    | 'recordless-worktree' // managed-prefix worktree, no record -> inspect manually
    | 'cleanup-pending' // record closed, worktree/branch survives -> re-run task-integrate (or task-discard)
    | 'inline-or-interrupted'; // in_progress task without a dispatch record -- legitimate inline work and a crash between transition and journal-append are indistinguishable
  taskId: string | null;
  path: string | null;
  detail: string;
}

export interface ParallelView {
  activeDispatches: Array<{ taskId: string; branch: string; worktreePath: string }>;
  residues: DispatchResidue[];
}

export interface ResumeView {
  activeMilestone: string | null;
  contractStatus: MilestoneStatus | null;
  title: string | null;
  tasks: Array<{ id: string; name: string | null; status: TaskStatus }>;
  ready: string[];
  waiting: string[];
  blocked: string[];
  inProgress: string[];
  nextTask: string | null;
  pendingQuickChanges: PendingQuickChange[];
  branch?: ResumeBranchView;
  // AC008 (M014): null for sequential repositories (key always present) --
  // human output there is byte-identical to before.
  parallel: ParallelView | null;
  // AC004 (M013): null before milestone-confirm has run -- silence is the
  // signal, never a placeholder string.
  footer: string | null;
  // AC006/T006 (M015): present only when the active milestone has an OPEN
  // review session -- the same authoritative-recovery-view discipline as
  // pendingQuickChanges. Additive --json key; absent (never null) keeps the
  // no-session JSON output byte-identical to before this milestone.
  openReview?: OpenReviewView;
}

export interface OpenReviewView {
  milestone: string;
  sessionId: string;
  roles: string[];
  recordedCount: number;
  pendingCount: number;
}

function idsWithStatus(tasks: Task[], status: TaskStatus): string[] {
  return tasks.filter((t) => t.status === status).map((t) => t.id);
}

// AC003: `pitway resume` is the authoritative recovery view for a pending
// quick-change -- a fresh session must discover and be able to act on one
// from resume's own output alone, with no separate `quick-change status`
// call required. "Actionable" mirrors the still-open portion of
// JournalQuickChangeStatus: draft/approved always qualify; a record with a
// recorded run attempt but not yet committed/cancelled/promoted would also
// qualify, though under today's lifecycle (run only ever transitions a
// still-approved record) that case never actually arises separately from
// the approved check above -- kept explicit anyway per AC003's own wording,
// and so this stays correct if a future lifecycle change ever decouples
// runs from status.
function isActionable(record: JournalQuickChange): boolean {
  if (record.status === 'draft' || record.status === 'approved') return true;
  return (
    record.runs.length > 0 &&
    record.status !== 'committed' &&
    record.status !== 'cancelled' &&
    record.status !== 'promoted'
  );
}

function derivePendingQuickChanges(root: string): PendingQuickChange[] {
  const all = readAllQuickChanges(root);
  const ids = Array.from(new Set(all.map((r) => r.id)));
  const pending: PendingQuickChange[] = [];
  for (const id of ids) {
    const latest = deriveQuickChangeState(all, id);
    if (latest !== undefined && isActionable(latest)) {
      pending.push({ id: latest.id, status: latest.status, objective: latest.objective });
    }
  }
  return pending;
}

// Journal records carry the path as the dispatcher wrote it while git's
// porcelain output reports the canonical form (macOS /var vs /private/var)
// -- canonicalize both sides before comparing. A vanished path canonicalizes
// through its (existing) parent directory.
function canonicalPath(p: string): string {
  if (existsSync(p)) return realpathSync(p);
  const dir = dirname(p);
  return existsSync(dir) ? join(realpathSync(dir), basename(p)) : resolve(p);
}

// AC008/T008: pure classification over already-read records + the actual
// worktree listing. Read-only -- resume never removes anything.
function buildParallelView(root: string, milestoneId: string, tasks: Task[]): ParallelView {
  const records = readJournal(root);
  const live = deriveLiveDispatches(records, milestoneId);
  const liveByPath = new Map(live.map((d) => [canonicalPath(d.worktreePath), d]));
  const worktrees = listTaskWorktrees(root);
  const residues: DispatchResidue[] = [];

  for (const dispatch of live) {
    if (!existsSync(dispatch.worktreePath)) {
      residues.push({
        class: 'vanished-worktree',
        taskId: dispatch.taskId,
        path: dispatch.worktreePath,
        detail: `live dispatch ${dispatch.id} for ${dispatch.taskId} has no worktree on disk — close it with task-discard ${dispatch.taskId}`,
      });
    }
  }

  const recordedPaths = new Set(
    records.filter((r) => r.kind === 'worktree_dispatch').map((r) => canonicalPath(r.worktreePath)),
  );
  for (const wt of worktrees) {
    if (!recordedPaths.has(canonicalPath(wt.path))) {
      residues.push({
        class: 'recordless-worktree',
        taskId: wt.marker?.task ?? null,
        path: wt.path,
        detail: `worktree ${wt.path} has no dispatch record — foreign or pre-crash; inspect manually`,
      });
    } else if (!liveByPath.has(canonicalPath(wt.path)) && existsSync(wt.path)) {
      residues.push({
        class: 'cleanup-pending',
        taskId: wt.marker?.task ?? null,
        path: wt.path,
        detail: `worktree ${wt.path} belongs to a closed dispatch — re-run task-integrate (or task-discard) to finish cleanup`,
      });
    }
  }

  const liveTaskIds = new Set(live.map((d) => d.taskId));
  for (const t of tasks) {
    if (t.status === 'in_progress' && !liveTaskIds.has(t.id)) {
      residues.push({
        class: 'inline-or-interrupted',
        taskId: t.id,
        path: null,
        detail: `${t.id} is in_progress with no dispatch record — legitimate inline work and an interrupted dispatch are indistinguishable; continue inline or reset via task-update ${t.id} failed`,
      });
    }
  }

  return {
    activeDispatches: live
      .filter((d) => existsSync(d.worktreePath))
      .map((d) => ({ taskId: d.taskId, branch: d.branch, worktreePath: d.worktreePath })),
    residues,
  };
}

// Reads only .pitway/ — no conversation or session input required. When
// multiple tasks are ready, recommends the lowest task id (declared order),
// deterministically, with no other prioritization in MVP.
export function buildResumeView(root: string): ResumeView {
  const pendingQuickChanges = derivePendingQuickChanges(root);
  const state = loadState(root);
  if (!state.active_milestone) {
    return {
      activeMilestone: null,
      contractStatus: null,
      title: null,
      tasks: [],
      ready: [],
      waiting: [],
      blocked: [],
      inProgress: [],
      nextTask: null,
      pendingQuickChanges,
      parallel: null,
      footer: null,
    };
  }

  const contract = loadContract(root, state.active_milestone);
  const tasksFile = loadTasks(root, state.active_milestone);
  const ready = idsWithStatus(tasksFile.tasks, 'ready').sort();
  // AC010: an in_progress task is the continuation target and takes priority
  // over any ready recommendation; the lowest-ready-id pick applies only
  // when no task is in_progress. The state machine normally allows at most
  // one in_progress task, but pick the lowest id deterministically anyway.
  const inProgress = idsWithStatus(tasksFile.tasks, 'in_progress').sort();

  // AC004/T004: read-only orientation only -- never a git mutation of any
  // kind. Present only when this milestone tracks a branch.
  const { base_branch: baseBranch, title } = contract.frontmatter;
  const branch: ResumeBranchView | undefined =
    baseBranch != null
      ? (() => {
          const expected = deterministicBranchName(state.active_milestone!, title);
          const actual = currentBranch(root);
          return { expected, actual, matches: actual === expected };
        })()
      : undefined;

  const progress = computeMilestoneProgress(tasksFile.tasks);
  const verificationPassed = allChecksPassed(contract, computeLatestCheckResults(root, state.active_milestone));
  const footer = computeRacingFooter(contract.frontmatter.status, progress, verificationPassed, tasksFile.tasks);
  const parallel =
    resolveExecutionStrategy(loadConfig(root)) === 'parallel_worktrees'
      ? buildParallelView(root, state.active_milestone, tasksFile.tasks)
      : null;

  const openSession = loadReviews(root, state.active_milestone).sessions.find((s) => s.status === 'open');
  const openReview: OpenReviewView | undefined =
    openSession === undefined
      ? undefined
      : (() => {
          const recorded = deriveLatestFindingsByRole(openSession.findings).size;
          return {
            milestone: state.active_milestone!,
            sessionId: openSession.id,
            roles: openSession.roles,
            recordedCount: recorded,
            pendingCount: openSession.roles.length - recorded,
          };
        })();

  return {
    activeMilestone: state.active_milestone,
    contractStatus: contract.frontmatter.status,
    title: contract.frontmatter.title,
    tasks: tasksFile.tasks.map((t) => ({ id: t.id, name: t.name ?? null, status: t.status })),
    ready,
    waiting: idsWithStatus(tasksFile.tasks, 'waiting'),
    blocked: idsWithStatus(tasksFile.tasks, 'blocked'),
    inProgress,
    nextTask: resolveNextTask(tasksFile.tasks),
    pendingQuickChanges,
    ...(branch ? { branch } : {}),
    parallel,
    footer,
    ...(openReview ? { openReview } : {}),
  };
}

function renderPendingQuickChangesHuman(pending: PendingQuickChange[]): string[] {
  if (pending.length === 0) return [];
  const lines = ['🔧 Pending quick-changes'];
  for (const qc of pending) {
    lines.push(`  ${qc.id}  ${qc.status}  ${qc.objective}`);
  }
  return lines;
}

// The human-readable text output alone, with zero extra commands, must show
// a pending quick-change exists (AC003) -- so the pending-quick-change block
// is appended in both branches below, not gated behind an active milestone.
export function renderResumeHuman(view: ResumeView): string {
  const quickChangeLines = renderPendingQuickChangesHuman(view.pendingQuickChanges);

  if (!view.activeMilestone) {
    const lines = ['No active milestone. Run milestone-add to start one.'];
    if (quickChangeLines.length > 0) lines.push('', ...quickChangeLines);
    return lines.join('\n');
  }

  const lines = [
    `🏁 Resuming ${view.activeMilestone} — ${view.title}`,
    `Contract: ${view.contractStatus}`,
  ];
  if (view.branch) {
    lines.push(
      view.branch.matches
        ? `Branch: ${view.branch.actual} (tracked, checked out)`
        : `Branch mismatch: expected ${view.branch.expected}, currently on ${view.branch.actual} — switch manually`,
    );
  }
  lines.push('', '🛠 Tasks');
  for (const t of view.tasks) {
    lines.push(t.name !== null ? `  ${t.id}  ${t.name}  ${taskStatusLabel(t.status)}` : `  ${t.id}  ${taskStatusLabel(t.status)}`);
  }
  lines.push('');
  lines.push(`Ready: ${view.ready.join(', ') || '(none)'}`);
  lines.push(`Waiting: ${view.waiting.join(', ') || '(none)'}`);
  lines.push(`Blocked: ${view.blocked.join(', ') || '(none)'}`);
  lines.push(`In progress: ${view.inProgress.join(', ') || '(none)'}`);
  lines.push('');
  if (view.inProgress.length > 0) {
    // A task is already underway: report it as the continuation target
    // rather than as a ready-task recommendation.
    lines.push(`Continue: ${view.nextTask}`);
  } else {
    lines.push(view.nextTask ? `Next: ${view.nextTask}` : 'Next: (no ready task)');
  }
  if (view.parallel !== null) {
    if (view.parallel.activeDispatches.length > 0) {
      lines.push('', '🏎️ Dispatched worktrees');
      for (const d of view.parallel.activeDispatches) {
        lines.push(`  ${d.taskId}  ${d.branch}  ${d.worktreePath}`);
      }
    }
    if (view.parallel.residues.length > 0) {
      lines.push('', '🔧 Worktree residues (read-only report)');
      for (const r of view.parallel.residues) {
        lines.push(`  [${r.class}] ${r.detail}`);
      }
    }
  }
  if (quickChangeLines.length > 0) lines.push('', ...quickChangeLines);
  if (view.openReview !== undefined) {
    lines.push(
      '',
      `📜 Open review ${view.openReview.sessionId} (${view.openReview.milestone}) — ` +
        `roles: ${view.openReview.roles.join(', ')} — ` +
        `recorded ${view.openReview.recordedCount}/${view.openReview.roles.length}`,
    );
  }
  if (view.footer !== null) lines.push('', view.footer);
  return lines.join('\n');
}

export interface CommandDeps {
  root?: string;
  write?: (line: string) => void;
}

export function registerResumeCommand(program: Command, deps: CommandDeps = {}): void {
  const write = deps.write ?? ((line: string) => console.log(line));
  program
    .command('resume')
    .description('Reconstruct workflow state from .pitway/ and recommend the next task.')
    .option('--json', 'output machine-readable JSON')
    .action((options: { json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const view = buildResumeView(root);
      write(renderOutput(view, { json: options.json }, renderResumeHuman));
    });
}
