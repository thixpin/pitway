import type { ContractFrontmatter, Task } from '../../state/schemas.js';

export interface TaskContextBundle {
  task: { id: string; objective: string };
  acceptanceCriteria: string[];
  contractExcerpt: {
    title: string;
    acceptanceCriteria: ContractFrontmatter['acceptance_criteria'];
  };
  dependencyResults: Array<{ id: string; summary: string | null }>;
  // Legacy scoping style: present only for relevant_files-only tasks.
  relevantFiles?: string[];
  // New (M005) fields, passed through as-is for the driver's information.
  // context_files is declarative-only in M005 — nothing in PitWay reads it
  // to restrict what a worker may read. write_scope is the real write/
  // completion boundary, but this bundle only surfaces it; enforcement
  // happens elsewhere in the workflow, not here.
  contextFiles?: string[];
  writeScope?: string[];
  // AC003/T003: task.required_skills, passed through verbatim -- same
  // omission convention as writeScope/contextFiles (undefined, not an
  // empty array, when the task declares none).
  requiredSkills?: string[];
  verificationInstructions: string;
}

// The minimal set an execution agent needs and nothing else: no milestone
// history, no other tasks' full detail — only each dependency's concise
// result summary. See IMPLEMENTATION_PLAN.md §8/§20.
export function buildTaskContextBundle(
  contract: ContractFrontmatter,
  tasks: Task[],
  taskId: string,
): TaskContextBundle {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const task = byId.get(taskId);
  if (!task) {
    throw new Error(`task ${taskId} not found`);
  }

  // AC011/T010: when mapped_ac_ids is present and non-empty, narrow the
  // contract excerpt to exactly those ACs. When absent, this is a no-op --
  // the full contract.acceptance_criteria array passes through unchanged,
  // matching every pre-existing task's behavior.
  const mappedAcIds = task.mapped_ac_ids;
  const acceptanceCriteria =
    mappedAcIds && mappedAcIds.length > 0
      ? contract.acceptance_criteria.filter((ac) => mappedAcIds.includes(ac.id))
      : contract.acceptance_criteria;

  return {
    task: { id: task.id, objective: task.objective },
    acceptanceCriteria: task.acceptance_criteria,
    contractExcerpt: {
      title: contract.title,
      acceptanceCriteria,
    },
    dependencyResults: task.depends_on.map((depId) => ({
      id: depId,
      summary: byId.get(depId)?.result?.summary ?? null,
    })),
    relevantFiles: task.relevant_files,
    contextFiles: task.context_files,
    writeScope: task.write_scope,
    requiredSkills: task.required_skills,
    verificationInstructions: task.verification.detail,
  };
}
