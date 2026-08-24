import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { formatIssues } from '../../state/contract-file.js';
import { appendJournalEntry } from '../../state/journal.js';
import { type ReviewsFile, type Task, type Usage, type UsageFile } from '../../state/schemas.js';
import { loadUsage, saveUsage } from '../../state/store.js';
import { computeReviewUsageTotal } from '../reviews/roles.js';

export class UsageAddError extends Error {}

export type UsageCategory = 'planning' | 'qa';

const USAGE_CATEGORIES: UsageCategory[] = ['planning', 'qa'];

export interface UsageAddInputs {
  category?: string;
  // Measured token usage as a JSON string: {input_tokens?, output_tokens?, total_tokens}.
  usage?: string;
}

export interface UsageAddView {
  id: string;
  category: UsageCategory;
  // Materialized immediately to usage.yaml — no commit of its own; this
  // recording is folded into whichever checkpoint commit lands next (see
  // task-update's completion path and milestone-complete).
  usage: Usage;
}

// AC008 input: token fields only — attempts are incremented by the tool,
// never supplied; strictness rejects unknown fields, nonnegative rejects
// negative counts.
const usageDeltaSchema = z.strictObject({
  input_tokens: z.number().int().nonnegative().optional(),
  output_tokens: z.number().int().nonnegative().optional(),
  total_tokens: z.number().int().nonnegative(),
});

type UsageDelta = z.infer<typeof usageDeltaSchema>;

function parseCategory(input: string | undefined): UsageCategory {
  const match = USAGE_CATEGORIES.find((c) => c === input);
  if (match === undefined) {
    throw new UsageAddError(
      `usage-add requires --category ${USAGE_CATEGORIES.join('|')}` +
        (input === undefined ? '' : `; got "${input}"`),
    );
  }
  return match;
}

function parseDelta(text: string): UsageDelta {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new UsageAddError(`invalid --usage JSON: ${(error as Error).message}`);
  }
  const parsed = usageDeltaSchema.safeParse(data);
  if (!parsed.success) {
    throw new UsageAddError(`invalid --usage: ${formatIssues(parsed.error)}`);
  }
  return parsed.data;
}

// AC008 accumulation: attempts increments exactly once per recording; token
// fields sum what was measured — a field absent on both sides stays absent,
// absent plus present is the present value. Nothing is ever estimated.
function accumulate(prior: Usage, delta: UsageDelta): NonNullable<Usage> {
  if (prior === null) return { attempts: 1, ...delta };
  const sum = (a: number | undefined, b: number | undefined): number | undefined =>
    a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
  const input = sum(prior.input_tokens, delta.input_tokens);
  const output = sum(prior.output_tokens, delta.output_tokens);
  return {
    attempts: prior.attempts + 1,
    ...(input !== undefined ? { input_tokens: input } : {}),
    ...(output !== undefined ? { output_tokens: output } : {}),
    total_tokens: prior.total_tokens + delta.total_tokens,
  };
}

export function recordUsage(root: string, milestoneId: string, inputs: UsageAddInputs): UsageAddView {
  const category = parseCategory(inputs.category);
  if (inputs.usage === undefined) {
    throw new UsageAddError('usage-add requires --usage');
  }
  const delta = parseDelta(inputs.usage);
  const persisted = loadUsage(root, milestoneId);

  const updated = { ...persisted };
  updated[category] = accumulate(persisted[category], delta);
  const recorded = updated[category];

  // Journal first, then materialize — self-healing recovery (reconcilePending,
  // called from task-update's completion path and milestone-complete) can
  // always tell a crash-before-write apart from a crash-after-write by
  // comparing the target file's on-disk content against what a later
  // checkpoint commit actually captured.
  appendJournalEntry(root, {
    milestone: milestoneId,
    type: 'usage_recording',
    operationId: randomUUID(),
    target: category,
    payload: { category, ...recorded },
  });
  saveUsage(root, milestoneId, updated);

  return { id: milestoneId, category, usage: recorded };
}

export interface UsageAggregate {
  // Sum of measured task usage plus planning plus qa; null when nothing at
  // all was measured. Measured and unavailable values are never blended.
  totalTokens: number | null;
  unmeasuredTasks: number;
}

// AC009: honest aggregation — tasks without measured usage contribute nothing
// and are counted instead; nothing is estimated or double-counted.
// B026: `reviews` folds recorded milestone-review usage into totalTokens (the
// milestone's real total token cost) -- unmeasuredTasks stays task-only by
// name/meaning (existing "N tasks missing usage" wording depends on it); an
// unmeasured review-role recording contributes nothing to the total, same as
// an unmeasured task, but is never counted as a "task".
export function aggregateUsage(tasks: Task[], usage: UsageFile, reviews: ReviewsFile): UsageAggregate {
  let total = 0;
  let measured = false;
  let unmeasuredTasks = 0;
  for (const task of tasks) {
    if (task.usage === null) {
      unmeasuredTasks += 1;
    } else {
      total += task.usage.total_tokens;
      measured = true;
    }
  }
  for (const category of [usage.planning, usage.qa]) {
    if (category !== null) {
      total += category.total_tokens;
      measured = true;
    }
  }
  const reviewUsage = computeReviewUsageTotal(reviews);
  if (reviewUsage.total !== null) {
    total += reviewUsage.total;
    measured = true;
  }
  return { totalTokens: measured ? total : null, unmeasuredTasks };
}
