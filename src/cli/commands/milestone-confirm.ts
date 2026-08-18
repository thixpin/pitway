import type { Command } from 'commander';
import { confirmMilestone, type MilestoneConfirmView } from '../../core/milestones/confirm.js';
import { renderOutput } from '../output.js';

function renderMilestoneConfirmHuman(view: MilestoneConfirmView): string {
  const recorded = view.outcome === 'already-committed' ? 'already recorded in' : 'recorded in';
  if (view.operation === 'amend') {
    return `🏁 Amended milestone ${view.id}: hash ${view.hash} ${recorded} commit ${view.commit}.`;
  }
  const ready = view.readyTasks.length > 0 ? ` Ready tasks: ${view.readyTasks.join(', ')}.` : '';
  return `🏁 Confirmed milestone ${view.id}: hash ${view.hash} ${recorded} baseline ${view.commit}.${ready}`;
}

export interface CommandDeps {
  root?: string;
  write?: (line: string) => void;
}

export function registerMilestoneConfirmCommand(program: Command, deps: CommandDeps = {}): void {
  const write = deps.write ?? ((line: string) => console.log(line));
  program
    .command('milestone-confirm <id>')
    .description('Confirm a draft milestone, or record an amended verification plan with --amend.')
    .option('--amend', 'recompute and commit the hash of an amended contract')
    .option('--json', 'output machine-readable JSON')
    .action((id: string, options: { amend?: boolean; json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const view = confirmMilestone(root, id, { amend: options.amend });
      write(renderOutput(view, { json: options.json }, renderMilestoneConfirmHuman));
    });
}
