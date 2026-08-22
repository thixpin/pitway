import type { Command } from 'commander';
import { cancelMilestone, type MilestoneCancelView } from '../../core/milestones/cancel.js';
import { renderOutput } from '../output.js';
import { getFooterForActiveMilestone } from '../../core/milestones/footer.js';

function renderMilestoneCancelHuman(view: MilestoneCancelView): string {
  return `🏁 Cancelled milestone ${view.id}; permanently retired.`;
}

export interface CommandDeps {
  root?: string;
  write?: (line: string) => void;
}

export function registerMilestoneCancelCommand(program: Command, deps: CommandDeps = {}): void {
  const write = deps.write ?? ((line: string) => console.log(line));
  program
    .command('milestone-cancel <id>')
    .alias('ms-cancel')
    .description('Permanently abandon a draft milestone; the directory is preserved, the id never reused.')
    .option('--json', 'output machine-readable JSON')
    .action((id: string, options: { json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const view = cancelMilestone(root, id);
      write(renderOutput(view, { json: options.json }, renderMilestoneCancelHuman));
      if (!options.json) {
        const footer = getFooterForActiveMilestone(root);
        if (footer !== null) write(footer);
      }
    });
}
