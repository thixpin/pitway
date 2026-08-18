import type { Command } from 'commander';
import { recordUsage, type UsageAddView } from '../../core/metrics/aggregate.js';
import { renderOutput } from '../output.js';

function renderUsageAddHuman(view: UsageAddView): string {
  const totals = view.usage === null ? '' : ` (attempt ${view.usage.attempts}, ${view.usage.total_tokens} total tokens)`;
  return `📊 Recorded pending ${view.category} usage for ${view.id}${totals}; will be included in the next checkpoint commit.`;
}

export interface CommandDeps {
  root?: string;
  write?: (line: string) => void;
}

export function registerUsageAddCommand(program: Command, deps: CommandDeps = {}): void {
  const write = deps.write ?? ((line: string) => console.log(line));
  program
    .command('usage-add <id>')
    .description("Accumulate measured planning or qa token usage onto a milestone's usage.yaml.")
    .option('--category <category>', 'usage category: planning or qa')
    .option('--usage <json>', 'measured token usage JSON to accumulate')
    .option('--json', 'output machine-readable JSON')
    .action((id: string, options: { category?: string; usage?: string; json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const view = recordUsage(root, id, { category: options.category, usage: options.usage });
      write(renderOutput(view, { json: options.json }, renderUsageAddHuman));
    });
}
