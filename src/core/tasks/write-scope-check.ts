import type { Task } from '../../state/schemas.js';

export interface WriteScopeCheck {
  ok: boolean;
  outOfScope: string[];
}

// Pure, write-only boundary check (AC004). Takes only structured data -- an
// explicit list of paths the caller already intends to write -- and never
// parses or infers paths from prose. Mirrors the same either/or scoping
// style already used by src/core/tasks/update.ts's completeTask: validate
// against task.write_scope when present, falling back to the legacy
// task.relevant_files when write_scope is absent (schema-enforced to never
// both be set). Every path outside that boundary is named.
//
// Explicitly write-only: this never validates against, and makes no claim
// about enforcing, context_files or any other read boundary --
// context_files (see src/core/tasks/context-bundle.ts) stays declarative
// supplied-context metadata only. Whether/how to build actual read
// enforcement is an M007 decision, not this one.
export function checkWriteScope(writePaths: string[], task: Task): WriteScopeCheck {
  const scope = new Set(task.write_scope ?? task.relevant_files ?? []);
  const outOfScope = writePaths.filter((path) => !scope.has(path));
  return { ok: outOfScope.length === 0, outOfScope };
}
