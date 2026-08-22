import { describe, expect, it } from 'vitest';
import { summarizeFailure } from '../../src/core/verification/failure-summary.js';

// M017/T004 (AC004): summarizeFailure is pure -- no I/O, no exit-code
// knowledge -- so every case here is a direct string-in/array-out check.

describe('summarizeFailure', () => {
  it('extracts Vitest FAIL and × failure lines, in order', () => {
    const output = [
      ' RUN  v4.1.10',
      'FAIL tests/unit/foo.test.ts > adds two numbers',
      '  × adds two numbers',
      '  ✓ an unrelated passing test',
      'Test Files  1 failed (1)',
    ].join('\n');
    expect(summarizeFailure(output, 200)).toEqual([
      'FAIL tests/unit/foo.test.ts > adds two numbers',
      '× adds two numbers',
    ]);
  });

  it('extracts the first AssertionError/Error lines alongside Vitest markers', () => {
    const output = [
      'FAIL tests/unit/foo.test.ts > adds two numbers',
      'AssertionError: expected 2 to be 3',
      '  at Object.<anonymous> (foo.test.ts:5:10)',
    ].join('\n');
    // A large budget so the total-summary cap never binds here -- isolates
    // the extraction/combination behavior from the budget-truncation tested
    // separately below.
    expect(summarizeFailure(output, 10_000)).toEqual([
      'FAIL tests/unit/foo.test.ts > adds two numbers',
      'AssertionError: expected 2 to be 3',
    ]);
  });

  it('falls back to a generic /\\b(FAIL|ERR|Error)\\b/ scan for a non-Vitest runner', () => {
    const output = ['Running suite...', 'ERR: connection refused', 'done'].join('\n');
    expect(summarizeFailure(output, 200)).toEqual(['ERR: connection refused']);
  });

  it('returns an empty array when nothing in the output matches any pattern', () => {
    const output = 'everything looks fine\nno issues here\n';
    expect(summarizeFailure(output, 200)).toEqual([]);
  });

  it('caps each line at 200 characters', () => {
    const longLine = `FAIL ${'x'.repeat(300)}`;
    // A large budget so the total-summary cap (40% of budget) never binds
    // here -- isolates the per-line cap.
    const [line] = summarizeFailure(longLine, 10_000);
    expect(line!.length).toBe(200);
  });

  it('caps the whole summary at 40% of the budget, truncating an overflowing line', () => {
    const output = ['FAIL aaaaaaaaaa', 'FAIL bbbbbbbbbb'].join('\n');
    // budget=100 -> total cap 40; the first line (15 chars) fits, the
    // second is truncated to what remains after it plus the ' | ' separator.
    const result = summarizeFailure(output, 100);
    const joined = result.join(' | ');
    expect(joined.length).toBeLessThanOrEqual(40);
    expect(result[0]).toBe('FAIL aaaaaaaaaa');
  });

  it('returns at most five lines even when more match', () => {
    const output = Array.from({ length: 8 }, (_, i) => `FAIL file${i}.ts > case`).join('\n');
    expect(summarizeFailure(output, 10_000)).toHaveLength(5);
  });

  it('returns an empty array for an empty budget', () => {
    expect(summarizeFailure('FAIL something', 0)).toEqual([]);
  });

  it('truncates the line that overflows the remaining budget and stops there', () => {
    // budget=100 -> total cap 40. First line is 35 chars; the separator
    // costs 3, leaving exactly 2 chars for the second line, which is
    // truncated to those 2 rather than dropped -- a partial line still
    // carries signal.
    const first = `FAIL ${'a'.repeat(30)}`;
    const second = `FAIL ${'b'.repeat(30)}`;
    const result = summarizeFailure([first, second].join('\n'), 100);
    expect(result).toEqual([first, 'FA']);
    expect(result.join(' | ').length).toBe(40);
  });

  it('stops before a line whose separator alone would already overflow the budget', () => {
    // budget=100 -> total cap 40. The first line consumes the cap exactly,
    // so the second line's ' | ' separator can never fit: the loop breaks
    // without emitting even a truncated fragment.
    const exact = `FAIL ${'a'.repeat(35)}`; // 40 chars
    const result = summarizeFailure([exact, 'FAIL never-emitted'].join('\n'), 100);
    expect(result).toEqual([exact]);
  });
});
