import type { Command } from 'commander';
import { loadContract, loadTasks, loadUsage } from '../../state/store.js';
import { computeMilestoneProgress, type MilestoneProgress } from '../../core/milestones/progress.js';
import { computeRacingFooter } from '../../core/milestones/footer.js';
import { allChecksPassed, computeLatestCheckResults } from '../../core/verification/status.js';
import { aggregateUsage, type UsageAggregate } from '../../core/metrics/aggregate.js';
import { resolveCommitSha } from '../../git/trailers.js';
import { renderOutput } from '../output.js';
import { taskStatusLabel } from '../format.js';
import type { MilestoneStatus, TaskStatus } from '../../state/schemas.js';

export interface MilestoneStatusView {
  id: string;
  title: string;
  status: MilestoneStatus;
  progress: MilestoneProgress;
  baselineSha: string | null;
  aggregate: UsageAggregate;
  tasks: Array<{ id: string; status: TaskStatus }>;
  // AC004 (M013): null before milestone-confirm has run.
  footer: string | null;
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
    tasks: tasksFile.tasks.map((t) => ({ id: t.id, status: t.status })),
    footer: computeRacingFooter(contract.frontmatter.status, progress, verificationPassed, tasksFile.tasks),
  };
}

const formatTokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

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

export function renderMilestoneStatusHuman(view: MilestoneStatusView): string {
  const lines = [
    `🏁 Milestone ${view.id} — ${view.title}`,
    '',
    `Status: ${view.status}`,
    `Progress: ${view.progress.completed}/${view.progress.total} required tasks completed`,
    `Baseline: ${view.baselineSha ?? 'N/A'}`,
    `Tokens: ${renderAggregate(view.aggregate)}`,
    '',
    '🛠 Tasks',
  ];
  for (const t of view.tasks) {
    lines.push(`  ${t.id}  ${taskStatusLabel(t.status)}`);
  }
  if (view.footer !== null) lines.push('', view.footer);
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
    .option('--json', 'output machine-readable JSON')
    .action((id: string, options: { json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const view = buildMilestoneStatusView(root, id);
      write(renderOutput(view, { json: options.json }, renderMilestoneStatusHuman));
    });
}
