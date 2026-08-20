import type { Command } from 'commander';
import { dispatchTask, type TaskDispatchView } from '../../core/tasks/dispatch.js';
import { renderOutput } from '../output.js';

// AC004/T004 (M014): the --json output is the worker handoff envelope only
// (id, worktree path, branch, created-from revision) -- it never embeds the
// context bundle. The driver obtains the bundle at the authoritative main
// root via `task-status <id> --context` and passes it to the worker.
function renderTaskDispatchHuman(view: TaskDispatchView): string {
  return (
    `🛠 Dispatched ${view.id} to worktree ${view.worktreePath} ` +
    `(branch ${view.branch}, from ${view.createdFrom.slice(0, 12)}) — ` +
    `hand the worker its task-status --context bundle from this root; ` +
    `integrate with task-integrate ${view.id} when its commit is ready.`
  );
}

export interface CommandDeps {
  root?: string;
  write?: (line: string) => void;
}

export function registerTaskDispatchCommand(program: Command, deps: CommandDeps = {}): void {
  const write = deps.write ?? ((line: string) => console.log(line));
  program
    .command('task-dispatch <id>')
    .description(
      'Prepare a parallel-eligible task: transition it to in_progress and create its temporary worktree.',
    )
    .option('--json', 'output machine-readable JSON')
    .action((id: string, options: { json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const view = dispatchTask(root, id);
      write(renderOutput(view, { json: options.json }, renderTaskDispatchHuman));
    });
}
