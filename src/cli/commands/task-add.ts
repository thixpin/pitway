import type { Command } from 'commander';
import { addTask, type TaskAddView } from '../../core/tasks/add.js';
import { renderOutput } from '../output.js';

function renderTaskAddHuman(view: TaskAddView): string {
  return (
    `🔧 Added task ${view.id} to ${view.milestone} as a pending amendment; ` +
    `will be included in the next checkpoint commit. Inline task-update ${view.id} in_progress ` +
    `works immediately; task-dispatch refuses until then.`
  );
}

export interface CommandDeps {
  root?: string;
  write?: (line: string) => void;
}

export function registerTaskAddCommand(program: Command, deps: CommandDeps = {}): void {
  const write = deps.write ?? ((line: string) => console.log(line));
  program
    .command('task-add <milestone-id>')
    .description(
      'Insert one new task into a confirmed or in_progress milestone; requires --file and ' +
        '--change-log — running the command is the approval.',
    )
    .option('--file <path>', 'path to a YAML file with the new task definition')
    .option(
      '--change-log <text>',
      'free-text evidence describing what/why, correlated with the contract Change Log',
    )
    .option('--json', 'output machine-readable JSON')
    .action((milestoneId: string, options: { file?: string; changeLog?: string; json?: boolean }) => {
      if (options.file === undefined) {
        throw new Error('task-add requires --file <path> pointing at the new task definition');
      }
      if (options.changeLog === undefined) {
        throw new Error('task-add requires --change-log <text> describing the addition');
      }
      const root = deps.root ?? process.cwd();
      const view = addTask(root, milestoneId, {
        filePath: options.file,
        changeLogEvidence: options.changeLog,
      });
      write(renderOutput(view, { json: options.json }, renderTaskAddHuman));
    });
}
