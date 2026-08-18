import type { Command } from 'commander';
import { updateTask, type TaskUpdateView } from '../../core/tasks/update.js';
import { renderOutput } from '../output.js';
import { taskStatusLabel } from '../format.js';

function renderTaskUpdateHuman(view: TaskUpdateView): string {
  const head = `🛠 Task ${view.id} → ${taskStatusLabel(view.status)}`;
  if (view.outcome === 'committed') return `${head}; recorded in commit ${view.commit}.`;
  if (view.outcome === 'already-committed') return `${head}; already recorded in commit ${view.commit}.`;
  const attempt =
    view.status === 'in_progress' && view.attempts !== null ? ` (attempt ${view.attempts})` : '';
  return `${head}${attempt}.`;
}

export interface CommandDeps {
  root?: string;
  write?: (line: string) => void;
}

export function registerTaskUpdateCommand(program: Command, deps: CommandDeps = {}): void {
  const write = deps.write ?? ((line: string) => console.log(line));
  program
    .command('task-update <id> <status>')
    .description("Transition a task's status; completion commits its files atomically.")
    .option('--result <path>', 'path to a YAML/JSON file with the completion result {summary, evidence}')
    .option('--message <path>', 'path to a file containing the completion commit message')
    .option('--usage <json>', 'measured token usage JSON to accumulate onto the task')
    .option('--json', 'output machine-readable JSON')
    .action(
      (
        id: string,
        status: string,
        options: { result?: string; message?: string; usage?: string; json?: boolean },
      ) => {
        const root = deps.root ?? process.cwd();
        const view = updateTask(root, id, status, {
          resultPath: options.result,
          messagePath: options.message,
          usage: options.usage,
        });
        write(renderOutput(view, { json: options.json }, renderTaskUpdateHuman));
      },
    );
}
