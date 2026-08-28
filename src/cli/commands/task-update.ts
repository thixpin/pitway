import type { Command } from 'commander';
import { updateTask, type TaskUpdateView } from '../../core/tasks/update.js';
import { renderOutput } from '../output.js';
import { taskStatusLabel } from '../format.js';
import { writeActiveMilestoneFooter } from '../footer.js';

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
  // M017/T003 (AC005): a fresh completion's usageWarning prints here, one
  // line, human mode only -- stderr so it never pollutes --json stdout or a
  // human-mode result any caller might parse.
  writeErr?: (line: string) => void;
}

export function registerTaskUpdateCommand(program: Command, deps: CommandDeps = {}): void {
  const write = deps.write ?? ((line: string) => console.log(line));
  const writeErr = deps.writeErr ?? ((line: string) => console.error(line));
  program
    .command('task-update <id> <status>')
    .description("Transition a task's status; completion commits its files atomically.")
    .option('--result <path>', 'path to a YAML/JSON file with the completion result {summary, evidence}')
    .option('--message <path>', 'path to a file containing the completion commit message')
    .option(
      '--usage <json>',
      'measured token usage JSON to accumulate onto the task (MUST forward dispatched sub-agent tool-result usage per dispatch.md step 8 -- cannot be added retroactively once the task is completed)',
    )
    .option(
      '--evidence <id>',
      'use a specific task-verify evidence record by id, instead of implicit selection',
    )
    .option('--driver <name>', 'runtime-reported driving agent name, stored in PitWay evidence (1..80 chars)')
    .option('--model <id>', 'runtime-reported model id, stored in PitWay evidence (1..80 chars)')
    .option('--json', 'output machine-readable JSON')
    .action(
      (
        id: string,
        status: string,
        options: { result?: string; message?: string; usage?: string; evidence?: string; driver?: string; model?: string; json?: boolean },
      ) => {
        const root = deps.root ?? process.cwd();
        const view = updateTask(root, id, status, {
          resultPath: options.result,
          messagePath: options.message,
          usage: options.usage,
          evidenceId: options.evidence,
          driver: options.driver,
          model: options.model,
        });
        write(renderOutput(view, { json: options.json }, renderTaskUpdateHuman));
        writeActiveMilestoneFooter(root, write, options);
        if (!options.json && view.usageWarning !== null) {
          writeErr(view.usageWarning);
        }
      },
    );
}
