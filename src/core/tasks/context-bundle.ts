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

  return {
    task: { id: task.id, objective: task.objective },
    acceptanceCriteria: task.acceptance_criteria,
    contractExcerpt: {
      title: contract.title,
      acceptanceCriteria: contract.acceptance_criteria,
    },
    dependencyResults: task.depends_on.map((depId) => ({
      id: depId,
      summary: byId.get(depId)?.result?.summary ?? null,
    })),
    relevantFiles: task.relevant_files,
    contextFiles: task.context_files,
    writeScope: task.write_scope,
    verificationInstructions: task.verification.detail,
  };
}
