import type { Command } from 'commander';
import { recordUsage, type UsageAddView } from '../../core/metrics/aggregate.js';
import { getFooterForActiveMilestone } from '../../core/milestones/footer.js';
import { loadState } from '../../state/store.js';
import { renderOutput } from '../output.js';

// M036/T002: usage-add takes an explicit milestone id -- only show the
// footer when it's the active milestone, never one describing a different
// milestone than the one just acted on. loadState is guarded the same way
// getFooterForActiveMilestone guards its own read: a missing/malformed
// state.yaml never blocks the primary output, it just means no footer.
function writeFooterIfActive(root: string, resolvedId: string, write: (line: string) => void): void {
  let isActive = false;
  try {
    isActive = loadState(root).active_milestone === resolvedId;
  } catch {
    isActive = false;
  }
  if (!isActive) return;
  const footer = getFooterForActiveMilestone(root);
  if (footer !== null) write(footer);
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
    .option('--json', 'output machine-readable JSON')
    .action((id: string, options: { category?: string; usage?: string; json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const view = recordUsage(root, id, { category: options.category, usage: options.usage });
      write(renderOutput(view, { json: options.json }, renderUsageAddHuman));
      if (!options.json) writeFooterIfActive(root, view.id, write);
    });
}
