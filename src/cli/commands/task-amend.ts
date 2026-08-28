import type { Command } from 'commander';
import { amendTask, type TaskAmendView } from '../../core/tasks/amend.js';
import { writeActiveMilestoneFooter } from '../footer.js';
import { renderOutput } from '../output.js';

function renderTaskAmendHuman(view: TaskAmendView): string {
  return (
    `🔧 Recorded pending amendment for task ${view.id} in ${view.milestone}; ` +
    `will be included in the next checkpoint commit.`
  );
}

export interface CommandDeps {
  root?: string;
  write?: (line: string) => void;
}

export function registerTaskAmendCommand(program: Command, deps: CommandDeps = {}): void {
  const write = deps.write ?? ((line: string) => console.log(line));
  program
    .command('task-amend <task-id>')
    .description(
      'Amend a task definition (objective/acceptance_criteria/relevant_files/context_files/' +
        'write_scope/verification); requires --file and --change-log — running the command is the approval.',
    )
    .option('--file <path>', 'path to a YAML file with the proposed partial task field changes')
    .option(
      '--change-log <text>',
      'free-text evidence describing what/why, correlated with the contract Change Log',
    )
    .option('--json', 'output machine-readable JSON')
    .action((taskId: string, options: { file?: string; changeLog?: string; json?: boolean }) => {
      if (options.file === undefined) {
        throw new Error('task-amend requires --file <path> pointing at the proposed task field changes');
      }
      if (options.changeLog === undefined) {
        throw new Error('task-amend requires --change-log <text> describing the amendment');
      }
      const root = deps.root ?? process.cwd();
      const view = amendTask(root, undefined, taskId, {
        filePath: options.file,
        changeLogEvidence: options.changeLog,
      });
      write(renderOutput(view, { json: options.json }, renderTaskAmendHuman));
      writeActiveMilestoneFooter(root, write, options);
    });
}
