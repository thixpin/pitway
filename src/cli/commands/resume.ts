import type { Command } from 'commander';
import { loadContract, loadState, loadTasks } from '../../state/store.js';
import { renderOutput } from '../output.js';
import { taskStatusLabel } from '../format.js';
import type { MilestoneStatus, Task, TaskStatus } from '../../state/schemas.js';

export interface ResumeView {
  activeMilestone: string | null;
  contractStatus: MilestoneStatus | null;
  title: string | null;
  tasks: Array<{ id: string; status: TaskStatus }>;
  ready: string[];
  waiting: string[];
  blocked: string[];
  inProgress: string[];
  nextTask: string | null;
}

function idsWithStatus(tasks: Task[], status: TaskStatus): string[] {
  return tasks.filter((t) => t.status === status).map((t) => t.id);
}

// Reads only .pitway/ — no conversation or session input required. When
// multiple tasks are ready, recommends the lowest task id (declared order),
// deterministically, with no other prioritization in MVP.
export function buildResumeView(root: string): ResumeView {
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

  return {
    activeMilestone: state.active_milestone,
    contractStatus: contract.frontmatter.status,
    title: contract.frontmatter.title,
    tasks: tasksFile.tasks.map((t) => ({ id: t.id, status: t.status })),
    ready,
    waiting: idsWithStatus(tasksFile.tasks, 'waiting'),
    blocked: idsWithStatus(tasksFile.tasks, 'blocked'),
    inProgress,
    nextTask: inProgress.length > 0 ? inProgress[0]! : ready.length > 0 ? ready[0]! : null,
  };
}

export function renderResumeHuman(view: ResumeView): string {
  if (!view.activeMilestone) {
    return 'No active milestone. Run milestone-add to start one.';
  }
  const lines = [
    `🏁 Resuming ${view.activeMilestone} — ${view.title}`,
    `Contract: ${view.contractStatus}`,
    '',
    '🛠 Tasks',
  ];
  for (const t of view.tasks) {
    lines.push(`  ${t.id}  ${taskStatusLabel(t.status)}`);
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
