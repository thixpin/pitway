import type { Task } from '../../state/schemas.js';
import { isTransitivelyDependent } from './dependencies.js';

// AC002/T002 (M014): pure eligibility decision for running a candidate task
// concurrently with the set of ALL currently in_progress tasks --
// dispatch-record-backed and plain inline in_progress alike, because an
// overlap with an inline task is the same two-writers hazard as one with a
// dispatched task. Never a bare boolean: refusals name the failing rule and
// the conflicting task/paths.
export type EligibilityResult =
  | { eligible: true }
  | { eligible: false; rule: 'candidate-not-ready'; detail: string }
  | { eligible: false; rule: 'dependency-related'; conflict: string; detail: string }
  | { eligible: false; rule: 'write-scope-overlap'; conflict: string; paths: string[]; detail: string }
  | { eligible: false; rule: 'write-scope-undeclared'; conflict: string; detail: string };

export function checkParallelEligibility(
  candidate: Task,
  concurrent: Task[],
  allTasks: Task[],
): EligibilityResult {
  if (candidate.status !== 'ready') {
    return {
      eligible: false,
      rule: 'candidate-not-ready',
      detail: `task ${candidate.id} is ${candidate.status}, not ready`,
    };
  }

  // A task without a declared write_scope (legacy relevant_files style) has
  // no precisely-declared write boundary, so disjointness cannot be proven.
  const undeclared = [candidate, ...concurrent].find((t) => t.write_scope === undefined);
  if (undeclared) {
    return {
      eligible: false,
      rule: 'write-scope-undeclared',
      conflict: undeclared.id,
      detail:
        `task ${undeclared.id} declares no write_scope (legacy relevant_files scoping); ` +
        `parallel eligibility requires an explicit write_scope on every concurrent task`,
    };
  }

  for (const other of concurrent) {
    // Redundant-by-construction for well-formed graphs (rule 1: a ready
    // candidate's dependencies are all completed, and no in_progress task is
    // completed, so no dependency can exist in either direction) -- kept as
    // cheap defense-in-depth in a pure function.
    if (
      isTransitivelyDependent(allTasks, candidate.id, other.id) ||
      isTransitivelyDependent(allTasks, other.id, candidate.id)
    ) {
      return {
        eligible: false,
        rule: 'dependency-related',
        conflict: other.id,
        detail: `task ${candidate.id} and in-progress task ${other.id} are dependency-related`,
      };
    }

    const otherScope = new Set(other.write_scope);
    const overlap = (candidate.write_scope ?? []).filter((p) => otherScope.has(p));
    if (overlap.length > 0) {
      return {
        eligible: false,
        rule: 'write-scope-overlap',
        conflict: other.id,
        paths: overlap,
        detail:
          `task ${candidate.id} overlaps in-progress task ${other.id} on: ${overlap.join(', ')}`,
      };
    }
  }

  return { eligible: true };
}
