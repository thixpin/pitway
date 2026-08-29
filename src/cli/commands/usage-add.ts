import type { Command } from 'commander';
import {
  recordUsage,
  recordUsageReading,
  type UsageAddView,
  type UsageReadingAddView,
} from '../../core/metrics/aggregate.js';
import { writeActiveMilestoneFooter } from '../footer.js';
import { renderOutput } from '../output.js';

// M036/T002: usage-add takes an explicit milestone id -- the shared
// footer helper writes only when it's the active milestone (B038).

// M047/T002: one line naming the stored reading; nothing derived.
function renderUsageReadingHuman(view: UsageReadingAddView): string {
  return (
    `📊 Recorded ${view.reading.bucket} usage reading (${view.reading.count}, ${view.reading.semantics}) ` +
    `for ${view.id}; will be included in the next checkpoint commit.`
  );
}

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
    .option(
      '--reading <json>',
      'append one measured usage reading {bucket, count, semantics, ...} (M047); never summed; exclusive with --category',
    )
    .option('--json', 'output machine-readable JSON')
    .action((id: string, options: { category?: string; usage?: string; reading?: string; json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      if (options.reading !== undefined && options.category === undefined && options.usage === undefined) {
        const view = recordUsageReading(root, id, options.reading);
        write(renderOutput(view, { json: options.json }, renderUsageReadingHuman));
        writeActiveMilestoneFooter(root, write, { json: options.json, milestone: view.id });
        return;
      }
      const view = recordUsage(root, id, { category: options.category, usage: options.usage, reading: options.reading });
      write(renderOutput(view, { json: options.json }, renderUsageAddHuman));
      writeActiveMilestoneFooter(root, write, { json: options.json, milestone: view.id });
    });
}
