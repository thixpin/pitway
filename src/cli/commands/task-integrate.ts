import type { Command } from 'commander';
import { integrateTask, type TaskIntegrateView } from '../../core/tasks/integrate.js';
import { renderOutput } from '../output.js';

function renderTaskIntegrateHuman(view: TaskIntegrateView): string {
  switch (view.outcome) {
    case 'recovered':
      return (
        `🛠 Task ${view.id} was already applied (crash-window re-run): recorded the ` +
        `integrate journal entry and cleaned up the worktree — continue with the normal ` +
        `task-verify → review → completed sequence.`
      );
    case 'cleanup-completed':
      return (
        `🛠 Task ${view.id} integration was already recorded: completed the pending ` +
        `worktree/branch cleanup only.`
      );
    default:
      return (
        `🛠 Integrated ${view.id} (${view.changedPaths.length} path(s), worker commit ` +
        `${view.workerSha.slice(0, 12)}): the diff is applied uncommitted — run the ` +
        `authoritative task-verify ${view.id}, then task-update ${view.id} review, ` +
        `then completed for the atomic commit.`
      );
  }
}

export interface CommandDeps {
  root?: string;
  write?: (line: string) => void;
}

export function registerTaskIntegrateCommand(program: Command, deps: CommandDeps = {}): void {
  const write = deps.write ?? ((line: string) => console.log(line));
  program
    .command('task-integrate <id>')
    .description(
      "Apply a dispatched task's worktree commit to the main tree (diff-apply, never merge) and clean up its worktree.",
    )
    .option('--json', 'output machine-readable JSON')
    .action((id: string, options: { json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const view = integrateTask(root, id);
      write(renderOutput(view, { json: options.json }, renderTaskIntegrateHuman));
    });
}
