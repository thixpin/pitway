import type { Command } from 'commander';
import { loadState } from '../../state/store.js';
import { buildMilestoneStatusView, type MilestoneStatusView } from '../../core/views/milestone-status.js';
import { renderOutput } from '../output.js';
import { renderTable } from '../table.js';

// B037: view assembly lives in src/core/views/milestone-status.ts; this
// module only registers the command and renders the view for humans.

// Read-only marker for the id-omitted, no-active-milestone case: an answer,
// never a refusal -- exit 0, same convention as `pitway milestone-current`
// and `pitway resume`'s own "No active milestone" section (unlike
// verify/task-dispatch/task-amend's "no active milestone; pass an id
// explicitly" throw, which fits an action that genuinely cannot proceed
// without a target -- milestone-status only ever displays).
export interface MilestoneStatusInactiveView {
  active: false;
}

function renderTaskTable(tasks: MilestoneStatusView['tasks']): string[] {
  const headers = ['Task', 'Label', 'Execution', 'Status', 'Tokens'];
  const rows = tasks.map((t) => [
    t.id,
    t.label,
    t.executionMode ?? '—',
    t.statusLabel,
    formatTokenValue(t.tokens),
  ]);
  // B022: fixed-width padded columns, tokens right-aligned.
  return renderTable(headers, rows, { pad: true, align: ['left', 'left', 'left', 'left', 'right'] });
}

const formatTokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const formatTokenValue = (n: number | null): string => (n === null ? 'N/A' : formatTokens(n));

// UX-only: a fixed-width, no-color bar purely representing the same
// percentage `footer`/`workloadPercent` already carry — never a second
// progress calculation.
const PROGRESS_BAR_WIDTH = 20;

function renderProgressBar(percent: number): string {
  const clamped = Math.min(100, Math.max(0, percent));
  const filled = Math.round((clamped / 100) * PROGRESS_BAR_WIDTH);
  return `[${'█'.repeat(filled)}${'░'.repeat(PROGRESS_BAR_WIDTH - filled)}]`;
}

// Splices the bar between the footer's leading icon and its percentage —
// e.g. "🏎️ 77% · ..." becomes "🏎️ [███████████████░░░░░] 77% · ...". A pure
// string transform of the exact footer computeRacingFooter already
// produced; never re-derives the percent, count, or next-gate text.
function withProgressBar(footer: string, percent: number): string {
  return footer.replace(/^(\S+) /, `$1 ${renderProgressBar(percent)} `);
}

export function renderMilestoneStatusHuman(view: MilestoneStatusView): string {
  const lines = [
    `🏁 Milestone ${view.id} — ${view.title}`,
    '',
    `Status: ${view.status}`,
    `Baseline: ${view.baselineSha ?? 'N/A'}`,
    `Workload: ~${view.workloadPercent}% · ${view.progress.completed}/${view.progress.total} required tasks completed`,
    `Tokens: ${formatTokenValue(view.tokenTotal)} (${view.missingUsageCount} task${view.missingUsageCount === 1 ? '' : 's'} missing usage)`,
    '',
    ...renderTaskTable(view.tasks),
  ];
  lines.push('');
  lines.push(`Critical path: ${view.criticalPath.length > 0 ? view.criticalPath.join(' → ') : '(none)'}`);
  lines.push(`Active: ${view.activeTask ?? '(none)'}`);
  lines.push(`Next: ${view.nextTask ?? '(no ready task)'}`);
  lines.push('');
  lines.push('Token breakdown:');
  lines.push(`  task: ${formatTokenValue(view.tokenBreakdown.task)}`);
  lines.push(`  planning: ${formatTokenValue(view.tokenBreakdown.planning)}`);
  lines.push(`  qa: ${formatTokenValue(view.tokenBreakdown.qa)}`);
  lines.push(`  review: ${formatTokenValue(view.tokenBreakdown.review)}`);
  lines.push(`  total: ${formatTokenValue(view.tokenBreakdown.total)}`);
  lines.push(`  missing: ${view.tokenBreakdown.missing}`);
  // M047/T003: per-bucket lines -- measured segments + missing count, and a
  // COUNT of readings (never a sum); no cross-bucket total, no percentage.
  if (view.buckets !== undefined) {
    for (const name of ['main', 'orchestrator', 'worker', 'auxiliary'] as const) {
      const b = view.buckets[name];
      const readings = b.readings > 0 ? ` · readings: ${b.readings} (measured readings, not summed)` : '';
      lines.push(`  ${name}: ${formatTokenValue(b.measured)} (${b.missing} missing)${readings}`);
    }
  }
  if (view.footer !== null) lines.push('', withProgressBar(view.footer, view.workloadPercent));
  return lines.join('\n');
}

function renderMilestoneStatusOrInactiveHuman(view: MilestoneStatusView | MilestoneStatusInactiveView): string {
  if ('active' in view && view.active === false) return 'No active milestone.';
  return renderMilestoneStatusHuman(view as MilestoneStatusView);
}

export interface CommandDeps {
  root?: string;
  write?: (line: string) => void;
}

export function registerMilestoneStatusCommand(program: Command, deps: CommandDeps = {}): void {
  const write = deps.write ?? ((line: string) => console.log(line));
  program
    .command('milestone-status [id]')
    .alias('ms-status')
    .description(
      'Show the active milestone\'s status, contract, progress, and tasks -- or a named milestone\'s, ' +
        'active or not, when an id is given.',
    )
    .option('--json', 'output machine-readable JSON')
    .action((id: string | undefined, options: { json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const resolvedId = id ?? loadState(root).active_milestone;
      if (resolvedId === null) {
        write(renderOutput({ active: false }, { json: options.json }, renderMilestoneStatusOrInactiveHuman));
        return;
      }
      const view = buildMilestoneStatusView(root, resolvedId);
      write(renderOutput(view, { json: options.json }, renderMilestoneStatusOrInactiveHuman));
    });
}
