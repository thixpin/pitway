import type { Command } from 'commander';
import {
  createMilestone,
  replaceMilestoneDraft,
  type MilestoneAddInputs,
  type MilestoneAddView,
} from '../../core/milestones/create.js';
import { renderOutput } from '../output.js';

function renderMilestoneAddHuman(view: MilestoneAddView): string {
  const requirement = view.requirement === null ? '' : ` (requirement ${view.requirement})`;
  return `🏁 Created milestone ${view.id} "${view.title}" as draft${requirement}.`;
}

function renderMilestoneReplaceHuman(view: MilestoneAddView): string {
  const requirement = view.requirement === null ? '' : ` (requirement ${view.requirement})`;
  return `🏁 Replaced draft milestone ${view.id} "${view.title}" in place${requirement}.`;
}

export interface CommandDeps {
  root?: string;
  write?: (line: string) => void;
}

export function registerMilestoneAddCommand(program: Command, deps: CommandDeps = {}): void {
  const write = deps.write ?? ((line: string) => console.log(line));
  program
    .command('milestone-add')
    .description('Create the next milestone from a drafted contract and task plan.')
    .requiredOption('--contract <path>', 'path to the drafted contract markdown file')
    .requiredOption('--tasks <path>', 'path to the drafted tasks YAML file')
    .option('--requirement <path>', 'path to the originating requirement document')
    .option(
      '--replace <id>',
      'in-place correct an existing draft milestone (same id) instead of creating a new one',
    )
    .option('--json', 'output machine-readable JSON')
    .action(
      (options: {
        contract: string;
        tasks: string;
        requirement?: string;
        replace?: string;
        json?: boolean;
      }) => {
        const root = deps.root ?? process.cwd();
        const inputs: MilestoneAddInputs = {
          contractPath: options.contract,
          tasksPath: options.tasks,
          requirementPath: options.requirement,
        };
        if (options.replace !== undefined) {
          const view = replaceMilestoneDraft(root, options.replace, inputs);
          write(renderOutput(view, { json: options.json }, renderMilestoneReplaceHuman));
          return;
        }
        const view = createMilestone(root, inputs);
        write(renderOutput(view, { json: options.json }, renderMilestoneAddHuman));
      },
    );
}
