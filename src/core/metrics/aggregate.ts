import { parse } from 'yaml';
import { z } from 'zod';
import { commitOrResume } from '../../git/commit-or-resume.js';
import { git } from '../../git/exec.js';
import { checkWorkingTreeClean } from '../../git/safety.js';
import { composeMessage, resolveCommitSha } from '../../git/trailers.js';
import { formatIssues } from '../../state/contract-file.js';
import { usageFileSchema, type Task, type Usage, type UsageFile } from '../../state/schemas.js';
import { loadUsage, saveUsage } from '../../state/store.js';

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
  // 'record' applied the delta; 'resume' only committed a pending recording
  // whose write had already landed (accumulation is not idempotent).
  operation: 'record' | 'resume';
  outcome: 'committed' | 'already-committed';
  commit: string;
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

const usageRepoPath = (milestoneId: string): string =>
  `.pitway/milestones/${milestoneId}/usage.yaml`;

const usageSubject = (milestoneId: string): string => `workflow: record usage for ${milestoneId}`;

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

function usageEquals(a: Usage, b: Usage): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.attempts === b.attempts &&
    a.input_tokens === b.input_tokens &&
    a.output_tokens === b.output_tokens &&
    a.total_tokens === b.total_tokens
  );
}

// AC008 identity: a usage-subject candidate whose committed usage.yaml parses
// equal to the currently persisted values. Each recording changes content
// (attempts strictly increases), so older usage commits never falsely match.
function findUsageCommit(root: string, milestoneId: string, persisted: UsageFile): string | undefined {
  const sha = resolveCommitSha(root, {
    milestone: milestoneId,
    messagePrefix: usageSubject(milestoneId),
  });
  if (sha === undefined) return undefined;
  let committed: unknown;
  try {
    committed = parse(git(['show', `${sha}:${usageRepoPath(milestoneId)}`], root));
  } catch {
    return undefined;
  }
  const parsed = usageFileSchema.safeParse(committed);
  if (!parsed.success) return undefined;
  return usageEquals(parsed.data.planning, persisted.planning) &&
    usageEquals(parsed.data.qa, persisted.qa)
    ? sha
    : undefined;
}

export function recordUsage(root: string, milestoneId: string, inputs: UsageAddInputs): UsageAddView {
  const category = parseCategory(inputs.category);
  if (inputs.usage === undefined) {
    throw new UsageAddError('usage-add requires --usage');
  }
  const delta = parseDelta(inputs.usage);
  const persisted = loadUsage(root, milestoneId);

  // AC008: unrelated dirty paths refuse the entire operation before anything
  // is written or staged.
  const usagePath = usageRepoPath(milestoneId);
  const { dirtyPaths } = checkWorkingTreeClean(root);
  const unexpected = dirtyPaths.filter((p) => p !== usagePath);
  if (unexpected.length > 0) {
    throw new UsageAddError(
      `cannot safely proceed: unrelated dirty changes present: ${unexpected.join(', ')}`,
    );
  }

  // A dirty usage.yaml means a prior recording persisted its accumulation but
  // its commit did not land; complete that commit without re-applying.
  const operation: 'record' | 'resume' = dirtyPaths.includes(usagePath) ? 'resume' : 'record';
  let updated = persisted;
  if (operation === 'record') {
    updated = { ...persisted };
    updated[category] = accumulate(persisted[category], delta);
    saveUsage(root, milestoneId, updated);
  }

  const result = commitOrResume(root, {
    expectedPaths: [usagePath],
    findExistingCommit: () => findUsageCommit(root, milestoneId, updated),
    localStateAdvanced: true,
    message: composeMessage(usageSubject(milestoneId), { 'PitWay-Milestone': milestoneId }),
  });
  return {
    id: milestoneId,
    category,
    operation,
    outcome: result.outcome,
    commit: result.sha,
    usage: updated[category],
  };
}

export interface UsageAggregate {
  // Sum of measured task usage plus planning plus qa; null when nothing at
  // all was measured. Measured and unavailable values are never blended.
  totalTokens: number | null;
  unmeasuredTasks: number;
}

// AC009: honest aggregation — tasks without measured usage contribute nothing
// and are counted instead; nothing is estimated or double-counted.
export function aggregateUsage(tasks: Task[], usage: UsageFile): UsageAggregate {
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
  return { totalTokens: measured ? total : null, unmeasuredTasks };
}
