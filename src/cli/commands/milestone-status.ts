import type { Command } from 'commander';
import { loadContract, loadReviews, loadState, loadTasks, loadUsage } from '../../state/store.js';
import { computeReviewUsageTotal } from '../../core/reviews/roles.js';
import { readJournal } from '../../state/journal.js';
import { computeMilestoneProgress, type MilestoneProgress } from '../../core/milestones/progress.js';
import { computeRacingFooter, resolveNextTask } from '../../core/milestones/footer.js';
import { computeWorkloadPercentage } from '../../core/milestones/workload.js';
import { computeCriticalPath } from '../../core/tasks/critical-path.js';
import { hasVerifiedEvidence } from '../../core/tasks/update.js';
import { allChecksPassed, computeLatestCheckResults } from '../../core/verification/status.js';
import { aggregateUsage } from '../../core/metrics/aggregate.js';
import { resolveCommitSha } from '../../git/trailers.js';
import { renderOutput } from '../output.js';
import { taskStatusLabel } from '../format.js';
import { renderTable } from '../table.js';
import type { MilestoneStatus, ReviewsFile, Task, TaskStatus, UsageFile } from '../../state/schemas.js';

// UX-only (Claude Code command-discoverability quick-change): execution mode
// is read-only, derived from the journal's own worktree_integrate records —
// no new tracking, no new data source. Deliberately NOT a bare
// worktree_dispatch check: a dispatch later abandoned via task-discard
// leaves its worktree_dispatch record in the append-only journal forever,
// even though the task's real completed work landed entirely inline
// afterward (observed live: M017/T002-T006's first dispatch attempt failed
// and was discarded, then completed inline) -- worktree_integrate only
// exists for work that actually landed from a worktree. null for a task
// that hasn't reached in_progress yet (dispatch cannot have happened).
const NOT_YET_STARTED = new Set<TaskStatus>(['planned', 'waiting', 'ready', 'cancelled']);

function resolveExecutionMode(
  root: string,
  milestoneId: string,
  task: Task,
): 'inline' | 'worktree' | null {
  if (NOT_YET_STARTED.has(task.status)) return null;
  const integrated = readJournal(root).some(
    (r) => r.kind === 'worktree_integrate' && r.milestone === milestoneId && r.taskId === task.id,
  );
  return integrated ? 'worktree' : 'inline';
}

// Milestone-current-command quick-change: milestone-status's own separate
// --report flag/view is retired -- this is now the ONE view, carrying
// everything --report used to (workload/critical-path/token-breakdown/
// per-task label+tokens) plus the identity/state fields (id, status,
// baselineSha) the old plain view alone carried. No `mode` discriminant
// left: there is only one shape now.
export interface MilestoneStatusTaskRow {
  id: string;
  label: string;
  executionMode: 'inline' | 'worktree' | null;
  statusLabel: string;
  tokens: number | null;
}

// AC005: limited to the categories this project's own Token Telemetry Spike
// design record (docs/evidence/M009/token-accounting-feasibility.md)
// confirms are directly measured today -- deliberately no driver_overhead/
// orchestration-overhead figure (see the contract's Objective).
export interface TokenBreakdown {
  task: number | null;
  planning: number | null;
  qa: number | null;
  // B026: recorded milestone-review usage, summed across every session's
  // latest-per-role recording (computeReviewUsageTotal) -- null when no
  // review usage has ever been recorded for this milestone.
  review: number | null;
  total: number | null;
  missing: number;
}

export interface MilestoneStatusView {
  id: string;
  title: string;
  status: MilestoneStatus;
  baselineSha: string | null;
  workloadPercent: number;
  progress: MilestoneProgress;
  tokenTotal: number | null;
  missingUsageCount: number;
  tasks: MilestoneStatusTaskRow[];
  criticalPath: string[];
  activeTask: string | null;
  nextTask: string | null;
  tokenBreakdown: TokenBreakdown;
  // AC004 (M013): null before milestone-confirm has run.
  footer: string | null;
}

// Read-only marker for the id-omitted, no-active-milestone case: an answer,
// never a refusal -- exit 0, same convention as `pitway milestone-current`
// and `pitway resume`'s own "No active milestone" section (unlike
// verify/task-dispatch/task-amend's "no active milestone; pass an id
// explicitly" throw, which fits an action that genuinely cannot proceed
// without a target -- milestone-status only ever displays).
export interface MilestoneStatusInactiveView {
  active: false;
}

