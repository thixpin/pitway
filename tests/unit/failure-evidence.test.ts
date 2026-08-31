import { describe, expect, it } from 'vitest';
import {
  EVIDENCE_BUDGET,
  buildEvidence,
  parseTestCounts,
} from '../../src/core/verification/failure-evidence.js';

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
