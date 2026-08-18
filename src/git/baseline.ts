import { checkWorkingTreeClean } from './safety.js';
import { composeMessage, resolveCommitSha } from './trailers.js';
import { commitOrResume } from './commit-or-resume.js';

export interface BaselineCommitOptions {
  milestoneId: string;
  // Files (or directory prefixes, expanded against the current dirty set)
  // this baseline is allowed to stage.
  paths: string[];
}

// The exact file set a milestone baseline commit may contain. Confirmation
// stages precisely these (subset check — clean entries are fine); anything
// else dirty, even inside the milestone directory, refuses the commit.
export function computeExpectedBaselinePaths(
  milestoneId: string,
  requirementId?: string | null,
): string[] {
  const paths = [
    '.pitway/config.yaml',
    '.pitway/state.yaml',
    `.pitway/milestones/${milestoneId}/contract.md`,
    `.pitway/milestones/${milestoneId}/tasks.yaml`,
    `.pitway/milestones/${milestoneId}/verification-results.yaml`,
    `.pitway/milestones/${milestoneId}/usage.yaml`,
  ];
  if (requirementId) paths.push(`.pitway/requirements/${requirementId}.md`);
  return paths;
}

// Expands caller-supplied files/directory prefixes into the exact dirty
// files they cover. One-directional only: with --untracked-files=all the
// status list is always individual files, so a dirty entry can never be a
// parent of an intended path.
function expandToDirtyFiles(cwd: string, paths: string[]): string[] {
  const { dirtyPaths } = checkWorkingTreeClean(cwd);
  return dirtyPaths.filter((dirty) =>
    paths.some((p) => {
      const base = p.replace(/\/+$/, '');
      return dirty === base || dirty.startsWith(`${base}/`);
    }),
  );
}

// Stages only the intended milestone artifacts and creates the baseline
// commit, resumably: if this milestone's baseline commit already exists
// (unique per milestone — matched by trailer, "workflow: add milestone"
// subject, and no task trailer), reports it idempotently. Unrelated dirty
// changes refuse the commit with nothing staged.
export function createBaselineCommit(cwd: string, options: BaselineCommitOptions): string {
  const expected = expandToDirtyFiles(cwd, options.paths);
  const message = composeMessage(`workflow: add milestone ${options.milestoneId}`, {
    'PitWay-Milestone': options.milestoneId,
  });
  const result = commitOrResume(cwd, {
    expectedPaths: expected,
    findExistingCommit: () =>
      resolveCommitSha(cwd, {
        milestone: options.milestoneId,
        messagePrefix: `workflow: add milestone ${options.milestoneId}`,
      }),
    localStateAdvanced: true,
    message,
  });
  return result.sha;
}