const LABEL_TRUNCATE_LENGTH = 60;

// AC005: name when present (AC001/AC002), else objective truncated to 60
// chars with a trailing ellipsis when cut -- never the bare id alone.
function taskLabel(task: Task): string {
  if (task.name !== undefined) return task.name;
  return task.objective.length > LABEL_TRUNCATE_LENGTH
    ? `${task.objective.slice(0, LABEL_TRUNCATE_LENGTH)}…`
    : task.objective;
}

// AC007: "completed · verified" only when a real task_verify_evidence
// journal record backs this exact completion; plain "completed" otherwise;
// every other status via the existing taskStatusLabel, unchanged.
function taskStatusLabelForReport(root: string, milestoneId: string, task: Task): string {
  const base = taskStatusLabel(task.status);
  if (task.status !== 'completed') return base;
  return hasVerifiedEvidence(root, milestoneId, task) ? `${base} · verified` : base;
}

function computeTokenBreakdown(tasks: Task[], usage: UsageFile, reviews: ReviewsFile): TokenBreakdown {
  let taskTotal = 0;
  let taskMeasured = false;
  let missing = 0;
  for (const t of tasks) {
    if (t.usage === null) {
      missing += 1;
    } else {
      taskTotal += t.usage.total_tokens;
      taskMeasured = true;
    }
  }
  const planning = usage.planning !== null ? usage.planning.total_tokens : null;
  const qa = usage.qa !== null ? usage.qa.total_tokens : null;
  if (usage.planning === null) missing += 1;
  if (usage.qa === null) missing += 1;

  const reviewUsage = computeReviewUsageTotal(reviews);
  missing += reviewUsage.missing;

  const measured = taskMeasured || planning !== null || qa !== null || reviewUsage.total !== null;
  const total = measured ? taskTotal + (planning ?? 0) + (qa ?? 0) + (reviewUsage.total ?? 0) : null;

  return { task: taskMeasured ? taskTotal : null, planning, qa, review: reviewUsage.total, total, missing };
}

export function buildMilestoneStatusView(root: string, milestoneId: string): MilestoneStatusView {
  const contract = loadContract(root, milestoneId);
  const tasksFile = loadTasks(root, milestoneId);
  const usage = loadUsage(root, milestoneId);
  const reviews = loadReviews(root, milestoneId);
  // AC005/T005 (M012): bounds the search when this milestone tracks a
  // branch (base_revision non-null); unbounded (today's behavior) otherwise.
  const since = contract.frontmatter.base_revision ?? undefined;
  const progress = computeMilestoneProgress(tasksFile.tasks);
  const verificationPassed = allChecksPassed(contract, computeLatestCheckResults(root, milestoneId));
  const workloadPercent = computeWorkloadPercentage(contract.frontmatter.status, progress, verificationPassed);
  const aggregate = aggregateUsage(tasksFile.tasks, usage, reviews);
  const breakdown = computeTokenBreakdown(tasksFile.tasks, usage, reviews);
  const activeTask = tasksFile.tasks.find((t) => t.status === 'in_progress')?.id ?? null;

  return {
    id: contract.frontmatter.id,
    title: contract.frontmatter.title,
    status: contract.frontmatter.status,
    baselineSha:
      resolveCommitSha(root, { milestone: milestoneId, ...(since !== undefined ? { since } : {}) }) ?? null,
    workloadPercent,
    progress,
    tokenTotal: aggregate.totalTokens,
    missingUsageCount: aggregate.unmeasuredTasks,
    tasks: tasksFile.tasks.map((t) => ({
      id: t.id,
      label: taskLabel(t),
      executionMode: resolveExecutionMode(root, milestoneId, t),
      statusLabel: taskStatusLabelForReport(root, milestoneId, t),
      tokens: t.usage !== null ? t.usage.total_tokens : null,
    })),
    criticalPath: computeCriticalPath(tasksFile.tasks),
    activeTask,
    nextTask: resolveNextTask(tasksFile.tasks),
    tokenBreakdown: breakdown,
    footer: computeRacingFooter(contract.frontmatter.status, progress, verificationPassed, tasksFile.tasks),
  };
}

