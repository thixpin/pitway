import type { Command } from 'commander';
import { loadContract, loadState, loadTasks } from '../../state/store.js';
import { listInstalledSkillNames } from '../../state/claude-assets.js';
import { buildTaskContextBundle } from '../../core/tasks/context-bundle.js';
import { assertRequiredSkillsAvailable } from '../../core/tasks/skills.js';
import { renderOutput } from '../output.js';
import { taskStatusLabel } from '../format.js';
import type { Task } from '../../state/schemas.js';

export interface TaskStatusView {
  id: string;
  name: string | null;
  status: Task['status'];
  dependsOn: string[];
  result: Task['result'];
}

function findTask(tasks: Task[], id: string): Task {
  const task = tasks.find((t) => t.id === id);
  if (!task) throw new Error(`task ${id} not found`);
  return task;
}

// task-status operates on the currently active milestone — the workflow
// PitWay is already tracking — rather than taking a milestone id, matching
// how a developer actually invokes it mid-session.
function resolveActiveMilestone(root: string): string {
  const state = loadState(root);
  if (!state.active_milestone) {
    throw new Error('no active milestone; run milestone-add first');
  }
  return state.active_milestone;
}

export function buildTaskStatusView(root: string, taskId: string): TaskStatusView {
  const milestoneId = resolveActiveMilestone(root);
  const tasksFile = loadTasks(root, milestoneId);
  const task = findTask(tasksFile.tasks, taskId);
  return {
    id: task.id,
    name: task.name ?? null,
    status: task.status,
    dependsOn: task.depends_on,
    result: task.result,
  };
}

export function renderTaskStatusHuman(view: TaskStatusView): string {
  const lines = [
    view.name !== null
      ? `🛠 Task ${view.id}  ${view.name}  ${taskStatusLabel(view.status)}`
      : `🛠 Task ${view.id}  ${taskStatusLabel(view.status)}`,
    `Depends on: ${view.dependsOn.length > 0 ? view.dependsOn.join(', ') : '(none)'}`,
  ];
  lines.push(view.result ? `Result: ${view.result.summary}` : 'Result: (none yet)');
  return lines.join('\n');
}

export interface CommandDeps {
  root?: string;
  write?: (line: string) => void;
}

export function registerTaskStatusCommand(program: Command, deps: CommandDeps = {}): void {
  const write = deps.write ?? ((line: string) => console.log(line));
  program
    .command('task-status <id>')
    .description("Show a task's status, or its minimal execution context with --context.")
    .option('--context', 'emit the minimal task-context bundle for execution')
    .option('--json', 'output machine-readable JSON')
    .action((id: string, options: { context?: boolean; json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      if (options.context) {
        const milestoneId = resolveActiveMilestone(root);
        const contract = loadContract(root, milestoneId);
        const tasksFile = loadTasks(root, milestoneId);
        // AC003/T003 + M025/T006 (B009): pre-dispatch context gate -- State
        // (what's actually installed across every installed driver skills
        // dir -- .claude/skills U .opencode/skills, sorted deduped, each
        // filtered by SKILL.md), then Core (pure comparison), composed here
        // before the bundle is built. A complete no-op when the task
        // declares no required_skills, byte-for-byte matching pre-M011
        // behavior.
        const task = findTask(tasksFile.tasks, id);
        const available = listInstalledSkillNames(root);
        assertRequiredSkillsAvailable(task.required_skills ?? [], available);
        const bundle = buildTaskContextBundle(contract.frontmatter, tasksFile.tasks, id);
        write(renderOutput(bundle, { json: options.json ?? true }, (b) => JSON.stringify(b, null, 2)));
        return;
      }
      const view = buildTaskStatusView(root, id);
      write(renderOutput(view, { json: options.json }, renderTaskStatusHuman));
    });
}
