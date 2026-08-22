import type { Command } from 'commander';
import { addBacklogItem, type BacklogAddView } from '../../core/backlog/add.js';
import { promoteBacklogItem, type BacklogPromoteView } from '../../core/backlog/promote.js';
import { archiveBacklogItem, type BacklogArchiveView } from '../../core/backlog/archive.js';
import { listBacklogItems } from '../../core/backlog/list.js';
import { showBacklogItem } from '../../core/backlog/show.js';
import type { BacklogItem, BacklogStatus } from '../../state/schemas.js';
import { renderOutput } from '../output.js';
import { getFooterForActiveMilestone } from '../../core/milestones/footer.js';

export interface CommandDeps {
  root?: string;
  write?: (line: string) => void;
}

function renderAddHuman(view: BacklogAddView): string {
  return `🔧 ${view.id} recorded as ${view.status}.`;
}

function renderItemHuman(item: BacklogItem): string {
  return `🔧 ${item.id} [${item.status}] ${item.title} — ${item.reason}`;
}

function renderListHuman(
  items: BacklogItem[],
  filters?: { status?: string; milestone?: string; task?: string },
): string {
  const parts: string[] = [];
  if (filters?.status !== undefined) parts.push(`status=${filters.status}`);
  if (filters?.milestone !== undefined) parts.push(`milestone=${filters.milestone}`);
  if (filters?.task !== undefined) parts.push(`task=${filters.task}`);
  const header = parts.length > 0 ? `Backlog (filtered: ${parts.join(', ')})` : null;
  const body = items.length === 0 ? 'No backlog items recorded.' : items.map(renderItemHuman).join('\n');
  return header ? `${header}\n${body}` : body;
}

function renderPromoteHuman(view: BacklogPromoteView): string {
  return `🔧 ${view.id} promoted to ${view.promoted_to.milestone}/${view.promoted_to.task}.`;
}

function renderArchiveHuman(view: BacklogArchiveView): string {
  return `🔧 ${view.id} archived.`;
}

// M018/T003 (AC006): parent `backlog` command with five subcommands,
// following quick-change.ts's exact wiring template. backlog add/promote/
// archive are state-mutating and automatically refused inside a task
// worktree by worktree-guard.ts's existing default-deny (no code change
// there); backlog list/show are read-only but deliberately NOT added to
// its READ_ONLY_COMMANDS allowlist, matching quick-change status's own
// precedent -- backlog inspection stays driver-owned.
export function registerBacklogCommand(program: Command, deps: CommandDeps = {}): void {
  const write = deps.write ?? ((line: string) => console.log(line));
  const backlog = program
    .command('backlog')
    .description(
      'Capture work discovered mid-task that is intentionally out of scope -- ' +
        'add/list/show/promote/archive, always attached to the currently active milestone.',
    );

  backlog
    .command('add')
    .description(
      '--milestone/--task here are source annotation only (default: the active milestone); ' +
        'journal attachment is always the active milestone, never flag-controlled.',
    )
    .requiredOption('--title <text>', 'short label for the deferred item')
    .requiredOption('--reason <text>', 'why this was deferred')
    .option('--milestone <id>', 'source milestone (defaults to the active milestone)')
    .option('--task <id>', 'source task (requires the milestone it belongs to)')
    .option('--json', 'output machine-readable JSON')
    .action((options: { title: string; reason: string; milestone?: string; task?: string; json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const view = addBacklogItem(root, {
        title: options.title,
        reason: options.reason,
        sourceMilestone: options.milestone,
        sourceTask: options.task,
      });
      write(renderOutput(view, { json: options.json }, renderAddHuman));
      if (!options.json) {
        const footer = getFooterForActiveMilestone(root);
        if (footer !== null) write(footer);
      }
    });

  backlog
    .command('list')
    .description('List backlog items, optionally filtered by status, milestone, or task.')
    .option('--status <status>', 'filter: pending | promoted | archived')
    .option('--milestone <id>', 'filter: source milestone (e.g. M001)')
    .option('--task <id>', 'filter: source task (e.g. T001)')
    .option('--json', 'output machine-readable JSON')
    .action((options: { status?: string; milestone?: string; task?: string; json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      if (options.status !== undefined && !['pending', 'promoted', 'archived'].includes(options.status)) {
        throw new Error(`backlog list --status must be pending, promoted, or archived; got ${options.status}`);
      }
      if (options.milestone !== undefined && !/^M\d{3}$/.test(options.milestone)) {
        throw new Error(`backlog list --milestone must match M000; got ${options.milestone}`);
      }
      if (options.task !== undefined && !/^T\d{3}$/.test(options.task)) {
        throw new Error(`backlog list --task must match T000; got ${options.task}`);
      }
      const items = listBacklogItems(root, {
        status: options.status as BacklogStatus | undefined,
        milestone: options.milestone,
        task: options.task,
      });
      const filters =
        options.status !== undefined || options.milestone !== undefined || options.task !== undefined
          ? { status: options.status, milestone: options.milestone, task: options.task }
          : undefined;
      write(renderOutput(items, { json: options.json }, (data) => renderListHuman(data, filters)));
    });

  backlog
    .command('show <id>')
    .description('Show one backlog item.')
    .option('--json', 'output machine-readable JSON')
    .action((id: string, options: { json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const item = showBacklogItem(root, id);
      write(renderOutput(item, { json: options.json }, renderItemHuman));
    });

  backlog
    .command('promote <id>')
    .description(
      '--task/--milestone here mean the promotion target only (--milestone defaults to the active ' +
        "milestone). Never creates a task or milestone -- the referenced one must already exist.",
    )
    .requiredOption('--task <id>', 'the already-existing task this item became')
    .option('--milestone <id>', "the task's milestone (defaults to the active milestone)")
    .option('--json', 'output machine-readable JSON')
    .action((id: string, options: { task: string; milestone?: string; json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const view = promoteBacklogItem(root, id, { taskId: options.task, milestoneId: options.milestone });
      write(renderOutput(view, { json: options.json }, renderPromoteHuman));
      if (!options.json) {
        const footer = getFooterForActiveMilestone(root);
        if (footer !== null) write(footer);
      }
    });

  backlog
    .command('archive <id>')
    .description('Archive a pending backlog item; no --milestone/--task -- archiving names no other work.')
    .requiredOption('--reason <text>', 'why this is being archived')
    .option('--json', 'output machine-readable JSON')
    .action((id: string, options: { reason: string; json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const view = archiveBacklogItem(root, id, options.reason);
      write(renderOutput(view, { json: options.json }, renderArchiveHuman));
      if (!options.json) {
        const footer = getFooterForActiveMilestone(root);
        if (footer !== null) write(footer);
      }
    });
}
