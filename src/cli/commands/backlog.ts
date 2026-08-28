import type { Command } from 'commander';
import { addBacklogItem, type BacklogAddView } from '../../core/backlog/add.js';
import { promoteBacklogItem, type BacklogPromoteView } from '../../core/backlog/promote.js';
import { archiveBacklogItem, type BacklogArchiveView } from '../../core/backlog/archive.js';
import { listBacklogItems } from '../../core/backlog/list.js';
import { showBacklogItem } from '../../core/backlog/show.js';
import type { BacklogItem, BacklogReference, BacklogStatus } from '../../state/schemas.js';
import { renderOutput } from '../output.js';
import { renderTable } from '../table.js';
import { writeActiveMilestoneFooter } from '../footer.js';

export interface CommandDeps {
  root?: string;
  write?: (line: string) => void;
}

function renderAddHuman(view: BacklogAddView): string {
  return `🔧 ${view.id} recorded as ${view.status}.`;
}

export function formatSource(source: BacklogReference): string {
  if (source.task !== null && source.task !== undefined) {
    // source.milestone is guaranteed present when task is present
    return `${source.milestone}/${source.task}`;
  }
  if (source.milestone !== null && source.milestone !== undefined) return source.milestone;
  return '—';
}

const WRAP_WIDTH = 80;

/**
 * Word-wrap text at ~80 columns while preserving Markdown-ish structure.
 * - Blank lines preserved
 * - Headings (#), bullet lists (-, *, 1.) keep their prefix on first line
 *   and continuation lines are indented to align with content
 * - Otherwise normal word-wrap at spaces; long words without spaces are
 *   hard-broken to avoid exceeding width
 */
export function wrapText(text: string, width: number = WRAP_WIDTH): string {
  if (text === '') return '';
  const rawLines = text.split('\n');
  const out: string[] = [];

  for (const raw of rawLines) {
    if (raw.trim() === '') {
      out.push('');
      continue;
    }

    // Detect markdown prefix on this logical line
    // Heading: #..###### + space
    const headingMatch = raw.match(/^(\s*#{1,6}\s+)/);
    if (headingMatch) {
      const prefix = headingMatch[1]!;
      const rest = raw.slice(prefix.length);
      // Headings are short; wrap rest normally but keep heading marker only on first line
      if (raw.length <= width) {
        out.push(raw);
      } else {
        const wrapped = wrapWords(rest, width - prefix.length, width, prefix, ''.padEnd(prefix.length, ' '));
        out.push(...wrapped);
      }
      continue;
    }

    const bulletMatch = raw.match(/^(\s*)([-*]\s+|\d+\.\s+)/);
    if (bulletMatch) {
      const prefix = bulletMatch[0]!;
      const indent = ' '.repeat(prefix.length);
      const content = raw.slice(prefix.length);
      if (raw.length <= width) {
        out.push(raw);
      } else {
        const wrapped = wrapWords(content, width - prefix.length, width - indent.length, prefix, indent);
        out.push(...wrapped);
      }
      continue;
    }

    // Plain paragraph line
    if (raw.length <= width) {
      out.push(raw);
    } else {
      const wrapped = wrapWords(raw, width, width, '', '');
      out.push(...wrapped);
    }
  }

  return out.join('\n');
}

function wrapWords(
  content: string,
  firstWidth: number,
  subsequentWidth: number,
  firstPrefix: string,
  contPrefix: string,
): string[] {
  if (content.trim() === '') return [firstPrefix.trimEnd()];
  const words = content.split(/\s+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let current = '';
  let isFirstLine = true;

  function availableWidth(): number {
    return isFirstLine ? firstWidth : subsequentWidth;
  }
  function prefix(): string {
    return isFirstLine ? firstPrefix : contPrefix;
  }

  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (candidate.length <= availableWidth()) {
      current = candidate;
    } else {
      // flush current
      if (current !== '') {
        lines.push(`${prefix()}${current}`);
        isFirstLine = false;
        current = '';
      }
      // If single word longer than available width, hard-break it
      if (word.length > availableWidth()) {
        let remaining = word;
        const w = availableWidth();
        while (remaining.length > w) {
          lines.push(`${prefix()}${remaining.slice(0, w)}`);
          isFirstLine = false;
          remaining = remaining.slice(w);
        }
        current = remaining;
      } else {
        current = word;
      }
    }
  }
  if (current !== '' || lines.length === 0) {
    lines.push(`${prefix()}${current}`);
  }
  return lines;
}

export function renderItemHuman(item: BacklogItem): string {
  const lines: string[] = [];
  lines.push(`${item.id} [${item.status}] ${item.title}`);
  lines.push(`Source: ${formatSource(item.source)}`);
  lines.push(`Status: ${item.status}`);
  if (item.promoted_to) {
    lines.push(`Promoted to: ${formatSource(item.promoted_to)}`);
  }
  if (item.archived_reason) {
    lines.push(`Archived: ${item.archived_reason}`);
  }
  lines.push('');
  lines.push(wrapText(item.reason, WRAP_WIDTH));
  return lines.join('\n');
}

export function renderListHuman(
  items: BacklogItem[],
  filters?: { status?: string; milestone?: string; task?: string },
): string {
  const parts: string[] = [];
  if (filters?.status !== undefined) parts.push(`status=${filters.status}`);
  if (filters?.milestone !== undefined) parts.push(`milestone=${filters.milestone}`);
  if (filters?.task !== undefined) parts.push(`task=${filters.task}`);
  const header = parts.length > 0 ? `Backlog (filtered: ${parts.join(', ')})` : null;
  if (items.length === 0) {
    const body = 'No backlog items recorded.';
    return header ? `${header}\n${body}` : body;
  }
  const headers = ['ID', 'Status', 'Source', 'Title'];
  const rows = items.map((item) => [item.id, item.status, formatSource(item.source), item.title]);
  const tableLines = renderTable(headers, rows);
  const body = tableLines.join('\n');
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
      writeActiveMilestoneFooter(root, write, options);
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
      writeActiveMilestoneFooter(root, write, options);
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
      writeActiveMilestoneFooter(root, write, options);
    });
}
