import type { Command } from 'commander';
import { completeMilestone, type MilestoneCompleteView } from '../../core/milestones/complete.js';
import { renderOutput } from '../output.js';

function renderMilestoneCompleteHuman(view: MilestoneCompleteView): string {
  const recorded = view.outcome === 'already-committed' ? 'already recorded in' : 'recorded in';
  return `🏁 Completed milestone ${view.id}: ${recorded} commit ${view.commit}.`;
}

export interface CommandDeps {
  root?: string;
  write?: (line: string) => void;
}

export function registerMilestoneCompleteCommand(program: Command, deps: CommandDeps = {}): void {
  const write = deps.write ?? ((line: string) => console.log(line));
  program
    .command('milestone-complete <id>')
    .alias('ms-complete')
    .description('Complete an in_progress milestone once every task and check has passed.')
    .option('--json', 'output machine-readable JSON')
    .action((id: string, options: { json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const view = completeMilestone(root, id);
      write(renderOutput(view, { json: options.json }, renderMilestoneCompleteHuman));
    });
}
