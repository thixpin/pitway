import type { Command } from 'commander';
import { confirmMilestone, type ConfirmMilestoneView } from '../../core/milestones/confirm.js';
import { renderOutput } from '../output.js';

function renderMilestoneConfirmHuman(view: ConfirmMilestoneView): string {
  if (view.operation === 'amend') {
    return (
      `🏁 Recorded pending amendment for ${view.id}: hash ${view.hash}; ` +
      `will be included in the next checkpoint commit.`
    );
  }
  const recorded = view.outcome === 'already-committed' ? 'already recorded in' : 'recorded in';
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
    .option('--amend', 'record a pending amendment; requires --file')
    .option('--file <path>', 'path to the validated draft contract file holding the full amended contract')
    .option('--json', 'output machine-readable JSON')
    .action((id: string, options: { amend?: boolean; file?: string; json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const view = confirmMilestone(root, id, { amend: options.amend, file: options.file });
      write(renderOutput(view, { json: options.json }, renderMilestoneConfirmHuman));
    });
}
