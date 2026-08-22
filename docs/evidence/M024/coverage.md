# M024 Coverage Evidence — Global Branch Coverage Hardening

## Metric definition (AC001)

Branch coverage comes from a real full-suite run's `coverage/lcov.info` BRDA
records (the Codecov-aligned metric): a branch counts as covered only when
its `taken` field is a positive count — this provider emits `0`, not `-`,
for untaken branches. Line coverage comes from LF/LH. Measured with
`npm run test:coverage` (vitest, v8 provider). No coverage configuration was
changed in this milestone (AC008).

## Before / after

| | branches | lines | files below 90/90 |
|---|---|---|---|
| BEFORE (milestone base cb7c714) | 1727/2002 (86.3%) | 3070/3218 (95.4%) | 51 of 101 |
| AFTER (final gate run) | 1933/2002 (96.6%) | 3176/3218 (98.7%) | 2 of 101, excluding the disclosed cli/index.ts |

The authoritative AFTER run: 88 test files, 1685 tests, all passing.
The BEFORE table was re-measured at the milestone base commit cb7c714 (whose
src/tests tree is byte-identical to the recorded post-qc-90a293e4 baseline)
so every per-file before number is real lcov data; it matches the contract's
recorded overall baseline (branches 86.3%, lines 95.4%).

Mid-milestone correction, disclosed: T001–T004's own per-task measurements
over-reported branch coverage by treating BRDA taken=0 as covered; the T005
gate exposed five files still below the bar, closed via the amended T005
scope with targeted behavioral tests (see contract Change Log, 2026-08-22).
No production file was modified anywhere in this milestone.

## Per-file detail (all src files)

