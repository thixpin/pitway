import type { Command } from 'commander';
import { completeMilestone, type MilestoneCompleteView } from '../../core/milestones/complete.js';
import { renderOutput } from '../output.js';
import { writeActiveMilestoneFooter } from '../footer.js';

// T003 (M037): milestone-merge's own approval gate is already correct and
// documented in protocol-driver.md, but nothing in milestone-complete's real
// output ever mentioned it -- its footer call is unreachable here since
// active_milestone is already cleared to null by the time it runs. State the
// gate plainly at the point a driver might otherwise chain straight into
// merge.
function renderMilestoneCompleteHuman(view: MilestoneCompleteView): string {
  const recorded = view.outcome === 'already-committed' ? 'already recorded in' : 'recorded in';
  return (
    `🏁 Completed milestone ${view.id}: ${recorded} commit ${view.commit}. ` +
    `Run 'pitway milestone-merge ${view.id}' only with separate, explicit developer approval -- it is never run automatically.`
  );
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
      writeActiveMilestoneFooter(root, write, options);
    });
}
