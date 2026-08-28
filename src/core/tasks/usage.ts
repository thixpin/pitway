import { formatIssues } from '../../state/contract-file.js';
import { readJournal } from '../../state/journal.js';
import { taskUsageSchema, type TaskUsage } from '../../state/schemas.js';
import { TaskUpdateError } from './update-error.js';

// M039/T001: extracted verbatim from src/core/tasks/update.ts -- a responsibility split, not a redesign.

export function parseUsageInput(text: string): TaskUsage {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new TaskUpdateError(`invalid --usage JSON: ${(error as Error).message}`);
  }
  const parsed = taskUsageSchema.safeParse(data);
  if (!parsed.success) {
    throw new TaskUpdateError(`invalid --usage: ${formatIssues(parsed.error)}`);
  }
  return parsed.data;
}

// AC016: accumulate honestly onto prior measured usage — sum what was
// measured, keep a field absent when neither side measured it, never estimate.
export function accumulateUsage(prior: TaskUsage, delta: TaskUsage): TaskUsage {
  if (delta === null) return prior;
  if (prior === null) return delta;
  const sum = (a: number | undefined, b: number | undefined): number | undefined =>
    a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
  const input = sum(prior.input_tokens, delta.input_tokens);
  const output = sum(prior.output_tokens, delta.output_tokens);
  return {
    ...(input !== undefined ? { input_tokens: input } : {}),
    ...(output !== undefined ? { output_tokens: output } : {}),
    total_tokens: prior.total_tokens + delta.total_tokens,
  };
}

// M017/T003 (AC005): fresh-completion-only detection -- a task with no
// worktree_dispatch record at all (never dispatched, or an inline sub-agent
// dispatch that leaves none) never warns; supplying --usage always
// suppresses it regardless of dispatch history.
// B019 (qc-f0f57dfa): warning is actionable -- it names the dispatch.md MUST
// rule (forward the sub-agent tool-result usage via --usage).
// B033 (qc-20ca12b6): the fallback this used to name -- pitway usage-add
// <id> --category task -- never existed (usage-add only supports
// milestone-level planning|qa; task-amend cannot touch usage either).
// There is genuinely no retroactive path once a task completes without
// --usage, so the warning says that plainly instead of pointing at a
// dead-end command.
export function computeUsageWarning(
  root: string,
  milestoneId: string,
  taskId: string,
  usageProvided: boolean,
): string | null {
  if (usageProvided) return null;
  const wasWorktreeDispatched = readJournal(root).some(
    (r) => r.kind === 'worktree_dispatch' && r.milestone === milestoneId && r.taskId === taskId,
  );
  if (!wasWorktreeDispatched) return null;
  return (
    `${taskId} was completed after a worktree dispatch with no --usage supplied; ` +
    `its usage stays null -> N/A (detection only, never estimated). ` +
    `Forward the dispatched sub-agent's reported usage via --usage on this completing call per dispatch.md step 8 -- ` +
    `this cannot be added retroactively once the task is completed; if the usage is genuinely unavailable, null is correct`
  );
}
