import { parse } from 'yaml';
import { git } from '../../git/exec.js';
import { resolveCommitSha } from '../../git/trailers.js';
import { loadContract, resolveMilestoneDirName } from '../../state/store.js';
import type { TaskResult } from './result-input.js';
import { TaskUpdateError } from './update-error.js';

// M039/T001: extracted verbatim from src/core/tasks/update.ts -- a responsibility split, not a redesign.

// AC005/T005 (M012): the milestone's own base_revision, when tracked, to
// bound trailer lookups -- undefined (unbounded, today's exact behavior)
// under main strategy or when no base_revision is recorded.
export function milestoneSince(root: string, milestoneId: string): string | undefined {
  return loadContract(root, milestoneId).frontmatter.base_revision ?? undefined;
}

// Directory names are assigned once at creation and never renamed (AC007),
// so resolving against the current on-disk listing is correct even when
// looking up content at a past commit via git show.
export const tasksRepoPath = (root: string, milestoneId: string): string =>
  `.pitway/milestones/${resolveMilestoneDirName(root, milestoneId)}/tasks.yaml`;

export interface CommittedTaskRecord {
  id?: unknown;
  status?: unknown;
  result?: { summary?: unknown; evidence?: unknown } | null;
}

// AC018 task-specific identity: candidate matched by both trailers; identity
// holds iff, in the committed tasks.yaml at that SHA, the target task's record
// alone shows completed with a result equal to the persisted one. Sibling task
// changes are ignored — this is a parsed comparison, not byte equality.
export function findCompletionCommit(
  root: string,
  milestoneId: string,
  taskId: string,
  persisted: TaskResult,
): string | undefined {
  const since = milestoneSince(root, milestoneId);
  const sha = resolveCommitSha(root, {
    milestone: milestoneId,
    task: taskId,
    ...(since !== undefined ? { since } : {}),
  });
  if (sha === undefined) return undefined;
  let record: CommittedTaskRecord | undefined;
  try {
    const data = parse(git(['show', `${sha}:${tasksRepoPath(root, milestoneId)}`], root)) as {
      tasks?: CommittedTaskRecord[];
    };
    record = data.tasks?.find((t) => t.id === taskId);
  } catch {
    record = undefined;
  }
  const matches =
    record !== undefined &&
    record.status === 'completed' &&
    record.result != null &&
    record.result.summary === persisted.summary &&
    record.result.evidence === persisted.evidence;
  if (!matches) {
    throw new TaskUpdateError(
      `ambiguous state: commit ${sha} carries the ${taskId} completion trailers but its ` +
        `committed record does not match the persisted result; inspect manually`,
    );
  }
  return sha;
}
