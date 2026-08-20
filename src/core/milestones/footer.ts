import type { MilestoneStatus, Task } from '../../state/schemas.js';
import { computeWorkloadPercentage } from './workload.js';
import type { MilestoneProgress } from './progress.js';

// AC004 (M013): the same next-dependency-ready-task resolution resume.ts's
// buildResumeView already computed privately -- extracted here so resume and
// milestone-status share one implementation instead of duplicating it.
// In-progress task wins (lowest id, though the state machine normally
// allows at most one); otherwise the lowest ready task id; otherwise null.
export function resolveNextTask(tasks: Task[]): string | null {
  const inProgress = tasks
    .filter((t) => t.status === 'in_progress')
    .map((t) => t.id)
    .sort();
  if (inProgress.length > 0) return inProgress[0]!;
  const ready = tasks
    .filter((t) => t.status === 'ready')
    .map((t) => t.id)
    .sort();
  if (ready.length > 0) return ready[0]!;
  return null;
}

// AC004 (M013): the one-line racing footer, already in live use as an
// informal driver convention. Icon precedence, evaluated in this order:
// completed (🏁, trailing "Complete") > blocked (🔧) > verification-only-
// remains (🏁, same icon as completed, distinguished by trailing text) >
// running (🏎️, default). Returns null when status is draft -- silence is
// the signal, no footer before confirmation.
export function computeRacingFooter(
  status: MilestoneStatus,
  progress: MilestoneProgress,
  verificationPassed: boolean,
  tasks: Task[],
): string | null {
  if (status === 'draft') return null;

  const workload = computeWorkloadPercentage(status, progress, verificationPassed);
  const countSegment = `✅ ${progress.completed}/${progress.total}`;

  if (status === 'completed') {
    return `🏁 ${workload}% · ${countSegment} · Complete`;
  }

  const blocked = tasks
    .filter((t) => t.status === 'blocked')
    .map((t) => t.id)
    .sort();
  const allRequiredDone = progress.total > 0 && progress.completed === progress.total;

  // A task-id gate carries the task's short name as one further ` · `
  // segment when present (`Next: T003 · git worktree module`) -- the footer
  // stays a single concise line; anything longer than the name (narration,
  // status prose) never belongs in it. Named gates (verification, developer
  // approval) and name-less tasks render byte-identically to before.
  const taskGate = (id: string): string => {
    const name = tasks.find((t) => t.id === id)?.name;
    return name ? `${id} · ${name}` : id;
  };

  let icon: string;
  let gate: string;
  if (blocked.length > 0) {
    icon = '🔧';
    gate = taskGate(blocked[0]!);
  } else if (allRequiredDone) {
    icon = '🏁';
    gate = verificationPassed ? 'developer approval' : 'verification';
  } else {
    icon = '🏎️';
    const next = resolveNextTask(tasks);
    gate = next === null ? 'verification' : taskGate(next);
  }

  return `${icon} ${workload}% · ${countSegment} · Next: ${gate}`;
}
