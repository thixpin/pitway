import { describe, expect, it } from 'vitest';
import {
  EVIDENCE_BUDGET,
  buildEvidence,
  extractFailureDetail,
  parseTestCounts,
} from '../../src/core/verification/failure-evidence.js';
import { summarizeFailure } from '../../src/core/verification/failure-summary.js';

// M048/T001 (AC001): buildEvidence and parseTestCounts moved here verbatim
// from their two private call-site copies (run.ts passed an emptyFallback,
// tasks/verify.ts relied on trimTail's default). Every expected string below
// is hand-derived from trimTail + summarizeFailure semantics -- the old
// copies were private, so these fixtures ARE the byte-identity contract for
// both call sites.

describe('buildEvidence', () => {
  it('exports the shared 200-char evidence budget', () => {
    expect(EVIDENCE_BUDGET).toBe(200);
  });

  it('returns the plain trimmed tail for a passing run', () => {
    const output = 'line1\nline2\nline3\nline4\n';
    expect(buildEvidence(output, false)).toBe('line2 | line3 | line4');
    // The emptyFallback never surfaces when output is non-empty.
    expect(buildEvidence(output, false, '(no output; exit 0)')).toBe('line2 | line3 | line4');
  });

  it('prepends a failures: summary ahead of the tail on a failing vitest-style run', () => {
    const output = ['FAIL a > b', 'AssertionError: x', 'tail line'].join('\n');
    // summary = 'FAIL a > b | AssertionError: x' (30 chars, under the 80-char
    // summary cap); header = 40 chars; remainder = 200 - 40 - 1 = 159, so the
    // 42-char tail is kept whole.
    const expected = 'failures: FAIL a > b | AssertionError: x\nFAIL a > b | AssertionError: x | tail line';
    expect(buildEvidence(output, true)).toBe(expected);
    expect(buildEvidence(output, true, '(no output; exit 1)')).toBe(expected);
  });

  it('returns only the tail for a failing run whose output matches no pattern', () => {
    const output = 'something went wrong\nexit 1\n';
    expect(buildEvidence(output, true)).toBe('something went wrong | exit 1');
    expect(buildEvidence(output, true, '(no output; exit 1)')).toBe('something went wrong | exit 1');
  });

  it("falls back to trimTail's default '(no output)' when emptyFallback is omitted", () => {
    expect(buildEvidence('', false)).toBe('(no output)');
    expect(buildEvidence('', true)).toBe('(no output)');
    expect(buildEvidence('\n   \n', true)).toBe('(no output)');
  });

  it.each([
    '(no output; timed out)',
    '(no output; killed by signal)',
    '(no output; failed to spawn)',
    '(no output; exit 1)',
  ])('returns the caller-supplied emptyFallback %s for empty output', (fallback) => {
    expect(buildEvidence('', false, fallback)).toBe(fallback);
    expect(buildEvidence('', true, fallback)).toBe(fallback);
  });

  it('caps the tail to the remainder left after the header, tail-preserved', () => {
    // An 80-char FAIL line fills the summary cap exactly: header = 90 chars,
    // remainder = 200 - 90 - 1 = 109. The 183-char tail is cut to its last
    // 109 chars: 6 trailing a's, the separator, and the whole 100-char line.
    const failLine = `FAIL ${'a'.repeat(75)}`;
    const noise = 'b'.repeat(100);
    const output = `${failLine}\n${noise}\n`;
    const expected = `failures: ${failLine}\n${'a'.repeat(6)} | ${noise}`;
    const result = buildEvidence(output, true);
    expect(result).toBe(expected);
    expect(result.split('\n')[1]).toHaveLength(109);
    expect(buildEvidence(output, true, '(no output; exit 1)')).toBe(expected);
  });
});

describe('parseTestCounts', () => {
  it('reads both counts from a mixed vitest summary line', () => {
    const output = ' RUN  v4.1.10\n Tests  7 failed | 40 passed (47)\n';
    expect(parseTestCounts(output)).toEqual({ passCount: 40, failCount: 7 });
  });

  it('reads only the count that is present', () => {
    expect(parseTestCounts('Tests  3 passed (3)')).toEqual({ passCount: 3 });
    expect(parseTestCounts('Tests  2 failed (2)')).toEqual({ failCount: 2 });
  });

  it('returns an empty object when no Tests line exists', () => {
    expect(parseTestCounts('nothing here\n')).toEqual({});
    expect(parseTestCounts('')).toEqual({});
  });
});

// M048/T002 (AC002): extractFailureDetail is pure -- string in, structured
// detail out. The first fixture replays the B042/CT006 shape whose evidence
// string hid 6 of 7 failing tests behind the 200-char cap.

const B042_NAMES = [
  'reruns a timed-out check',
  'records duration_ms on a pass',
  'refuses a stale hash',
  'appends results per check',
  'keeps the guard token',
  'restores the env on exit',
  'records termination_reason',
];

