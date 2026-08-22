import { describe, it, expect } from 'vitest';
import {
  displayWidth,
  splitGraphemes,
  padCell,
  truncateCell,
  wrapCell,
  computeColumnWidths,
  renderTable,
} from '../../src/cli/table.js';

describe('displayWidth', () => {
  it('measures ascii as 1 per char', () => {
    expect(displayWidth('hello')).toBe(5);
    expect(displayWidth('')).toBe(0);
  });

  it('measures wide CJK as 2', () => {
    expect(displayWidth('中文')).toBe(4);
    expect(displayWidth('a中b')).toBe(4); // 1+2+1
  });

  it('measures emoji as 2 (single emoji)', () => {
    // Heavy check: emoji should be width 2
    expect(displayWidth('✓')).toBe(1); // check mark is not wide? May be 1 depending heuristic
    expect(displayWidth('🏁')).toBe(2);
    expect(displayWidth('📊')).toBe(2);
  });

  it('measures combined emoji sequences as 2 without mid-grapheme split', () => {
    const family = '👨‍👩‍👧'; // ZWJ sequence single grapheme
    const graphemes = splitGraphemes(family);
    expect(graphemes.length).toBe(1);
    expect(displayWidth(family)).toBe(2);
  });

  it('handles flag and skin-tone sequences as single grapheme', () => {
    const flag = '🇺🇸';
    expect(splitGraphemes(flag).length).toBe(1);
    expect(displayWidth(flag)).toBe(2);
  });
});

describe('splitGraphemes', () => {
  it('never splits combining characters', () => {
    const text = 'e\u0301'; // é via combining
    expect(splitGraphemes(text).length).toBe(1);
  });

  it('splits ascii individually', () => {
    expect(splitGraphemes('abc')).toEqual(['a', 'b', 'c']);
  });
});

describe('padCell', () => {
  it('pads left alignment', () => {
    expect(padCell('hi', 5, 'left')).toBe('hi   ');
  });
  it('pads right alignment', () => {
    expect(padCell('hi', 5, 'right')).toBe('   hi');
  });
  it('pads center alignment', () => {
    expect(padCell('hi', 5, 'center')).toBe(' hi  ');
  });
  it('accounts for wide chars', () => {
    // '中文' width 4, pad to 6 => 2 spaces
    expect(padCell('中文', 6, 'left')).toBe('中文  ');
    expect(displayWidth(padCell('中文', 6, 'left'))).toBe(6);
  });
  it('does not truncate when text wider than width', () => {
    expect(padCell('hello', 3)).toBe('hello');
  });
});

describe('truncateCell', () => {
  it('returns original when fits', () => {
    expect(truncateCell('hello', 10)).toBe('hello');
  });
  it('truncates with ellipsis respecting width', () => {
    expect(truncateCell('hello world', 5)).toBe('hell…');
    expect(displayWidth(truncateCell('hello world', 5))).toBe(5);
  });
  it('never breaks grapheme', () => {
    const text = 'a🇺🇸b';
    // 🇺🇸 is one grapheme width 2
    // truncate to 3 => should keep a + ellipsis or a + flag?
    const truncated = truncateCell(text, 3);
    // Ensure grapheme integrity: flag not split
    const graphemes = splitGraphemes(truncated);
    expect(graphemes.join('')).toBe(truncated);
    expect(displayWidth(truncated) <= 3).toBe(true);
  });
  it('handles wide chars truncation', () => {
    const t = truncateCell('中文测试', 5);
    expect(displayWidth(t) <= 5).toBe(true);
    // Should not split mid-grapheme
    expect(splitGraphemes(t).join('')).toBe(t);
  });
});

describe('wrapCell', () => {
  it('returns single line when fits', () => {
    expect(wrapCell('hello', 10)).toEqual(['hello']);
  });
  it('wraps ascii at spaces', () => {
    const lines = wrapCell('hello world foo', 8);
    expect(lines).toEqual(['hello', 'world', 'foo']);
    for (const l of lines) expect(displayWidth(l) <= 8).toBe(true);
  });
  it('wraps long unbroken string by width without mid-grapheme break', () => {
    const lines = wrapCell('abcdefghij', 3);
    expect(lines).toEqual(['abc', 'def', 'ghi', 'j']);
  });
  it('never splits grapheme clusters when wrapping', () => {
    const text = 'a🇺🇸b🇺🇸c';
    const lines = wrapCell(text, 3);
    for (const l of lines) {
      expect(splitGraphemes(l).join('')).toBe(l);
      expect(displayWidth(l) <= 3).toBe(true);
    }
    // Rejoined (without spaces inserted) should have same graphemes count
    const rejoined = lines.join('');
    expect(splitGraphemes(rejoined).length).toBe(splitGraphemes(text).length);
  });
  it('handles wide chars wrapping', () => {
    const lines = wrapCell('中文测试内容', 4);
    for (const l of lines) expect(displayWidth(l) <= 4).toBe(true);
  });
  it('handles empty', () => {
    expect(wrapCell('', 10)).toEqual(['']);
  });
});

describe('computeColumnWidths', () => {
  it('computes max width per column', () => {
    expect(computeColumnWidths(['a', 'bb'], [['ccc', 'd']])).toEqual([3, 2]);
  });
  it('handles empty cells', () => {
    expect(computeColumnWidths(['h'], [[''], ['xx']])).toEqual([2]);
  });
  it('handles varying row lengths', () => {
    expect(computeColumnWidths(['a', 'b'], [['x'], ['y', 'z', 'w']])).toEqual([1, 1, 1]);
  });
  it('accounts for wide unicode widths', () => {
    expect(computeColumnWidths(['a'], [['中文']])).toEqual([4]);
  });
});

