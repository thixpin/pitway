import type { Command } from 'commander';
import { loadContract, loadTasks, loadUsage } from '../../state/store.js';
import { readJournal } from '../../state/journal.js';
import { computeMilestoneProgress, type MilestoneProgress } from '../../core/milestones/progress.js';
import { computeRacingFooter, resolveNextTask } from '../../core/milestones/footer.js';
import { computeWorkloadPercentage } from '../../core/milestones/workload.js';
import { computeCriticalPath } from '../../core/tasks/critical-path.js';
import { hasVerifiedEvidence } from '../../core/tasks/update.js';
import { allChecksPassed, computeLatestCheckResults } from '../../core/verification/status.js';
import { aggregateUsage, type UsageAggregate } from '../../core/metrics/aggregate.js';
import { resolveCommitSha } from '../../git/trailers.js';
import { renderOutput } from '../output.js';
import { taskStatusLabel } from '../format.js';
import type { MilestoneStatus, Task, TaskStatus, UsageFile } from '../../state/schemas.js';

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

export interface MilestoneStatusView {
  id: string;
  title: string;
  status: MilestoneStatus;
  progress: MilestoneProgress;
  baselineSha: string | null;
  aggregate: UsageAggregate;
  tasks: Array<{ id: string; status: TaskStatus; executionMode: 'inline' | 'worktree' | null }>;
  // AC004 (M013): null before milestone-confirm has run.
  footer: string | null;
  // UX-only additive field: the same percentage computeRacingFooter already
  // embeds in `footer`, exposed separately so the human renderer can draw a
  // progress bar without re-deriving it a second way.
  workloadPercent: number;
}

export function buildMilestoneStatusView(root: string, milestoneId: string): MilestoneStatusView {
  const contract = loadContract(root, milestoneId);
  const tasksFile = loadTasks(root, milestoneId);
  // AC005/T005 (M012): bounds the search when this milestone tracks a
  // branch (base_revision non-null); unbounded (today's behavior) otherwise.
  const since = contract.frontmatter.base_revision ?? undefined;
  const progress = computeMilestoneProgress(tasksFile.tasks);
  const verificationPassed = allChecksPassed(contract, computeLatestCheckResults(root, milestoneId));
  return {
    id: contract.frontmatter.id,
    title: contract.frontmatter.title,
    status: contract.frontmatter.status,
    progress,
    baselineSha: resolveCommitSha(root, { milestone: milestoneId, ...(since !== undefined ? { since } : {}) }) ?? null,
    aggregate: aggregateUsage(tasksFile.tasks, loadUsage(root, milestoneId)),
    tasks: tasksFile.tasks.map((t) => ({
      id: t.id,
      status: t.status,
      executionMode: resolveExecutionMode(root, milestoneId, t),
    })),
    footer: computeRacingFooter(contract.frontmatter.status, progress, verificationPassed, tasksFile.tasks),
    workloadPercent: computeWorkloadPercentage(contract.frontmatter.status, progress, verificationPassed),
  };
}

// AC005/AC007 (M013): on-demand structured Progress Report, reused entirely
// from data this milestone's other tasks already compute -- no new
// authoritative data source.
export interface ProgressReportTaskRow {
  id: string;
  label: string;
  executionMode: string | null;
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
  total: number | null;
  missing: number;
}