| file | branches before | lines before | branches after | lines after |
|---|---|---|---|---|
| `src/cli/commands/auto-run.ts` | 13/25 (52.0%) | 38/44 (86.4%) | 25/25 (100.0%) | 44/44 (100.0%) |
| `src/cli/commands/backlog.ts` | 3/19 (15.8%) | 11/29 (37.9%) | 19/19 (100.0%) | 29/29 (100.0%) |
| `src/cli/commands/init.ts` | 38/42 (90.5%) | 51/52 (98.1%) | 38/42 (90.5%) | 51/52 (98.1%) |
| `src/cli/commands/milestone-add.ts` | 9/11 (81.8%) | 14/14 (100.0%) | 11/11 (100.0%) | 14/14 (100.0%) |
| `src/cli/commands/milestone-cancel.ts` | 3/5 (60.0%) | 6/6 (100.0%) | 5/5 (100.0%) | 6/6 (100.0%) |
| `src/cli/commands/milestone-complete.ts` | 4/7 (57.1%) | 7/7 (100.0%) | 7/7 (100.0%) | 7/7 (100.0%) |
| `src/cli/commands/milestone-confirm.ts` | 7/11 (63.6%) | 10/10 (100.0%) | 11/11 (100.0%) | 10/10 (100.0%) |
| `src/cli/commands/milestone-list.ts` | 3/5 (60.0%) | 11/11 (100.0%) | 5/5 (100.0%) | 11/11 (100.0%) |
| `src/cli/commands/milestone-merge.ts` | 5/7 (71.4%) | 8/8 (100.0%) | 7/7 (100.0%) | 8/8 (100.0%) |
| `src/cli/commands/milestone-review.ts` | 50/53 (94.3%) | 77/77 (100.0%) | 50/53 (94.3%) | 77/77 (100.0%) |
| `src/cli/commands/milestone-status.ts` | 71/83 (85.5%) | 88/88 (100.0%) | 83/83 (100.0%) | 88/88 (100.0%) |
| `src/cli/commands/quick-change.ts` | 16/35 (45.7%) | 41/51 (80.4%) | 35/35 (100.0%) | 51/51 (100.0%) |
| `src/cli/commands/resume.ts` | 79/93 (84.9%) | 105/113 (92.9%) | 93/93 (100.0%) | 113/113 (100.0%) |
| `src/cli/commands/task-add.ts` | 7/9 (77.8%) | 9/10 (90.0%) | 9/9 (100.0%) | 10/10 (100.0%) |
| `src/cli/commands/task-amend.ts` | 7/9 (77.8%) | 10/10 (100.0%) | 9/9 (100.0%) | 10/10 (100.0%) |
| `src/cli/commands/task-discard.ts` | 5/7 (71.4%) | 6/6 (100.0%) | 7/7 (100.0%) | 6/6 (100.0%) |
| `src/cli/commands/task-dispatch.ts` | 3/5 (60.0%) | 6/6 (100.0%) | 5/5 (100.0%) | 6/6 (100.0%) |
| `src/cli/commands/task-integrate.ts` | 8/8 (100.0%) | 9/9 (100.0%) | 8/8 (100.0%) | 9/9 (100.0%) |
| `src/cli/commands/task-status.ts` | 17/23 (73.9%) | 28/29 (96.6%) | 23/23 (100.0%) | 29/29 (100.0%) |
| `src/cli/commands/task-update.ts` | 16/19 (84.2%) | 13/13 (100.0%) | 18/19 (94.7%) | 13/13 (100.0%) |
| `src/cli/commands/task-verify.ts` | 21/21 (100.0%) | 9/9 (100.0%) | 21/21 (100.0%) | 9/9 (100.0%) |
| `src/cli/commands/usage-add.ts` * | 4/7 (57.1%) | 7/7 (100.0%) | 6/7 (85.7%) | 7/7 (100.0%) |
| `src/cli/commands/verification-repair.ts` | 13/13 (100.0%) | 20/20 (100.0%) | 13/13 (100.0%) | 20/20 (100.0%) |
| `src/cli/commands/verify.ts` | 40/45 (88.9%) | 41/41 (100.0%) | 45/45 (100.0%) | 41/41 (100.0%) |
| `src/cli/commands/write-ms-artifacts.ts` | 3/5 (60.0%) | 6/6 (100.0%) | 5/5 (100.0%) | 6/6 (100.0%) |
| `src/cli/errors.ts` | 12/12 (100.0%) | 11/11 (100.0%) | 12/12 (100.0%) | 11/11 (100.0%) |
| `src/cli/format.ts` | 0/0 (100.0%) | 4/4 (100.0%) | 0/0 (100.0%) | 4/4 (100.0%) |
| `src/cli/index.ts` *(AC006 exception)* | 4/10 (40.0%) | 33/42 (78.6%) | 4/10 (40.0%) | 33/42 (78.6%) |
| `src/cli/output.ts` | 2/2 (100.0%) | 3/3 (100.0%) | 2/2 (100.0%) | 3/3 (100.0%) |
| `src/cli/review-prompt.ts` | 12/16 (75.0%) | 27/27 (100.0%) | 16/16 (100.0%) | 27/27 (100.0%) |
| `src/cli/worktree-guard.ts` | 10/11 (90.9%) | 11/11 (100.0%) | 10/11 (90.9%) | 11/11 (100.0%) |
| `src/core/backlog/add.ts` | 16/16 (100.0%) | 29/29 (100.0%) | 16/16 (100.0%) | 29/29 (100.0%) |
| `src/core/backlog/archive.ts` | 5/6 (83.3%) | 13/14 (92.9%) | 6/6 (100.0%) | 14/14 (100.0%) |
| `src/core/backlog/list.ts` | 2/2 (100.0%) | 3/3 (100.0%) | 2/2 (100.0%) | 3/3 (100.0%) |
| `src/core/backlog/promote.ts` | 5/6 (83.3%) | 15/15 (100.0%) | 6/6 (100.0%) | 15/15 (100.0%) |
| `src/core/backlog/show.ts` | 2/2 (100.0%) | 5/5 (100.0%) | 2/2 (100.0%) | 5/5 (100.0%) |
| `src/core/backlog/state-machine.ts` | 3/4 (75.0%) | 7/7 (100.0%) | 4/4 (100.0%) | 7/7 (100.0%) |
| `src/core/contracts/verification-hash.ts` | 5/6 (83.3%) | 8/9 (88.9%) | 6/6 (100.0%) | 9/9 (100.0%) |
| `src/core/journal/auto-run.ts` | 22/24 (91.7%) | 20/20 (100.0%) | 22/24 (91.7%) | 20/20 (100.0%) |
| `src/core/journal/operations.ts` | 7/9 (77.8%) | 11/14 (78.6%) | 9/9 (100.0%) | 14/14 (100.0%) |
| `src/core/metrics/aggregate.ts` | 26/28 (92.9%) | 43/43 (100.0%) | 26/28 (92.9%) | 43/43 (100.0%) |
| `src/core/milestones/cancel.ts` | 3/4 (75.0%) | 10/10 (100.0%) | 4/4 (100.0%) | 10/10 (100.0%) |
| `src/core/milestones/complete.ts` | 37/38 (97.4%) | 76/76 (100.0%) | 37/38 (97.4%) | 76/76 (100.0%) |
| `src/core/milestones/confirm.ts` | 61/65 (93.8%) | 108/111 (97.3%) | 61/65 (93.8%) | 108/111 (97.3%) |
| `src/core/milestones/create.ts` | 19/22 (86.4%) | 65/70 (92.9%) | 22/22 (100.0%) | 70/70 (100.0%) |
| `src/core/milestones/footer.ts` | 20/20 (100.0%) | 31/31 (100.0%) | 20/20 (100.0%) | 31/31 (100.0%) |
| `src/core/milestones/merge.ts` | 24/31 (77.4%) | 45/47 (95.7%) | 31/31 (100.0%) | 47/47 (100.0%) |
| `src/core/milestones/progress.ts` | 0/0 (100.0%) | 3/3 (100.0%) | 0/0 (100.0%) | 3/3 (100.0%) |
| `src/core/milestones/state-machine.ts` | 4/4 (100.0%) | 7/7 (100.0%) | 4/4 (100.0%) | 7/7 (100.0%) |
| `src/core/milestones/workload.ts` | 8/8 (100.0%) | 7/7 (100.0%) | 8/8 (100.0%) | 7/7 (100.0%) |
| `src/core/milestones/write-artifacts.ts` | 9/10 (90.0%) | 16/17 (94.1%) | 9/10 (90.0%) | 16/17 (94.1%) |
| `src/core/quick-change/commit.ts` | 13/14 (92.9%) | 24/25 (96.0%) | 13/14 (92.9%) | 24/25 (96.0%) |
| `src/core/quick-change/create.ts` | 36/36 (100.0%) | 59/59 (100.0%) | 36/36 (100.0%) | 59/59 (100.0%) |
| `src/core/quick-change/promote.ts` | 6/6 (100.0%) | 5/5 (100.0%) | 6/6 (100.0%) | 5/5 (100.0%) |
| `src/core/quick-change/run.ts` | 8/8 (100.0%) | 13/13 (100.0%) | 8/8 (100.0%) | 13/13 (100.0%) |
| `src/core/reviews/brief.ts` | 11/12 (91.7%) | 16/16 (100.0%) | 11/12 (91.7%) | 16/16 (100.0%) |
| `src/core/reviews/decide.ts` | 16/16 (100.0%) | 20/20 (100.0%) | 16/16 (100.0%) | 20/20 (100.0%) |
| `src/core/reviews/record.ts` | 20/20 (100.0%) | 38/39 (97.4%) | 20/20 (100.0%) | 38/39 (97.4%) |
| `src/core/reviews/report.ts` | 32/32 (100.0%) | 50/50 (100.0%) | 32/32 (100.0%) | 50/50 (100.0%) |
| `src/core/reviews/roles.ts` | 12/14 (85.7%) | 15/15 (100.0%) | 14/14 (100.0%) | 15/15 (100.0%) |
| `src/core/reviews/session.ts` | 12/12 (100.0%) | 31/31 (100.0%) | 12/12 (100.0%) | 31/31 (100.0%) |
| `src/core/tasks/add.ts` | 32/37 (86.5%) | 56/60 (93.3%) | 36/37 (97.3%) | 60/60 (100.0%) |
| `src/core/tasks/amend.ts` | 37/43 (86.0%) | 63/68 (92.6%) | 43/43 (100.0%) | 68/68 (100.0%) |
| `src/core/tasks/context-bundle.ts` | 6/8 (75.0%) | 8/9 (88.9%) | 8/8 (100.0%) | 9/9 (100.0%) |
| `src/core/tasks/critical-path.ts` | 13/16 (81.2%) | 33/33 (100.0%) | 15/16 (93.8%) | 33/33 (100.0%) |
| `src/core/tasks/dependencies.ts` | 15/18 (83.3%) | 39/39 (100.0%) | 17/18 (94.4%) | 39/39 (100.0%) |
| `src/core/tasks/discard.ts` | 11/16 (68.8%) | 25/29 (86.2%) | 16/16 (100.0%) | 29/29 (100.0%) |
| `src/core/tasks/dispatch.ts` | 15/17 (88.2%) | 31/33 (93.9%) | 17/17 (100.0%) | 33/33 (100.0%) |
| `src/core/tasks/integrate.ts` | 35/43 (81.4%) | 65/73 (89.0%) | 40/43 (93.0%) | 71/73 (97.3%) |
| `src/core/tasks/parallel-eligibility.ts` | 11/12 (91.7%) | 13/13 (100.0%) | 11/12 (91.7%) | 13/13 (100.0%) |
| `src/core/tasks/skills.ts` | 4/4 (100.0%) | 5/5 (100.0%) | 4/4 (100.0%) | 5/5 (100.0%) |
| `src/core/tasks/state-machine.ts` | 4/4 (100.0%) | 7/7 (100.0%) | 4/4 (100.0%) | 7/7 (100.0%) |
| `src/core/tasks/update.ts` | 135/151 (89.4%) | 176/185 (95.1%) | 136/151 (90.1%) | 176/185 (95.1%) |
| `src/core/tasks/verify.ts` | 48/62 (77.4%) | 80/87 (92.0%) | 58/62 (93.5%) | 86/87 (98.9%) |
| `src/core/tasks/write-scope-check.ts` | 2/3 (66.7%) | 3/3 (100.0%) | 3/3 (100.0%) | 3/3 (100.0%) |
| `src/core/verification/failure-summary.ts` | 12/14 (85.7%) | 27/29 (93.1%) | 14/14 (100.0%) | 29/29 (100.0%) |
| `src/core/verification/process-exec.ts` | 20/20 (100.0%) | 17/17 (100.0%) | 20/20 (100.0%) | 17/17 (100.0%) |
| `src/core/verification/recursion-guard.ts` | 4/4 (100.0%) | 5/5 (100.0%) | 4/4 (100.0%) | 5/5 (100.0%) |
| `src/core/verification/repair.ts` | 53/59 (89.8%) | 111/116 (95.7%) | 59/59 (100.0%) | 115/116 (99.1%) |
| `src/core/verification/run.ts` | 34/40 (85.0%) | 79/84 (94.0%) | 38/40 (95.0%) | 83/84 (98.8%) |
| `src/core/verification/status.ts` | 5/6 (83.3%) | 14/15 (93.3%) | 6/6 (100.0%) | 15/15 (100.0%) |
| `src/core/verification/text-trim.ts` | 11/11 (100.0%) | 12/12 (100.0%) | 11/11 (100.0%) | 12/12 (100.0%) |
| `src/git/apply.ts` | 1/2 (50.0%) | 17/18 (94.4%) | 2/2 (100.0%) | 18/18 (100.0%) |
| `src/git/baseline.ts` | 7/7 (100.0%) | 13/13 (100.0%) | 7/7 (100.0%) | 13/13 (100.0%) |
| `src/git/branch.ts` | 4/4 (100.0%) | 12/12 (100.0%) | 4/4 (100.0%) | 12/12 (100.0%) |
| `src/git/commit-or-resume.ts` | 8/8 (100.0%) | 15/15 (100.0%) | 8/8 (100.0%) | 15/15 (100.0%) |
| `src/git/commit.ts` | 2/2 (100.0%) | 5/5 (100.0%) | 2/2 (100.0%) | 5/5 (100.0%) |
| `src/git/exec.ts` * | 4/6 (66.7%) | 9/11 (81.8%) | 5/6 (83.3%) | 10/11 (90.9%) |
| `src/git/merge.ts` | 0/0 (100.0%) | 11/11 (100.0%) | 0/0 (100.0%) | 11/11 (100.0%) |
| `src/git/paths.ts` | 0/0 (100.0%) | 3/3 (100.0%) | 0/0 (100.0%) | 3/3 (100.0%) |
| `src/git/safety.ts` | 15/15 (100.0%) | 27/27 (100.0%) | 15/15 (100.0%) | 27/27 (100.0%) |
| `src/git/trailers.ts` | 40/44 (90.9%) | 74/75 (98.7%) | 40/44 (90.9%) | 74/75 (98.7%) |
| `src/git/worktree.ts` | 31/40 (77.5%) | 72/75 (96.0%) | 39/40 (97.5%) | 74/75 (98.7%) |
| `src/state/claude-assets.ts` | 5/5 (100.0%) | 9/9 (100.0%) | 5/5 (100.0%) | 9/9 (100.0%) |
| `src/state/contract-file.ts` | 8/10 (80.0%) | 19/22 (86.4%) | 10/10 (100.0%) | 22/22 (100.0%) |
| `src/state/driver-assets.ts` | 17/18 (94.4%) | 39/39 (100.0%) | 17/18 (94.4%) | 39/39 (100.0%) |
| `src/state/journal.ts` | 27/30 (90.0%) | 125/132 (94.7%) | 27/30 (90.0%) | 125/132 (94.7%) |
| `src/state/managed-init-paths.ts` | 0/0 (100.0%) | 8/8 (100.0%) | 0/0 (100.0%) | 8/8 (100.0%) |
| `src/state/root-instructions.ts` | 37/37 (100.0%) | 52/52 (100.0%) | 37/37 (100.0%) | 52/52 (100.0%) |
| `src/state/schemas.ts` | 60/61 (98.4%) | 82/82 (100.0%) | 60/61 (98.4%) | 82/82 (100.0%) |
| `src/state/store.ts` | 25/32 (78.1%) | 96/102 (94.1%) | 30/32 (93.8%) | 100/102 (98.0%) |

