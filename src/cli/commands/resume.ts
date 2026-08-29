import type { Command } from 'commander';
import {
  buildResumeView,
  type BlockedTaskDetail,
  type DriverDriftView,
  type PendingBacklogItem,
  type PendingJournalEntryView,
  type PendingQuickChange,
  type PendingRepairView,
  type ResumeView,
  type WaitingTaskDetail,
} from '../../core/views/resume.js';
import { renderOutput } from '../output.js';
import { taskStatusLabel } from '../format.js';

// B037: view assembly lives in src/core/views/resume.ts; this module only
// registers the command and renders the view for humans.

function renderPendingQuickChangesHuman(pending: PendingQuickChange[]): string[] {
  if (pending.length === 0) return [];
  const lines = ['🔧 Pending quick-changes'];
  for (const qc of pending) {
    lines.push(`  ${qc.id}  ${qc.status}  ${qc.objective}`);
  }
  return lines;
}

function renderPendingBacklogItemsHuman(pending: PendingBacklogItem[]): string[] {
  if (pending.length === 0) return [];
  const lines = [`🔧 Pending backlog items (${pending.length})`];
  for (const item of pending) {
    lines.push(`  ${item.id}  ${item.title}`);
  }
  return lines;
}

// M036/T005: same block-with-indented-lines convention as the worktree
// residues block below.
function renderWaitingDetailsHuman(details: WaitingTaskDetail[] | undefined): string[] {
  if (details === undefined || details.length === 0) return [];
  const lines = ['⏳ Waiting task details'];
  for (const d of details) {
    lines.push(`  ${d.id}  ${d.detail}`);
  }
  return lines;
}

function renderBlockedDetailsHuman(details: BlockedTaskDetail[] | undefined): string[] {
  if (details === undefined || details.length === 0) return [];
  const lines = ['🔧 Blocked task details'];
  for (const d of details) {
    lines.push(`  ${d.id}  ${d.detail}`);
  }
  return lines;
}

// M044/T005: the two recovery inputs resume never listed before -- same
// block-with-indented-lines convention as the other detail sections.
function renderPendingJournalHuman(entries: PendingJournalEntryView[] | undefined): string[] {
  if (entries === undefined || entries.length === 0) return [];
  const lines = [`📜 Pending journal entries (${entries.length}) — checkpointed by the next commit`];
  for (const e of entries) {
    lines.push(`  ${e.type}  ${e.target}  ${e.operationId}`);
  }
  return lines;
}

function renderPendingRepairHuman(repair: PendingRepairView | undefined): string[] {
  if (repair === undefined) return [];
  return [
    `🔧 Pending verification repair ${repair.id}`,
    `  files: ${repair.files.join(', ')}`,
    `  checks: ${repair.checks.join(', ')}`,
    `  Finish with verification-repair commit, or verification-repair cancel.`,
  ];
}

function renderDriverDriftHuman(drift: DriverDriftView | undefined): string[] {
  if (drift === undefined) return [];
  return [
    `⚙️  Configuration drift detected (${drift.drivers.join(', ')})`,
    `  Run: ${drift.suggestedCommand}`,
  ];
}