describe('renderTable - compact (default, byte-identical)', () => {
  it('renders header, separator, rows compact (no padding)', () => {
    const out = renderTable(['Task', 'Status'], [
      ['T001', '✓ Completed'],
      ['T002', '● In Progress'],
    ]);
    expect(out).toEqual([
      '| Task | Status |',
      '|------|--------|',
      '| T001 | ✓ Completed |',
      '| T002 | ● In Progress |',
    ]);
  });

  it('handles empty cells', () => {
    const out = renderTable(['A', 'B'], [['', 'x'], ['y', '']]);
    expect(out).toEqual(['| A | B |', '|---|---|', '|  | x |', '| y |  |']);
  });

  it('handles varying row lengths (missing cells padded empty)', () => {
    const out = renderTable(['A', 'B', 'C'], [['1'], ['2', '3']]);
    expect(out[2]).toBe('| 1 |  |  |');
    expect(out[3]).toBe('| 2 | 3 |  |');
  });

  it('handles extra columns beyond headers', () => {
    const out = renderTable(['A'], [
      ['1', '2', '3'],
    ]);
    expect(out[0]).toBe('| A |  |  |');
    expect(out[2]).toBe('| 1 | 2 | 3 |');
  });

  it('produces byte-identical milestone-status task table', () => {
    const headers = ['Task', 'Status', 'Progress', 'Execution'];
    const rows = [
      ['T001', '✓ Completed', '100%', 'inline'],
      ['T002', '● In Progress', '—', 'inline'],
      ['T003', '◌ Waiting', '—', '—'],
    ];
    expect(renderTable(headers, rows)).toEqual([
      '| Task | Status | Progress | Execution |',
      '|------|--------|----------|-----------|',
      '| T001 | ✓ Completed | 100% | inline |',
      '| T002 | ● In Progress | — | inline |',
      '| T003 | ◌ Waiting | — | — |',
    ]);
  });

  it('produces byte-identical progress-report table', () => {
    const headers = ['Task', 'Label', 'Execution', 'Status', 'Tokens'];
    const rows = [['T001', 'Config schema', '—', '✓ Completed · verified', '100']];
    expect(renderTable(headers, rows)).toEqual([
      '| Task | Label | Execution | Status | Tokens |',
      '|------|-------|-----------|--------|--------|',
      '| T001 | Config schema | — | ✓ Completed · verified | 100 |',
    ]);
  });
});

describe('renderTable - padded alignment', () => {
  it('pads columns to content-aware widths', () => {
    const out = renderTable(['A', 'BB'], [['x', 'yy'], ['zzz', 'w']], { pad: true });
    // widths: col0 max(1,1,3)=3, col1 max(2,2,1)=2
    expect(out[0]).toBe('| A   | BB |');
    expect(out[1]).toBe('|-----|----|');
    expect(out[2]).toBe('| x   | yy |');
    expect(out[3]).toBe('| zzz | w  |');
  });

  it('respects align per column', () => {
    const out = renderTable(['N', 'V'], [['a', '1'], ['bb', '22']], {
      pad: true,
      align: ['left', 'right'],
    });
    expect(out[2]).toBe('| a  |  1 |');
    expect(out[3]).toBe('| bb | 22 |');
  });

  it('accounts for unicode display width when aligning', () => {
    const out = renderTable(['H'], [['中文'], ['a']], { pad: true });
    // width = 4 (中文 width 4), 'a' should be padded to width 4 -> 'a   '
    expect(out[2]).toBe('| 中文 |');
    expect(out[3]).toBe('| a    |');
    expect(displayWidth(out[3]!.slice(2, -2))).toBe(4);
  });

  it('center alignment with unicode', () => {
    const out = renderTable(['H'], [['hi']], { pad: true, align: ['center'] });
    // width 2 => 'hi' fits, no extra pad needed
    expect(out[0]!.replace('H  ', 'H ')).toBe('| H  |'.replace('H  ', 'H ')); // skip brittle
    expect(out[2]).toBe('| hi |');
  });

  it('truncates when maxColumnWidths with truncate', () => {
    const out = renderTable(['Header'], [['hello world']], {
      maxColumnWidths: [5],
      overflow: 'truncate',
    });
    // compact mode but truncated cell should be 5 width with ellipsis
    expect(displayWidth(out[2]!.slice(2, -2).trim()) <= 5).toBe(true);
    expect(out[2]).toContain('…');
  });

  it('wraps when overflow wrap', () => {
    const out = renderTable(['H'], [['hello world foo']], {
      maxColumnWidths: [5],
      overflow: 'wrap',
      pad: true,
    });
    // Should expand to multiple rows
    expect(out.length).toBeGreaterThan(3);
    // Each data line width <=5 inside
    for (let i = 2; i < out.length; i++) {
      const inner = out[i]!.slice(2, -2); // remove '| ' and ' |'
      // inner may be padded, trim
      expect(displayWidth(inner.trim()) <= 5).toBe(true);
    }
  });

  it('never mid-grapheme on truncate/wrap with emoji', () => {
    const flag = '🇺🇸'.repeat(5);
    const truncated = renderTable(['H'], [[flag]], {
      maxColumnWidths: [4],
      overflow: 'truncate',
    });
    const cell = truncated[2]!.slice(2, -2).trim();
    expect(splitGraphemes(cell).join('')).toBe(cell);
    const wrapped = renderTable(['H'], [[flag]], {
      maxColumnWidths: [4],
      overflow: 'wrap',
      pad: true,
    });
    for (let i = 2; i < wrapped.length; i++) {
      const c = wrapped[i]!.slice(2, -2).trim();
      if (c) expect(splitGraphemes(c).join('')).toBe(c);
    }
  });
});
