import { checkWorkingTreeClean } from './safety.js';
import { composeMessage, resolveCommitSha } from './trailers.js';
import { commitOrResume } from './commit-or-resume.js';

export interface BaselineCommitOptions {
  milestoneId: string;
  // Files (or directory prefixes, expanded against the current dirty set)
  // this baseline is allowed to stage.
  paths: string[];
  // AC005/T005 (M012): the milestone's own base_revision, when tracked
  // (branch_strategy: milestone) -- bounds the baseline-commit lookup to
  // `since..HEAD`. Omitted (main strategy, or no base_revision recorded)
  // preserves today's unbounded scan exactly.
  since?: string;
}

// The exact file set a milestone baseline commit may contain. Confirmation
// stages precisely these (subset check — clean entries are fine); anything
// else dirty, even inside the milestone directory, refuses the commit.
//
// `milestoneDir` is the already-resolved repo-relative directory NAME (bare
// or slugged) for this milestone, not the bare canonical id — resolution
// lives in the State layer (src/state/store.ts's resolveMilestoneDirName);
// this Git-layer module stays free of any State import, receiving the
// resolved value from its Core-layer caller instead (see confirm.ts).
//
// `extraExpectedPaths` (M006 hotfix): exact repo-relative file paths beyond
// `.pitway/` that this baseline may also cover -- e.g. init-installed
// driver assets, .claude/ and .opencode/ alike (resolved content-aware by
// src/state/managed-init-paths.ts's listSafeManagedDirtyPaths over
// driver-assets.ts's hardcoded driver list, M023/T002).
// This module has zero knowledge of what those paths are or represent; the
// Core-layer caller resolves the exact managed set and passes it in, the
// same agent-agnostic-boundary pattern already used for milestoneDir above.
// Never a directory prefix or glob here -- each entry is one exact file, so
// an unmanaged file living alongside managed ones is never silently
// accepted.
export function computeExpectedBaselinePaths(
  milestoneDir: string,
  requirementId?: string | null,
  extraExpectedPaths: string[] = [],
): string[] {
  const paths = [
    '.pitway/config.yaml',
    '.pitway/state.yaml',
    `.pitway/milestones/${milestoneDir}/contract.md`,
    `.pitway/milestones/${milestoneDir}/tasks.yaml`,
    `.pitway/milestones/${milestoneDir}/verification-results.yaml`,
    `.pitway/milestones/${milestoneDir}/verification-repairs.yaml`,
    `.pitway/milestones/${milestoneDir}/usage.yaml`,
    // M015/T008 (AC008): a reviewed draft must confirm cleanly -- its
    // reviews.yaml (materialized via review start/record before
    // confirmation) rides the baseline commit like every other
    // per-milestone file above. Subset semantics keep this harmless when
    // the file is absent (no review ever happened before confirm).
    `.pitway/milestones/${milestoneDir}/reviews.yaml`,
    ...extraExpectedPaths,
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
        ...(options.since !== undefined ? { since: options.since } : {}),
      }),
    localStateAdvanced: true,
    message,
  });
  return result.sha;
}
