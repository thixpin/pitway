import { describe, expect, it } from 'vitest';
import { trimTail } from '../../src/core/verification/text-trim.js';

describe('trimTail', () => {
  it('matches run.ts current trimEvidence behavior for typical multi-line output', () => {
    const output = 'line one\nline two\nline three\nline four\n';
    // Original: split on \n, trim, drop empties, keep last 3, join with ' | '.
    expect(trimTail(output)).toBe('line two | line three | line four');
  });

  it('drops blank lines before taking the tail', () => {
    const output = 'first\n\n   \nsecond\nthird\n\n';
    expect(trimTail(output)).toBe('first | second | third');
  });

  it('falls back to the caller-supplied text when there is no non-empty output', () => {
    expect(trimTail('', { emptyFallback: '(no output; exit 1)' })).toBe('(no output; exit 1)');
    expect(trimTail('   \n\n  ', { emptyFallback: '(no output; exit 1)' })).toBe(
      '(no output; exit 1)',
    );
  });

  it('defaults the empty fallback when the caller does not supply one', () => {
    expect(trimTail('')).toBe('(no output)');
  });

  it('caps the result at 200 characters by default, keeping the tail', () => {
    const longLine = 'x'.repeat(250);
    const result = trimTail(longLine);
    expect(result.length).toBe(200);
    expect(result).toBe(longLine.slice(-200));
  });

  it('honors a custom cap and a custom number of tail lines', () => {
    const output = 'a\nb\nc\nd\ne';
    expect(trimTail(output, { lines: 2 })).toBe('d | e');
    const longLine = 'y'.repeat(50);
    expect(trimTail(longLine, { cap: 10 })).toBe(longLine.slice(-10));
  });

  it('is reusable for worker-report capping with no exitCode concept', () => {
    const report = 'step 1 done\nstep 2 done\nstep 3 done\nfinal summary line';
    expect(trimTail(report, { emptyFallback: '(no report output)' })).toBe(
      'step 2 done | step 3 done | final summary line',
    );
  });
});
