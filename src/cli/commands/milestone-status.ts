import type { Command } from 'commander';
import { loadContract, loadTasks } from '../../state/store.js';
import { computeMilestoneProgress, type MilestoneProgress } from '../../core/milestones/progress.js';
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
  tasks: Array<{ id: string; status: TaskStatus }>;
}

export function buildMilestoneStatusView(root: string, milestoneId: string): MilestoneStatusView {
  const contract = loadContract(root, milestoneId);
  const tasksFile = loadTasks(root, milestoneId);
  return {
    id: contract.frontmatter.id,
    title: contract.frontmatter.title,
    status: contract.frontmatter.status,
    progress: computeMilestoneProgress(tasksFile.tasks),
    baselineSha: resolveCommitSha(root, { milestone: milestoneId }) ?? null,
    tasks: tasksFile.tasks.map((t) => ({ id: t.id, status: t.status })),
  };
}

export function renderMilestoneStatusHuman(view: MilestoneStatusView): string {
  const lines = [
    `🏁 Milestone ${view.id} — ${view.title}`,
    '',
    `Status: ${view.status}`,
    `Progress: ${view.progress.completed}/${view.progress.total} required tasks completed`,
    `Baseline: ${view.baselineSha ?? 'N/A'}`,
    '',
    '🛠 Tasks',
  ];
  for (const t of view.tasks) {
    lines.push(`  ${t.id}  ${taskStatusLabel(t.status)}`);
  }
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
