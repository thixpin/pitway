import { createInterface, type Interface } from 'node:readline';
import { REVIEW_ROLES } from '../core/reviews/roles.js';

export class ReviewPromptError extends Error {}

// Injectable streams -- TTY detection reads THIS stream's own isTTY, never
// process.stdin directly, so tests can drive both the interactive and
// non-interactive branches without a real terminal.
export interface PromptStreams {
  input: NodeJS.ReadableStream & { isTTY?: boolean };
  output: NodeJS.WritableStream;
}

// AC015: display name is a mechanical capitalization of the role id (split
// on '-', capitalize each segment, join with a space) -- no separate
// display-name registry is introduced for this UX-only fix.
function capitalizeRoleName(id: string): string {
  return id
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatRoleList(): string {
  return REVIEW_ROLES.map((role, i) => `  ${i + 1}. ${capitalizeRoleName(role.id)}: ${role.label}`).join(
    '\n',
  );
}

// `1,3,4`-style input: comma-separated 1-based indices into REVIEW_ROLES,
// each valid, non-empty, and not repeated. Anything else (empty, non-numeric,
// out of range, duplicate) is treated as invalid, triggering the caller's
// re-prompt/refuse flow rather than a partial or best-effort selection.
function parseSelection(raw: string): string[] | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const parts = trimmed.split(',').map((p) => p.trim());
  if (parts.some((p) => p.length === 0)) return undefined;
  const indices: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return undefined;
    const n = Number(part);
    if (n < 1 || n > REVIEW_ROLES.length) return undefined;
    indices.push(n);
  }
  if (new Set(indices).size !== indices.length) return undefined;
  return indices.map((n) => REVIEW_ROLES[n - 1]!.id);
}

function ask(rl: Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

// AC003: a plain numbered multi-select against injectable streams -- no new
// runtime dependency; `interactive-ux.md`'s arrow-key design stays
// design-only. One re-prompt on empty/invalid input, then refuses. Only
// called when --roles was omitted; callers gate on TTY detection
// (streams.input.isTTY) before ever invoking this.
export async function promptForRoles(streams: PromptStreams): Promise<string[]> {
  const rl = createInterface({ input: streams.input, output: streams.output });
  try {
    streams.output.write(`Select review roles (comma-separated numbers):\n${formatRoleList()}\n`);
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await ask(rl, '> ');
      const selection = parseSelection(raw);
      if (selection !== undefined) return selection;
      if (attempt === 0) {
        streams.output.write('Invalid selection -- enter comma-separated numbers, e.g. 1,3,4:\n');
      }
    }
    throw new ReviewPromptError('invalid role selection entered twice; refusing');
  } finally {
    rl.close();
  }
}