export interface ProgressReportView {
  mode: 'report';
  title: string;
  workloadPercent: number;
  progress: MilestoneProgress;
  tokenTotal: number | null;
  missingUsageCount: number;
  tasks: ProgressReportTaskRow[];
  criticalPath: string[];
  activeTask: string | null;
  nextTask: string | null;
  tokenBreakdown: TokenBreakdown;
  footer: string | null;
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

function computeTokenBreakdown(tasks: Task[], usage: UsageFile): TokenBreakdown {
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

  const measured = taskMeasured || planning !== null || qa !== null;
  const total = measured ? taskTotal + (planning ?? 0) + (qa ?? 0) : null;

  return { task: taskMeasured ? taskTotal : null, planning, qa, total, missing };
}

export function buildProgressReportView(root: string, milestoneId: string): ProgressReportView {
  const contract = loadContract(root, milestoneId);
  const tasksFile = loadTasks(root, milestoneId);
  const usage = loadUsage(root, milestoneId);
  const progress = computeMilestoneProgress(tasksFile.tasks);
  const verificationPassed = allChecksPassed(contract, computeLatestCheckResults(root, milestoneId));
  const workloadPercent = computeWorkloadPercentage(contract.frontmatter.status, progress, verificationPassed);
  const aggregate = aggregateUsage(tasksFile.tasks, usage);
  const breakdown = computeTokenBreakdown(tasksFile.tasks, usage);
  const activeTask = tasksFile.tasks.find((t) => t.status === 'in_progress')?.id ?? null;

  return {
    mode: 'report',
    title: contract.frontmatter.title,
    workloadPercent,
    progress,
    tokenTotal: aggregate.totalTokens,
    missingUsageCount: aggregate.unmeasuredTasks,
    tasks: tasksFile.tasks.map((t) => ({
      id: t.id,
      label: taskLabel(t),
      executionMode: null,
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

export function renderProgressReportHuman(view: ProgressReportView): string {
  const lines = [
    `📊 Progress Report — ${view.title}`,
    '',
    `Workload: ~${view.workloadPercent}% · ${view.progress.completed}/${view.progress.total} required tasks completed`,
    `Tokens: ${formatTokenValue(view.tokenTotal)} (${view.missingUsageCount} task${view.missingUsageCount === 1 ? '' : 's'} missing usage)`,
    '',
    '🛠 Tasks',
  ];
  for (const t of view.tasks) {
    const mode = t.executionMode !== null ? `  [${t.executionMode}]` : '';
    lines.push(`  ${t.id}  ${t.label}${mode}  ${t.statusLabel}  ${formatTokenValue(t.tokens)}`);
  }
  lines.push('');
  lines.push(`Critical path: ${view.criticalPath.length > 0 ? view.criticalPath.join(' → ') : '(none)'}`);
  lines.push(`Active: ${view.activeTask ?? '(none)'}`);
  lines.push(`Next: ${view.nextTask ?? '(no ready task)'}`);
  lines.push('');
  lines.push('Token breakdown:');
  lines.push(`  task: ${formatTokenValue(view.tokenBreakdown.task)}`);
  lines.push(`  planning: ${formatTokenValue(view.tokenBreakdown.planning)}`);
  lines.push(`  qa: ${formatTokenValue(view.tokenBreakdown.qa)}`);
  lines.push(`  total: ${formatTokenValue(view.tokenBreakdown.total)}`);
  lines.push(`  missing: ${view.tokenBreakdown.missing}`);
  if (view.footer !== null) lines.push('', view.footer);
  return lines.join('\n');
}

const formatTokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const formatTokenValue = (n: number | null): string => (n === null ? 'N/A' : formatTokens(n));

// AC009: measured and unavailable values are never blended — unmeasured tasks
// are surfaced as an explicit count, and "N/A" means nothing was measured.
function renderAggregate(aggregate: UsageAggregate): string {
  if (aggregate.totalTokens === null) return 'N/A';
  const suffix =
    aggregate.unmeasuredTasks > 0
      ? ` (${aggregate.unmeasuredTasks} task${aggregate.unmeasuredTasks === 1 ? '' : 's'} N/A)`
      : '';
  return `${formatTokens(aggregate.totalTokens)}${suffix}`;
}

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

function renderTaskTable(tasks: MilestoneStatusView['tasks']): string[] {
  const rows = tasks.map((t) => {
    const progress = t.status === 'completed' ? '100%' : '—';
    return `| ${t.id} | ${taskStatusLabel(t.status)} | ${progress} | ${t.executionMode ?? '—'} |`;
  });
  return ['| Task | Status | Progress | Execution |', '|------|--------|----------|-----------|', ...rows];
}

export function renderMilestoneStatusHuman(view: MilestoneStatusView): string {
  const lines = [
    `🏁 Milestone ${view.id} — ${view.title}`,
    '',
    `Status: ${view.status}`,
    `Progress: ${view.progress.completed}/${view.progress.total} required tasks completed`,
    `Baseline: ${view.baselineSha ?? 'N/A'}`,
    `Tokens: ${renderAggregate(view.aggregate)}`,
    '',
    ...renderTaskTable(view.tasks),
  ];
  if (view.footer !== null) lines.push('', withProgressBar(view.footer, view.workloadPercent));
  return lines.join('\n');
}

export interface CommandDeps {
  root?: string;
  write?: (line: string) => void;
}

export function registerMilestoneStatusCommand(program: Command, deps: CommandDeps = {}): void {
  const write = deps.write ?? ((line: string) => console.log(line));
  program
    .command('milestone-status <id>')
    .description('Show a milestone\'s status, contract, progress, and tasks.')
    .option('--report', 'render the full structured Progress Report instead of the default summary')
    .option('--json', 'output machine-readable JSON')
    .action((id: string, options: { report?: boolean; json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      if (options.report) {
        const view = buildProgressReportView(root, id);
        write(renderOutput(view, { json: options.json }, renderProgressReportHuman));
        return;
      }
      const view = buildMilestoneStatusView(root, id);
      write(renderOutput(view, { json: options.json }, renderMilestoneStatusHuman));
    });
}