function renderTaskTable(tasks: MilestoneStatusView['tasks']): string[] {
  const headers = ['Task', 'Label', 'Execution', 'Status', 'Tokens'];
  const rows = tasks.map((t) => [
    t.id,
    t.label,
    t.executionMode ?? '—',
    t.statusLabel,
    formatTokenValue(t.tokens),
  ]);
  // B022: fixed-width padded columns, tokens right-aligned.
  return renderTable(headers, rows, { pad: true, align: ['left', 'left', 'left', 'left', 'right'] });
}

const formatTokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const formatTokenValue = (n: number | null): string => (n === null ? 'N/A' : formatTokens(n));

// UX-only: a fixed-width, no-color bar purely representing the same
// percentage `footer`/`workloadPercent` already carry — never a second
// progress calculation.
const PROGRESS_BAR_WIDTH = 20;

function renderProgressBar(percent: number): string {
  const clamped = Math.min(100, Math.max(0, percent));
  const filled = Math.round((clamped / 100) * PROGRESS_BAR_WIDTH);
  return `[${'█'.repeat(filled)}${'░'.repeat(PROGRESS_BAR_WIDTH - filled)}]`;
}

// Splices the bar between the footer's leading icon and its percentage —
// e.g. "🏎️ 77% · ..." becomes "🏎️ [███████████████░░░░░] 77% · ...". A pure
// string transform of the exact footer computeRacingFooter already
// produced; never re-derives the percent, count, or next-gate text.
function withProgressBar(footer: string, percent: number): string {
  return footer.replace(/^(\S+) /, `$1 ${renderProgressBar(percent)} `);
}

export function renderMilestoneStatusHuman(view: MilestoneStatusView): string {
  const lines = [
    `🏁 Milestone ${view.id} — ${view.title}`,
    '',
    `Status: ${view.status}`,
    `Baseline: ${view.baselineSha ?? 'N/A'}`,
    `Workload: ~${view.workloadPercent}% · ${view.progress.completed}/${view.progress.total} required tasks completed`,
    `Tokens: ${formatTokenValue(view.tokenTotal)} (${view.missingUsageCount} task${view.missingUsageCount === 1 ? '' : 's'} missing usage)`,
    '',
    ...renderTaskTable(view.tasks),
  ];
  lines.push('');
  lines.push(`Critical path: ${view.criticalPath.length > 0 ? view.criticalPath.join(' → ') : '(none)'}`);
  lines.push(`Active: ${view.activeTask ?? '(none)'}`);
  lines.push(`Next: ${view.nextTask ?? '(no ready task)'}`);
  lines.push('');
  lines.push('Token breakdown:');
  lines.push(`  task: ${formatTokenValue(view.tokenBreakdown.task)}`);
  lines.push(`  planning: ${formatTokenValue(view.tokenBreakdown.planning)}`);
  lines.push(`  qa: ${formatTokenValue(view.tokenBreakdown.qa)}`);
  lines.push(`  review: ${formatTokenValue(view.tokenBreakdown.review)}`);
  lines.push(`  total: ${formatTokenValue(view.tokenBreakdown.total)}`);
  lines.push(`  missing: ${view.tokenBreakdown.missing}`);
  if (view.footer !== null) lines.push('', withProgressBar(view.footer, view.workloadPercent));
  return lines.join('\n');
}

function renderMilestoneStatusOrInactiveHuman(view: MilestoneStatusView | MilestoneStatusInactiveView): string {
  if ('active' in view && view.active === false) return 'No active milestone.';
  return renderMilestoneStatusHuman(view as MilestoneStatusView);
}

export interface CommandDeps {
  root?: string;
  write?: (line: string) => void;
}

export function registerMilestoneStatusCommand(program: Command, deps: CommandDeps = {}): void {
  const write = deps.write ?? ((line: string) => console.log(line));
  program
    .command('milestone-status [id]')
    .alias('ms-status')
    .description(
      'Show the active milestone\'s status, contract, progress, and tasks -- or a named milestone\'s, ' +
        'active or not, when an id is given.',
    )
    .option('--json', 'output machine-readable JSON')
    .action((id: string | undefined, options: { json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const resolvedId = id ?? loadState(root).active_milestone;
      if (resolvedId === null) {
        write(renderOutput({ active: false }, { json: options.json }, renderMilestoneStatusOrInactiveHuman));
        return;
      }
      const view = buildMilestoneStatusView(root, resolvedId);
      write(renderOutput(view, { json: options.json }, renderMilestoneStatusOrInactiveHuman));
    });
}
