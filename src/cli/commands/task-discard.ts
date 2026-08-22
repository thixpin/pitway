import type { Command } from 'commander';
import { discardTask, type TaskDiscardView } from '../../core/tasks/discard.js';
import { renderOutput } from '../output.js';
import { getFooterForActiveMilestone } from '../../core/milestones/footer.js';

function renderTaskDiscardHuman(view: TaskDiscardView): string {
  return (
    `🔧 Discarded ${view.id}'s dispatch (${view.dispatchId}): worktree ` +
    `${view.worktreeRemoved ? 'removed' : 'was already gone'}, task is now ${view.status} ` +
    `(failed → ready allows re-dispatch). Discarded work is unrecoverable through PitWay.`
  );
}

export interface CommandDeps {
  root?: string;
  write?: (line: string) => void;
}

export function registerTaskDiscardCommand(program: Command, deps: CommandDeps = {}): void {
  const write = deps.write ?? ((line: string) => console.log(line));
  program
    .command('task-discard <id>')
    .description("Abandon a dispatched task's worktree without integrating; the task becomes failed.")
    .option('--reason <text>', 'why the dispatched work is being abandoned (required)')
    .option('--json', 'output machine-readable JSON')
    .action((id: string, options: { reason?: string; json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const view = discardTask(root, id, options.reason);
      write(renderOutput(view, { json: options.json }, renderTaskDiscardHuman));
      if (!options.json) {
        const footer = getFooterForActiveMilestone(root);
        if (footer !== null) write(footer);
      }
    });
}
