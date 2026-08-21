import type { Command } from 'commander';
import { mergeMilestone, type MilestoneMergeView } from '../../core/milestones/merge.js';
import { renderOutput } from '../output.js';

function renderMilestoneMergeHuman(view: MilestoneMergeView): string {
  if (view.outcome === 'already-merged') {
    return `🏁 ${view.id} is already merged into ${view.target} (commit ${view.commit}).`;
  }
  return `🏁 Merged ${view.id} (${view.source}) into ${view.target}: commit ${view.commit}.`;
}

export interface CommandDeps {
  root?: string;
  write?: (line: string) => void;
}

export function registerMilestoneMergeCommand(program: Command, deps: CommandDeps = {}): void {
  const write = deps.write ?? ((line: string) => console.log(line));
  program
    .command('milestone-merge <id>')
    .alias('ms-merge')
    .description(
      "Merge a completed milestone's own branch into a target branch (default: the milestone's base_branch).",
    )
    .option('--target <branch>', "target branch (default: the milestone's own base_branch)")
    .option('--json', 'output machine-readable JSON')
    .action((id: string, options: { target?: string; json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const view = mergeMilestone(root, id, { target: options.target });
      write(renderOutput(view, { json: options.json }, renderMilestoneMergeHuman));
    });
}
