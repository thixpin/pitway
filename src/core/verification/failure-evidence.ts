import { trimTail } from './text-trim.js';
import { summarizeFailure } from './failure-summary.js';

// M048/T001 (AC001): the one shared home for command-evidence building.
// M017 left buildEvidence duplicated across run.ts and tasks/verify.ts as a
// scope boundary, not an architecture; both call sites now consume this
// module so a change to how evidence is shaped can never drift between the
// milestone verification results and the task-verify journal.

// Matches trimTail's own default cap -- the evidence budget a failure
// summary and the tail-trimmed output share, summary first.
export const EVIDENCE_BUDGET = 200;

// ONLY on failure, prepends a `failures: <lines>` summary ahead of the
// tail-trimmed output, the summary budgeted first inside the SAME evidence
// budget trimTail already used -- one truncation scheme, not two. A passing
// run's evidence, and a failing run whose output matches no failure
// pattern, are the plain trimmed tail. `emptyFallback` is what an empty
// output renders as; when omitted, trimTail's own '(no output)' applies.
export function buildEvidence(combined: string, failed: boolean, emptyFallback?: string): string {
  const tail = trimTail(combined, { emptyFallback });
  if (!failed) return tail;
  const summaryLines = summarizeFailure(combined, EVIDENCE_BUDGET);
  if (summaryLines.length === 0) return tail;
  const header = `failures: ${summaryLines.join(' | ')}`;
  const remainder = Math.max(0, EVIDENCE_BUDGET - header.length - 1);
  return `${header}\n${trimTail(combined, { cap: remainder, emptyFallback })}`;
}

// Best-effort: looks for vitest's own "Tests  N passed (N)" / "N failed"
// summary line shape in the combined stdout+stderr. Absent rather than
// fabricated when the line isn't found or doesn't cleanly match.
export function parseTestCounts(output: string): { passCount?: number; failCount?: number } {
  const line = output.split('\n').find((l) => /^\s*Tests\s+/.test(l));
  if (!line) return {};
  const result: { passCount?: number; failCount?: number } = {};
  const passMatch = /(\d+)\s+passed/.exec(line);
  const failMatch = /(\d+)\s+failed/.exec(line);
  if (passMatch) result.passCount = Number(passMatch[1]);
  if (failMatch) result.failCount = Number(failMatch[1]);
  return result;
}
