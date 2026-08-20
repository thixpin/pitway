import type { Task } from '../../state/schemas.js';

export class DependencyGraphError extends Error {}

function detectCycle(tasks: Task[]): void {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const state = new Map<string, 'visiting' | 'done'>();

  const visit = (id: string, path: string[]): void => {
    const status = state.get(id);
    if (status === 'done') return;
    if (status === 'visiting') {
      const cycleStart = path.indexOf(id);
      const cycle = [...path.slice(cycleStart), id];
      throw new DependencyGraphError(`dependency cycle detected: ${cycle.join(' -> ')}`);
    }
    state.set(id, 'visiting');
    const current = byId.get(id);
    for (const dep of current?.depends_on ?? []) {
      visit(dep, [...path, id]);
    }
    state.set(id, 'done');
  };

  for (const t of tasks) visit(t.id, []);
}

function checkUnknownReferences(tasks: Task[]): void {
  const knownIds = new Set(tasks.map((t) => t.id));
  for (const t of tasks) {
    for (const dep of t.depends_on) {
      if (!knownIds.has(dep)) {
        throw new DependencyGraphError(
          `task ${t.id} depends on unknown task ${dep}`,
        );
      }
    }
  }
}

// AC002/T002 (M014): true when `fromId` transitively depends on `toId`
// through depends_on edges. Pure reachability over the same graph the
// resolver walks -- exported so parallel-eligibility never re-implements
// traversal.
export function isTransitivelyDependent(tasks: Task[], fromId: string, toId: string): boolean {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const stack = [fromId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const dep of byId.get(current)?.depends_on ?? []) {
      if (dep === toId) return true;
      stack.push(dep);
    }
  }
  return false;
}

// Promotes waiting tasks to ready once every dependency is completed. Pure:
// returns a new array, does not mutate the input.
export function resolveReadyTasks(tasks: Task[]): Task[] {
  checkUnknownReferences(tasks);
  detectCycle(tasks);

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const isSatisfied = (t: Task): boolean =>
    t.depends_on.every((depId) => byId.get(depId)?.status === 'completed');

  return tasks.map((t) => {
    if (t.status !== 'waiting') return t;
    return isSatisfied(t) ? { ...t, status: 'ready' } : t;
  });
}
