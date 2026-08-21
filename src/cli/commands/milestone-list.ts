import type { Command } from 'commander';
import { loadContract, loadState } from '../../state/store.js';
import { renderOutput } from '../output.js';
import { milestoneStatusLabel } from '../format.js';
import type { MilestoneStatus } from '../../state/schemas.js';

export interface MilestoneListEntry {
  id: string;
  title: string;
  status: MilestoneStatus;
}

// state.yaml is strictly an id index; for each listed milestone we read only
// its contract frontmatter (title, status) — never tasks/verification/usage.
export function buildMilestoneListView(root: string): MilestoneListEntry[] {
  const state = loadState(root);
  return state.milestones.map((id) => {
    const contract = loadContract(root, id);
    return { id, title: contract.frontmatter.title, status: contract.frontmatter.status };
  });
}

export function renderMilestoneListHuman(entries: MilestoneListEntry[]): string {
  return entries
    .map((e) => `${e.id}  ${e.title}  ${milestoneStatusLabel(e.status)}`)
    .join('\n');
}

export interface CommandDeps {
  root?: string;
  write?: (line: string) => void;
}

export function registerMilestoneListCommand(program: Command, deps: CommandDeps = {}): void {
  const write = deps.write ?? ((line: string) => console.log(line));
  program
    .command('milestone-list')
    .alias('ms-list')
    .description('List every milestone with a concise one-line status.')
    .option('--json', 'output machine-readable JSON')
    .action((options: { json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const entries = buildMilestoneListView(root);
      write(renderOutput(entries, { json: options.json }, renderMilestoneListHuman));
    });
}
