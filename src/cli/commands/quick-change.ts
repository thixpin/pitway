import type { Command } from 'commander';
import {
  approveQuickChange,
  cancelQuickChange,
  createQuickChange,
  deriveQuickChangeState,
  readAllQuickChanges,
  type QuickChangeView,
} from '../../core/quick-change/create.js';
import { commitQuickChange, type QuickChangeCommitView } from '../../core/quick-change/commit.js';
import { runQuickChange, type QuickChangeRunView } from '../../core/quick-change/run.js';
import { promoteQuickChange, type QuickChangePromoteView } from '../../core/quick-change/promote.js';
import type { JournalQuickChange } from '../../state/journal.js';
import { renderOutput } from '../output.js';

export interface CommandDeps {
  root?: string;
  write?: (line: string) => void;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function renderViewHuman(view: QuickChangeView): string {
  return `🔧 ${view.id} (${view.status}) — ${view.objective}`;
}

function renderRunHuman(view: QuickChangeRunView): string {
  return view.status === 'pass' ? `🔧 ${view.id} run passed.` : `🔧 ${view.id} run failed.`;
}

function renderCommitHuman(view: QuickChangeCommitView): string {
  return view.outcome === 'already-committed'
    ? `🔧 ${view.id} already committed at ${view.commit}.`
    : `🔧 Committed ${view.id} at ${view.commit}.`;
}

function renderPromoteHuman(view: QuickChangePromoteView): string {
  return `🔧 ${view.id} promoted; draft a milestone contract for: ${view.objective}`;
}

// Same field shape as create.ts's private toView -- duplicated locally
// because toView isn't exported (a small, bounded duplication rather than
// widening this task's write scope onto create.ts to export it, matching
// run.ts's own precedent for computeQuickChangeHash).
function toStatusView(record: JournalQuickChange): QuickChangeView {
  return {
    id: record.id,
    status: record.status,
    objective: record.objective,
    scope: record.scope,
    verifyCommand: record.verifyCommand,
    approvedHash: record.approvedHash ?? null,
    runs: record.runs,
  };
}

// A thin, separate read: same readAllQuickChanges/deriveQuickChangeState
// data `pitway resume` already surfaces, but focused on one change (or a
// full list with no id given). Explicitly a convenience, never required for
// discoverability -- resume already covers that on its own.
export function quickChangeStatus(
  root: string,
  changeId: string | undefined,
): QuickChangeView | QuickChangeView[] {
  const all = readAllQuickChanges(root);
  if (changeId !== undefined) {
    const current = deriveQuickChangeState(all, changeId);
    if (current === undefined) {
      throw new Error(`unknown quick-change ${changeId}`);
    }
    return toStatusView(current);
  }
  const ids = Array.from(new Set(all.map((r) => r.id)));
  return ids.map((id) => toStatusView(deriveQuickChangeState(all, id)!));
}

function renderStatusHuman(view: QuickChangeView | QuickChangeView[]): string {
  if (Array.isArray(view)) {
    return view.length === 0 ? 'No quick-changes recorded.' : view.map(renderViewHuman).join('\n');
  }
  return renderViewHuman(view);
}

export function registerQuickChangeCommand(program: Command, deps: CommandDeps = {}): void {
  const write = deps.write ?? ((line: string) => console.log(line));
  const quickChange = program
    .command('quick-change')
    .description(
      'A bounded, small-fix workflow against an already-completed milestone -- ' +
        'create/approve/run/commit, or cancel/promote before commit.',
    );

  quickChange
    .command('create')
    .description(
      'Draft a quick-change: requires active_milestone: null and a clean working tree; ' +
        'declares the exact --scope file census and --verify command.',
    )
    .option('--objective <text>', 'what the change fixes')
    .option('--scope <path>', 'repeatable: repo-relative path this change may edit', collect, [])
    .option('--verify <command>', 'the command that verifies the fix')
    .option('--json', 'output machine-readable JSON')
    .action((options: { objective?: string; scope: string[]; verify?: string; json?: boolean }) => {
      if (options.objective === undefined) {
        throw new Error('quick-change create requires --objective <text>');
      }
      if (options.verify === undefined) {
        throw new Error('quick-change create requires --verify <command>');
      }
      const root = deps.root ?? process.cwd();
      const view = createQuickChange(root, {
        objective: options.objective,
        scope: options.scope,
        verifyCommand: options.verify,
      });
      write(renderOutput(view, { json: options.json }, renderViewHuman));
    });

  quickChange
    .command('approve <change-id>')
    .description('Hash and lock the declared scope/verify command; running this is itself the approval.')
    .option('--json', 'output machine-readable JSON')
    .action((changeId: string, options: { json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const view = approveQuickChange(root, changeId);
      write(renderOutput(view, { json: options.json }, renderViewHuman));
    });

  quickChange
    .command('run <change-id>')
    .description("Execute the approved verify command; every attempt (pass or fail) is appended to the change's run history.")
    .option('--json', 'output machine-readable JSON')
    .action((changeId: string, options: { json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const view = runQuickChange(root, changeId);
      write(renderOutput(view, { json: options.json }, renderRunHuman));
    });

  quickChange
    .command('commit <change-id>')
    .description('Land the approved change (with a latest passing run) as one commit carrying a PitWay-Change trailer.')
    .option('--json', 'output machine-readable JSON')
    .action((changeId: string, options: { json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const view = commitQuickChange(root, changeId);
      write(renderOutput(view, { json: options.json }, renderCommitHuman));
    });

  quickChange
    .command('cancel <change-id>')
    .description('Cancel a still-pending (draft or approved) quick-change; performs no git operation.')
    .option('--json', 'output machine-readable JSON')
    .action((changeId: string, options: { json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const view = cancelQuickChange(root, changeId);
      write(renderOutput(view, { json: options.json }, renderViewHuman));
    });

  quickChange
    .command('promote <change-id>')
    .description(
      'Terminally convert a draft or approved change into a milestone draft candidate -- ' +
        'never committable as a quick-change afterward.',
    )
    .option('--json', 'output machine-readable JSON')
    .action((changeId: string, options: { json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const view = promoteQuickChange(root, changeId);
      write(renderOutput(view, { json: options.json }, renderPromoteHuman));
    });

  quickChange
    .command('status [change-id]')
    .description(
      'Convenience read of one change, or every recorded change with no id given -- ' +
        'never a substitute for `pitway resume`.',
    )
    .option('--json', 'output machine-readable JSON')
    .action((changeId: string | undefined, options: { json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const view = quickChangeStatus(root, changeId);
      write(renderOutput(view, { json: options.json }, renderStatusHuman));
    });
}
