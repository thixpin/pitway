import type { Command } from 'commander';
import { loadContract, loadState } from '../../state/store.js';
import { renderOutput } from '../output.js';
import { milestoneStatusLabel } from '../format.js';
import type { MilestoneStatus } from '../../state/schemas.js';

export interface MilestoneCurrentView {
  active: boolean;
  id: string | null;
  status: MilestoneStatus | null;
}

// Read-only state check: state.yaml's active_milestone is set as early as
// milestone-add (draft) and cleared only at milestone-cancel/-complete, so
// an active milestone's status can legitimately be anything from draft
// through review -- never assume in_progress. Loads only the contract
// frontmatter, same minimal-read discipline as milestone-list.
export function buildMilestoneCurrentView(root: string): MilestoneCurrentView {
  const state = loadState(root);
  if (state.active_milestone === null) {
    return { active: false, id: null, status: null };
  }
  const contract = loadContract(root, state.active_milestone);
  return { active: true, id: state.active_milestone, status: contract.frontmatter.status };
}

export function renderMilestoneCurrentHuman(view: MilestoneCurrentView): string {
  if (!view.active || view.id === null || view.status === null) {
    return 'No active milestone.';
  }
  return `Active milestone: ${view.id} — ${milestoneStatusLabel(view.status)}`;
}

export interface CommandDeps {
  root?: string;
  write?: (line: string) => void;
}

export function registerMilestoneCurrentCommand(program: Command, deps: CommandDeps = {}): void {
  const write = deps.write ?? ((line: string) => console.log(line));
  program
    .command('milestone-current')
    .alias('ms-current')
    .description('Show whether a milestone is active, and its id/status if so.')
    .option('--json', 'output machine-readable JSON')
    .action((options: { json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const view = buildMilestoneCurrentView(root);
      write(renderOutput(view, { json: options.json }, renderMilestoneCurrentHuman));
    });
}