// The human-readable text output alone, with zero extra commands, must show
// a pending quick-change exists (AC003) -- so the pending-quick-change block
// is appended in both branches below, not gated behind an active milestone.
export function renderResumeHuman(view: ResumeView): string {
  const quickChangeLines = renderPendingQuickChangesHuman(view.pendingQuickChanges);
  const backlogLines = renderPendingBacklogItemsHuman(view.pendingBacklogItems);
  const driftLines = renderDriverDriftHuman(view.driverDrift);

  if (!view.activeMilestone) {
    const lines = ['No active milestone. Run milestone-add to start one.'];
    if (quickChangeLines.length > 0) lines.push('', ...quickChangeLines);
    if (backlogLines.length > 0) lines.push('', ...backlogLines);
    if (driftLines.length > 0) lines.push('', ...driftLines);
    return lines.join('\n');
  }

  const lines = [
    `🏁 Resuming ${view.activeMilestone} — ${view.title}`,
    `Contract: ${view.contractStatus}`,
  ];
  if (view.branch) {
    lines.push(
      view.branch.matches
        ? `Branch: ${view.branch.actual} (tracked, checked out)`
        : `Branch mismatch: expected ${view.branch.expected}, currently on ${view.branch.actual} — switch manually`,
    );
  }
  lines.push('', '🛠 Tasks');
  for (const t of view.tasks) {
    lines.push(t.name !== null ? `  ${t.id}  ${t.name}  ${taskStatusLabel(t.status)}` : `  ${t.id}  ${taskStatusLabel(t.status)}`);
  }
  lines.push('');
  lines.push(`Ready: ${view.ready.join(', ') || '(none)'}`);
  lines.push(`Waiting: ${view.waiting.join(', ') || '(none)'}`);
  lines.push(`Blocked: ${view.blocked.join(', ') || '(none)'}`);
  lines.push(`In progress: ${view.inProgress.join(', ') || '(none)'}`);
  lines.push('');
  if (view.inProgress.length > 0) {
    // A task is already underway: report it as the continuation target
    // rather than as a ready-task recommendation.
    lines.push(`Continue: ${view.nextTask}`);
  } else {
    lines.push(view.nextTask ? `Next: ${view.nextTask}` : 'Next: (no ready task)');
  }
  if (view.parallel !== null) {
    if (view.parallel.activeDispatches.length > 0) {
      lines.push('', '🏎️ Dispatched worktrees');
      for (const d of view.parallel.activeDispatches) {
        lines.push(`  ${d.taskId}  ${d.branch}  ${d.worktreePath}`);
      }
    }
    if (view.parallel.residues.length > 0) {
      lines.push('', '🔧 Worktree residues (read-only report)');
      for (const r of view.parallel.residues) {
        lines.push(`  [${r.class}] ${r.detail}`);
      }
    }
  }
  if (view.parallelEligible !== undefined) {
    lines.push('', `🏎️ Parallel-eligible ready tasks: ${view.parallelEligible.join(', ')}`);
    lines.push('  Consider parallel dispatch (task-dispatch <id>) for these.');
  }
  const waitingDetailLines = renderWaitingDetailsHuman(view.waitingDetails);
  const blockedDetailLines = renderBlockedDetailsHuman(view.blockedDetails);
  if (waitingDetailLines.length > 0) lines.push('', ...waitingDetailLines);
  if (blockedDetailLines.length > 0) lines.push('', ...blockedDetailLines);
  const pendingJournalLines = renderPendingJournalHuman(view.pendingJournal);
  const pendingRepairLines = renderPendingRepairHuman(view.pendingRepair);
  if (pendingJournalLines.length > 0) lines.push('', ...pendingJournalLines);
  if (pendingRepairLines.length > 0) lines.push('', ...pendingRepairLines);
  if (quickChangeLines.length > 0) lines.push('', ...quickChangeLines);
  if (backlogLines.length > 0) lines.push('', ...backlogLines);
  if (driftLines.length > 0) lines.push('', ...driftLines);
  if (view.openReview !== undefined) {
    lines.push(
      '',
      `📜 Open review ${view.openReview.sessionId} (${view.openReview.milestone}) — ` +
        `roles: ${view.openReview.roles.join(', ')} — ` +
        `recorded ${view.openReview.recordedCount}/${view.openReview.roles.length}`,
    );
  }
  if (view.footer !== null) lines.push('', view.footer);
  return lines.join('\n');
}

export interface CommandDeps {
  root?: string;
  write?: (line: string) => void;
}

export function registerResumeCommand(program: Command, deps: CommandDeps = {}): void {
  const write = deps.write ?? ((line: string) => console.log(line));
  program
    .command('resume')
    .description('Reconstruct workflow state from .pitway/ and recommend the next task.')
    .option('--json', 'output machine-readable JSON')
    .action((options: { json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const view = buildResumeView(root);
      write(renderOutput(view, { json: options.json }, renderResumeHuman));
    });
}