`*` = carries a named AC008 disclosure below.

## Exceptions and disclosures (named, never silent)

- **src/cli/index.ts** — AC006's one disclosed exception, restated unchanged:
  its uncovered branches sit inside the real-binary error boundary that V8
  coverage structurally cannot measure (real-subprocess execution,
  isMainModule gate) — already behaviorally covered by build-bin.test.ts's
  real-subprocess tests including the printStack=true case. Excluded from the
  >=90% requirement by name; no production refactor.
- **src/cli/commands/usage-add.ts** (6/7 branches, 85.7%) — T001's AC008
  disclosure stands: the one remaining branch is a structurally-unreachable
  human-render arm.
- **src/git/exec.ts** (5/6 branches, 83.3%) — T004's AC008 disclosure, named:
  assertGitWorkTree's catch-all `throw error` re-arm (line 24). Everything
  inside its try throws GitError by construction (git() wraps every spawn
  failure; `.trim()` on its string result cannot throw), so the non-GitError
  path has no in-process producer. Its two behavioral arms (bare repository →
  "is not a git work tree"; non-repository → wrapped "git repository required")
  are covered by tests/unit/git-safety.test.ts.

## Test-quality discipline (AC008)

Every newly covered branch corresponds to a real behavioral case: render
permutations, CommandDeps default fallbacks exercised through bare command
registration, guard refusals (no active milestone, unknown ids, sequential
strategy, out-of-repo declared paths, check-ignore hard failure), dirty-path
refusal diagnostics across modified/deleted/staged-add/staged-rename dirt,
crash-window residue re-runs, and the git-unspawnable error fallback. No
line-padding, no coverage-config change, no unrelated refactor. The full
suite and `tsc --noEmit` stayed green throughout (AC009).