function b042Fixture(): string {
  const markerLines = B042_NAMES.map((name, i) => `   × ${name} ${i + 1}ms`);
  const failBlocks = B042_NAMES.flatMap((name, i) => [
    ` FAIL  tests/integration/verify.test.ts > verify > ${name}`,
    `AssertionError: expected ${i} to be ${i + 1}`,
    '    at tests/integration/verify.test.ts:10:5',
  ]);
  return [
    ' RUN  v4.1.11 /repo',
    ...markerLines,
    ' Test Files  1 failed (1)',
    '      Tests  7 failed | 40 passed (47)',
    '⎯⎯⎯⎯⎯⎯⎯ Failed Tests 7 ⎯⎯⎯⎯⎯⎯⎯',
    ...failBlocks,
  ].join('\n');
}

describe('extractFailureDetail', () => {
  it('retains all 7 failing names once (FAIL form) and the first assertion on the B042 replay', () => {
    const detail = extractFailureDetail(b042Fixture());
    expect(detail.failCount).toBe(7);
    expect(detail.passCount).toBe(40);
    const failures = detail.failures!;
    // 7 deduped names (× duplicates dropped in favour of the FAIL form) plus
    // the error bucket capped at 3.
    expect(failures).toHaveLength(10);
    const names = failures.slice(0, 7);
    expect(names.every((line) => line.startsWith('FAIL  '))).toBe(true);
    for (const name of B042_NAMES) {
      expect(names.filter((line) => line.endsWith(name))).toHaveLength(1);
    }
    expect(failures.some((line) => line.startsWith('×'))).toBe(false);
    expect(failures[7]).toBe('AssertionError: expected 0 to be 1');
  });

  it('keeps × marker lines when the run died before the Failed Tests section', () => {
    const output = [
      ' RUN  v4.1.11',
      ...B042_NAMES.map((name, i) => `   × ${name} ${i + 1}ms`),
      'Killed',
    ].join('\n');
    const detail = extractFailureDetail(output);
    expect(detail.failures).toEqual(B042_NAMES.map((name, i) => `× ${name} ${i + 1}ms`));
    expect(detail.failCount).toBeUndefined();
    expect(detail.passCount).toBeUndefined();
  });

  it('drops a × line only when a FAIL line ends with its normalized name', () => {
    const output = [
      '× covered case 12.5ms',
      '× orphan case 3ms',
      'FAIL  tests/a.test.ts > suite > covered case',
    ].join('\n');
    expect(extractFailureDetail(output).failures).toEqual([
      '× orphan case 3ms',
      'FAIL  tests/a.test.ts > suite > covered case',
    ]);
  });

  it('caps the name bucket at 12 and the error bucket at 3, independently', () => {
    const fails = Array.from({ length: 15 }, (_, i) => `FAIL tests/f.test.ts > case ${i}`);
    const errors = Array.from({ length: 5 }, (_, i) => `AssertionError: e${i}`);
    const failures = extractFailureDetail([...fails, ...errors].join('\n')).failures!;
    expect(failures).toHaveLength(15);
    expect(failures.slice(0, 12)).toEqual(fails.slice(0, 12));
    expect(failures.slice(12)).toEqual(errors.slice(0, 3));
  });

  it('captures TypeError/ReferenceError/RangeError lines that summarizeFailure ignores', () => {
    const output = [
      'TypeError: Cannot read properties of undefined',
      'ReferenceError: foo is not defined',
      'RangeError: Maximum call stack size exceeded',
      '    at run (x.ts:1:1)',
    ].join('\n');
    expect(extractFailureDetail(output).failures).toEqual([
      'TypeError: Cannot read properties of undefined',
      'ReferenceError: foo is not defined',
      'RangeError: Maximum call stack size exceeded',
    ]);
    // Extractor-only: the evidence string's own summary stays byte-identical.
    expect(summarizeFailure(output, 10_000)).toEqual([]);
  });

  it('falls back to the generic matcher as a single bucket capped at 12', () => {
    const generic = Array.from({ length: 15 }, (_, i) => `ERR: step ${i} failed to connect`);
    const output = ['Running suite...', ...generic, 'done'].join('\n');
    expect(extractFailureDetail(output).failures).toEqual(generic.slice(0, 12));
  });

  it('caps every entry at 200 characters', () => {
    const [entry] = extractFailureDetail(`FAIL ${'x'.repeat(300)}`).failures!;
    expect(entry).toHaveLength(200);
  });

  it('omits failures entirely when nothing matches, never an empty list', () => {
    expect(extractFailureDetail('everything looks fine\nno issues here\n')).toEqual({});
    expect(extractFailureDetail('')).toEqual({});
    const clean = extractFailureDetail('all good\n Tests  5 passed (5)\n');
    expect(clean).toEqual({ passCount: 5 });
    expect('failures' in clean).toBe(false);
  });
});
