// M017/T004 (AC004): a pure extractor -- no I/O, no knowledge of exit
// codes -- that pulls the handful of lines most likely to name what broke
// out of a failed command's raw output, so `failures: ...` in the recorded
// evidence answers "what failed" without a human re-running the command.

const MAX_SUMMARY_LINES = 5;
const LINE_CAP = 200;
// Of the caller's overall evidence budget, the summary itself may consume
// at most this fraction -- the remainder is reserved for trimTail's own
// tail-preserved output, so a summary can never crowd that out entirely.
const SUMMARY_BUDGET_FRACTION = 0.4;

const VITEST_FAILURE_LINE = /^(FAIL\s|[×✗])/;
const ERROR_LINE = /^(AssertionError:|Error:)/;
const GENERIC_FAILURE_LINE = /\b(FAIL|ERR|Error)\b/;

function nonEmptyLines(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function capLine(line: string, cap: number): string {
  return line.length <= cap ? line : line.slice(0, cap);
}

// Greedily fills lines into the total budget (accounting for the ' | '
// separator summarizeFailure's caller joins with), truncating the line that
// would overflow it rather than dropping it -- a partial last line still
// carries signal, an empty one does not.
function capToBudget(lines: string[], totalCap: number): string[] {
  if (totalCap <= 0) return [];
  const separator = ' | ';
  const result: string[] = [];
  let used = 0;
  for (const line of lines) {
    const separatorCost = result.length > 0 ? separator.length : 0;
    if (used + separatorCost >= totalCap) break;
    const remaining = totalCap - used - separatorCost;
    if (line.length <= remaining) {
      result.push(line);
      used += separatorCost + line.length;
    } else {
      result.push(line.slice(0, remaining));
      break;
    }
  }
  return result;
}

// Extracts up to five lines summarizing a failed command's output: Vitest's
// own `FAIL <file> > <name>` / `×` failure markers plus the first
// `AssertionError:`/`Error:` lines (combined, in original order); when
// neither matches anything, falls back to a runner-agnostic
// /\b(FAIL|ERR|Error)\b/ scan. Each line is capped at 200 chars, and the
// whole summary is capped at 40% of `budget`. Returns [] when nothing in
// the output matches any pattern.
export function summarizeFailure(output: string, budget: number): string[] {
  const lines = nonEmptyLines(output);
  const primary = lines.filter((line) => VITEST_FAILURE_LINE.test(line) || ERROR_LINE.test(line));
  const candidates = primary.length > 0 ? primary : lines.filter((line) => GENERIC_FAILURE_LINE.test(line));
  const capped = candidates.slice(0, MAX_SUMMARY_LINES).map((line) => capLine(line, LINE_CAP));
  return capToBudget(capped, Math.floor(budget * SUMMARY_BUDGET_FRACTION));
}
