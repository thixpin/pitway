import type { ContractFrontmatter, Task } from '../../state/schemas.js';

export interface TaskContextBundle {
  task: { id: string; objective: string };
  acceptanceCriteria: string[];
  contractExcerpt: {
    title: string;
    acceptanceCriteria: ContractFrontmatter['acceptance_criteria'];
  };
  dependencyResults: Array<{ id: string; summary: string | null }>;
  relevantFiles: string[];
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
    verificationInstructions: task.verification.detail,
  };
}
