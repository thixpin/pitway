import { trimTail } from './text-trim.js';
import { GENERIC_FAILURE_LINE, VITEST_FAILURE_LINE, summarizeFailure } from './failure-summary.js';

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

// M048/T002 (AC002): the structured counterpart to the `failures:` summary
// inside the evidence string. The evidence string is capped at 200 chars in
// total; B042 showed that cap hiding 6 of 7 failing test names and every
// assertion line. This extractor keeps names and error text in separate,
// independently capped buckets so neither can crowd the other out. It never
// feeds the evidence string, so its wider error matcher (TypeError:,
// ReferenceError:, RangeError: ... -- anything summarizeFailure's
// AssertionError:/Error: chain misses) changes nothing about that string.
const MAX_NAME_ENTRIES = 12;
const MAX_ERROR_ENTRIES = 3;
const MAX_GENERIC_ENTRIES = 12;
const ENTRY_CAP = 200;
const EXTRACTOR_ERROR_LINE = /^\w*Error:/;
const MARKER_PREFIX = /^[×✗]\s*/;
const TRAILING_DURATION = /\s+\d+(\.\d+)?ms$/;

export interface FailureDetail {
  failures?: string[];
  passCount?: number;
  failCount?: number;
}

function nonEmptyLines(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// Vitest prints each failing test twice: a `× <name> <n>ms` marker while
// running and a `FAIL <file> > <suite> > <name>` block afterwards. The FAIL
// form carries the full path, so it wins; a marker survives only when no
// FAIL line names it -- the shape a run leaves when it dies before vitest
// reaches its Failed Tests section.
function dedupeNames(nameLines: string[]): string[] {
  const failLines = nameLines.filter((line) => !MARKER_PREFIX.test(line));
  return nameLines.filter((line) => {
    if (!MARKER_PREFIX.test(line)) return true;
    const name = line.replace(MARKER_PREFIX, '').replace(TRAILING_DURATION, '');
    return name.length === 0 || !failLines.some((fail) => fail.endsWith(name));
  });
}

export function extractFailureDetail(combined: string): FailureDetail {
  const lines = nonEmptyLines(combined);
  const names = dedupeNames(lines.filter((line) => VITEST_FAILURE_LINE.test(line))).slice(
    0,
    MAX_NAME_ENTRIES,
  );
  const errors = lines.filter((line) => EXTRACTOR_ERROR_LINE.test(line)).slice(0, MAX_ERROR_ENTRIES);
  const entries =
    names.length + errors.length > 0
      ? [...names, ...errors]
      : lines.filter((line) => GENERIC_FAILURE_LINE.test(line)).slice(0, MAX_GENERIC_ENTRIES);
  const failures = entries.map((entry) => (entry.length <= ENTRY_CAP ? entry : entry.slice(0, ENTRY_CAP)));
  return {
    ...(failures.length > 0 ? { failures } : {}),
    ...parseTestCounts(combined),
  };
}
