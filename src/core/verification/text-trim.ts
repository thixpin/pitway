// Shared tail-truncation helper. Matches run.ts's original private
// trimEvidence behavior (last 3 non-empty lines, joined by ' | ', capped at
// 200 characters, tail-preserved) but generalized for reuse beyond command
// evidence -- e.g. worker-report capping, which has no exitCode concept and
// so needs a caller-supplied fallback rather than a hardcoded one.

const DEFAULT_CAP = 200;
const DEFAULT_TAIL_LINES = 3;
const DEFAULT_EMPTY_FALLBACK = '(no output)';

export interface TrimTailOptions {
  /** Maximum length of the returned text. Defaults to 200. */
  cap?: number;
  /** Number of trailing non-empty lines to keep. Defaults to 3. */
  lines?: number;
  /** Text returned when there are no non-empty lines. Defaults to '(no output)'. */
  emptyFallback?: string;
}

export function trimTail(output: string, options: TrimTailOptions = {}): string {
  const cap = options.cap ?? DEFAULT_CAP;
  const lineCount = options.lines ?? DEFAULT_TAIL_LINES;
  const fallback = options.emptyFallback ?? DEFAULT_EMPTY_FALLBACK;

  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const tail = lines.slice(-lineCount).join(' | ');
  const text = tail.length > 0 ? tail : fallback;
  return text.length > cap ? text.slice(-cap) : text;
}
