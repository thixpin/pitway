import type { Task } from '../../state/schemas.js';

// AC006 (M013): the longest chain of not-yet-completed, not-cancelled tasks
// connected by depends_on, ties broken by ascending task id. Assumes the
// graph is already proven acyclic by the time it runs -- the same guarantee
// resolveReadyTasks (src/core/tasks/dependencies.ts) already relies on; no
// second cycle check is performed here.
export function computeCriticalPath(tasks: Task[]): string[] {
  const eligible = tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled');
  if (eligible.length === 0) return [];

  const byId = new Map(eligible.map((t) => [t.id, t]));
  const lengthCache = new Map<string, number>();
  const predCache = new Map<string, string | null>();

  function longestEndingAt(id: string): number {
    const cached = lengthCache.get(id);
    if (cached !== undefined) return cached;
    const t = byId.get(id)!;
    // Ascending order: iterating smallest-id-first and only updating on a
    // strictly greater length means the first dependency to reach the
    // maximum is automatically the smallest-id one -- ties broken by
    // ascending task id, with no separate tie-break step needed.
    const deps = t.depends_on.filter((d) => byId.has(d)).sort();
    let best = 0;
    let bestPred: string | null = null;
    for (const dep of deps) {
      const len = longestEndingAt(dep);
      if (len > best) {
        best = len;
        bestPred = dep;
      }
    }
    const total = best + 1;
    lengthCache.set(id, total);
    predCache.set(id, bestPred);
    return total;
  }

  let bestId: string | null = null;
  let bestLen = -1;
  for (const t of [...eligible].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const len = longestEndingAt(t.id);
    if (len > bestLen) {
      bestLen = len;
      bestId = t.id;
    }
  }

  const chain: string[] = [];
  let cur = bestId;
  while (cur !== null) {
    chain.unshift(cur);
    cur = predCache.get(cur) ?? null;
  }
  return chain;
}
