import type { Command } from 'commander';
import { currentBranch } from '../../git/branch.js';
import { deterministicBranchName } from '../../core/milestones/confirm.js';
import { loadContract, loadState, loadTasks } from '../../state/store.js';
import { deriveQuickChangeState, readAllQuickChanges } from '../../core/quick-change/create.js';
import { renderOutput } from '../output.js';
import { taskStatusLabel } from '../format.js';
import type { MilestoneStatus, Task, TaskStatus } from '../../state/schemas.js';
import type { JournalQuickChange, JournalQuickChangeStatus } from '../../state/journal.js';

export interface PendingQuickChange {
  id: string;
  status: JournalQuickChangeStatus;
  objective: string;
}

// AC004/T004 (M012): present only when the active milestone tracks a branch
// (base_branch non-null under branch_strategy: milestone) -- absent, not
// merely blank, for a main-strategy or untracked milestone.
export interface ResumeBranchView {
  expected: string;
  actual: string;
  matches: boolean;
}

export interface ResumeView {
  activeMilestone: string | null;
  contractStatus: MilestoneStatus | null;
  title: string | null;
  tasks: Array<{ id: string; status: TaskStatus }>;
  ready: string[];
  waiting: string[];
  blocked: string[];
  inProgress: string[];
  nextTask: string | null;
  pendingQuickChanges: PendingQuickChange[];
  branch?: ResumeBranchView;
}

function idsWithStatus(tasks: Task[], status: TaskStatus): string[] {
  return tasks.filter((t) => t.status === status).map((t) => t.id);
}

// AC003: `pitway resume` is the authoritative recovery view for a pending
// quick-change -- a fresh session must discover and be able to act on one
// from resume's own output alone, with no separate `quick-change status`
// call required. "Actionable" mirrors the still-open portion of
// JournalQuickChangeStatus: draft/approved always qualify; a record with a
// recorded run attempt but not yet committed/cancelled/promoted would also
// qualify, though under today's lifecycle (run only ever transitions a
// still-approved record) that case never actually arises separately from
// the approved check above -- kept explicit anyway per AC003's own wording,
// and so this stays correct if a future lifecycle change ever decouples
// runs from status.
function isActionable(record: JournalQuickChange): boolean {
  if (record.status === 'draft' || record.status === 'approved') return true;
  return (
    record.runs.length > 0 &&
    record.status !== 'committed' &&
    record.status !== 'cancelled' &&
    record.status !== 'promoted'
  );
}

function derivePendingQuickChanges(root: string): PendingQuickChange[] {
  const all = readAllQuickChanges(root);
  const ids = Array.from(new Set(all.map((r) => r.id)));
  const pending: PendingQuickChange[] = [];
  for (const id of ids) {
    const latest = deriveQuickChangeState(all, id);
    if (latest !== undefined && isActionable(latest)) {
      pending.push({ id: latest.id, status: latest.status, objective: latest.objective });
    }
  }
  return pending;
}

// Reads only .pitway/ — no conversation or session input required. When
// multiple tasks are ready, recommends the lowest task id (declared order),
// deterministically, with no other prioritization in MVP.
export function buildResumeView(root: string): ResumeView {
  const pendingQuickChanges = derivePendingQuickChanges(root);
  const state = loadState(root);
  if (!state.active_milestone) {
    return {
      activeMilestone: null,
      contractStatus: null,
      title: null,
      tasks: [],
      ready: [],
      waiting: [],
      blocked: [],
      inProgress: [],
      nextTask: null,
      pendingQuickChanges,
    };
  }

  const contract = loadContract(root, state.active_milestone);
  const tasksFile = loadTasks(root, state.active_milestone);
  const ready = idsWithStatus(tasksFile.tasks, 'ready').sort();
  // AC010: an in_progress task is the continuation target and takes priority
  // over any ready recommendation; the lowest-ready-id pick applies only
  // when no task is in_progress. The state machine normally allows at most
  // one in_progress task, but pick the lowest id deterministically anyway.
  const inProgress = idsWithStatus(tasksFile.tasks, 'in_progress').sort();

  // AC004/T004: read-only orientation only -- never a git mutation of any
  // kind. Present only when this milestone tracks a branch.
  const { base_branch: baseBranch, title } = contract.frontmatter;
  const branch: ResumeBranchView | undefined =
    baseBranch != null
      ? (() => {
          const expected = deterministicBranchName(state.active_milestone!, title);
          const actual = currentBranch(root);
          return { expected, actual, matches: actual === expected };
        })()
      : undefined;

  return {
    activeMilestone: state.active_milestone,
    contractStatus: contract.frontmatter.status,
    title: contract.frontmatter.title,
    tasks: tasksFile.tasks.map((t) => ({ id: t.id, status: t.status })),
    ready,
    waiting: idsWithStatus(tasksFile.tasks, 'waiting'),
    blocked: idsWithStatus(tasksFile.tasks, 'blocked'),
    inProgress,
    nextTask: inProgress.length > 0 ? inProgress[0]! : ready.length > 0 ? ready[0]! : null,
    pendingQuickChanges,
    ...(branch ? { branch } : {}),
  };
}

function renderPendingQuickChangesHuman(pending: PendingQuickChange[]): string[] {
  if (pending.length === 0) return [];
  const lines = ['🔧 Pending quick-changes'];
  for (const qc of pending) {
    lines.push(`  ${qc.id}  ${qc.status}  ${qc.objective}`);
  }
  return lines;
}

// The human-readable text output alone, with zero extra commands, must show
// a pending quick-change exists (AC003) -- so the pending-quick-change block
// is appended in both branches below, not gated behind an active milestone.
export function renderResumeHuman(view: ResumeView): string {
  const quickChangeLines = renderPendingQuickChangesHuman(view.pendingQuickChanges);

  if (!view.activeMilestone) {
    const lines = ['No active milestone. Run milestone-add to start one.'];
    if (quickChangeLines.length > 0) lines.push('', ...quickChangeLines);
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
    lines.push(`  ${t.id}  ${taskStatusLabel(t.status)}`);
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
  if (quickChangeLines.length > 0) lines.push('', ...quickChangeLines);
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
