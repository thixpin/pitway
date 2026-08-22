/**
 * Reusable terminal table renderer.
 *
 * Produces markdown-style tables: | col | col |
 * Content-aware widths, Unicode-safe display width, and wrapping behavior
 * that never splits grapheme clusters.
 *
 * Default mode is compact (no padding) to preserve byte-identical output
 * for existing callers. Pass `align` or `pad: true` to enable
 * content-aware padded alignment.
 */

export type Align = 'left' | 'center' | 'right';

export interface TableOptions {
  align?: Align[];
  /** Enable padded alignment using content-aware widths. Default: false (compact). */
  pad?: boolean;
  /** Per-column max display widths; excess handled via `overflow`. */
  maxColumnWidths?: (number | null | undefined)[];
  /** How to handle cells wider than maxColumnWidths. Default: 'truncate' when maxColumnWidths given, else 'none'. */
  overflow?: 'truncate' | 'wrap' | 'none';
}

// --- Grapheme / display-width helpers ---

let segmenter: Intl.Segmenter | null = null;
function getSegmenter(): Intl.Segmenter | null {
  try {
    if (!segmenter) segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return segmenter;
  } catch {
    return null;
  }
}

export function splitGraphemes(text: string): string[] {
  const seg = getSegmenter();
  if (seg) return [...seg.segment(text)].map((s) => s.segment);
  return [...text];
}

function isWideCodePoint(cp: number): boolean {
  // East Asian Wide ranges + emoji ranges (width 2)
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2329 && cp <= 0x232a) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3040 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f000 && cp <= 0x1ffff) ||
    (cp >= 0x20000 && cp <= 0x3ffff) ||
    // Miscellaneous emoji blocks (keep narrow symbols like ✓ ✗ as width 1)
    (cp >= 0x1f300 && cp <= 0x1f9ff)
  );
}

function graphemeWidth(g: string): number {
  const cp = g.codePointAt(0);
  if (cp === undefined) return 0;
  // Zero-width joiner / variation selectors alone should not add width
  if (g === '\u200d' || g === '\ufe0f' || g === '\ufe0e') return 0;
  // Combining marks
  if (/^\p{M}$/u.test(g)) return 0;
  // Any grapheme containing ZWJ is an emoji sequence -> width 2
  if (g.includes('\u200d')) return 2;
  // Emoji property: treat as wide if any char is emoji and the grapheme looks emoji-like
  // Use a simple heuristic: if the grapheme contains an emoji codepoint, count as 2
  // when the rendered width would be 2 in typical terminals (most emoji).
  // We conservatively treat single emoji scalar as width 2.
  if (isWideCodePoint(cp)) return 2;
  // Check other codepoints in cluster
  for (const ch of g) {
    const c = ch.codePointAt(0);
    if (c !== undefined && isWideCodePoint(c)) return 2;
  }
  return 1;
}

export function displayWidth(text: string): number {
  if (text === '') return 0;
  const graphemes = splitGraphemes(text);
  let w = 0;
  for (const g of graphemes) w += graphemeWidth(g);
  return w;
}

function padEndByWidth(text: string, width: number): string {
  const w = displayWidth(text);
  if (w >= width) return text;
  return text + ' '.repeat(width - w);
}

function padStartByWidth(text: string, width: number): string {
  const w = displayWidth(text);
  if (w >= width) return text;
  return ' '.repeat(width - w) + text;
}

function padCenterByWidth(text: string, width: number): string {
  const w = displayWidth(text);
  if (w >= width) return text;
  const total = width - w;
  const left = Math.floor(total / 2);
  const right = total - left;
  return ' '.repeat(left) + text + ' '.repeat(right);
}

export function padCell(text: string, width: number, align: Align = 'left'): string {
  switch (align) {
    case 'right':
      return padStartByWidth(text, width);
    case 'center':
      return padCenterByWidth(text, width);
    default:
      return padEndByWidth(text, width);
  }
}

// --- Truncation / wrapping (never mid-grapheme) ---

export function truncateCell(text: string, maxWidth: number, ellipsis = '…'): string {
  if (maxWidth <= 0) return '';
  if (displayWidth(text) <= maxWidth) return text;
  const ellipsisW = displayWidth(ellipsis);
  const target = maxWidth - ellipsisW;
  if (target <= 0) {
    // Not enough room for ellipsis + content: slice graphemes to maxWidth
    return sliceByWidth(text, maxWidth);
  }
  return sliceByWidth(text, target) + ellipsis;
}

function sliceByWidth(text: string, maxWidth: number): string {
  const graphemes = splitGraphemes(text);
  let w = 0;
  let out = '';
  for (const g of graphemes) {
    const gw = graphemeWidth(g);
    if (w + gw > maxWidth) break;
    out += g;
    w += gw;
  }
  return out;
}

export function wrapCell(text: string, maxWidth: number): string[] {
  if (maxWidth <= 0) return [''];
  if (text === '') return [''];
  if (displayWidth(text) <= maxWidth) return [text];

  const graphemes = splitGraphemes(text);
  const lines: string[] = [];
  let cur = '';
  let curW = 0;
  let lastSpaceIdx = -1; // index in cur graphemes of last space
  let lastSpaceWidth = 0;

  // Build lines grapheme by grapheme, preferring to break at spaces.
  const curGraphemes: string[] = [];

  function flush() {
    if (curGraphemes.length > 0) {
      lines.push(curGraphemes.join(''));
      curGraphemes.length = 0;
      cur = '';
      curW = 0;
      lastSpaceIdx = -1;
    }
  }

  for (const g of graphemes) {
    const gw = graphemeWidth(g);
    if (curW + gw > maxWidth) {
      // Need to break
      if (lastSpaceIdx >= 0) {
        // Break at last space: emit up to space, keep remainder
        const before = curGraphemes.slice(0, lastSpaceIdx).join('');
        const after = curGraphemes.slice(lastSpaceIdx + 1).join('') + g;
        lines.push(before);
        // Reset with remainder
        const remainder = after;
        // Re-measure remainder
        curGraphemes.length = 0;
        curW = 0;
        // Fill curGraphemes with graphemes of remainder (grapheme-safe)
        for (const rg of splitGraphemes(remainder)) {
          curGraphemes.push(rg);
          curW += graphemeWidth(rg);
        }
        // Find last space in new cur
        lastSpaceIdx = -1;
        for (let i = curGraphemes.length - 1; i >= 0; i--) {
          if (curGraphemes[i] === ' ') { lastSpaceIdx = i; break; }
        }
      } else {
        flush();
        curGraphemes.push(g);
        curW = gw;
        if (g === ' ') lastSpaceIdx = 0;
      }
    } else {
      curGraphemes.push(g);
      curW += gw;
      if (g === ' ') lastSpaceIdx = curGraphemes.length - 1;
    }
  }
  if (curGraphemes.length > 0) lines.push(curGraphemes.join(''));
  // Trim trailing spaces per line
  return lines.map((l) => l.trimEnd());
}

function processCellContent(
  cell: string,
  maxWidth: number | null | undefined,
  overflow: 'truncate' | 'wrap' | 'none',
): string | string[] {
  if (maxWidth == null || maxWidth <= 0 || displayWidth(cell) <= maxWidth) return cell;
  if (overflow === 'wrap') return wrapCell(cell, maxWidth);
  if (overflow === 'truncate') return truncateCell(cell, maxWidth);
  return cell;
}

// --- Table rendering ---

export function computeColumnWidths(headers: string[], rows: string[][]): number[] {
  const colCount = Math.max(headers.length, ...rows.map((r) => r.length), 0);
  const widths: number[] = Array(colCount).fill(0);
  for (let i = 0; i < colCount; i++) {
    let max = headers[i] !== undefined ? displayWidth(headers[i] ?? '') : 0;
    for (const row of rows) {
      const cell = row[i] ?? '';
      const w = displayWidth(cell);
      if (w > max) max = w;
    }
    widths[i] = max;
  }
  return widths;
}

export function renderTable(
  headers: string[],
  rows: (string | null | undefined)[][],
  options: TableOptions = {},
): string[] {
  const colCount = Math.max(headers.length, ...rows.map((r) => r.length), 0);
  if (colCount === 0) return [];

  // Normalize cells to strings
  const normHeaders: string[] = Array.from({ length: colCount }, (_, i) => String(headers[i] ?? ''));
  const normRows: string[][] = rows.map((r) =>
    Array.from({ length: colCount }, (_, i) => {
      const v = r[i];
      return v == null ? '' : String(v);
    }),
  );

  const pad = options.pad ?? (options.align !== undefined);
  const overflow = options.overflow ?? (options.maxColumnWidths ? 'truncate' : 'none');

  // If overflow wrap/truncate with maxColumnWidths, preprocess cells
  let effHeaders = normHeaders;
  let effRows = normRows;
  let colWidths: number[];

  if (options.maxColumnWidths && overflow !== 'none') {
    // For truncate, widths are capped; for wrap we keep capped width but cells may become multi-line.
    // For simplicity, first process headers/rows for display, then compute widths.
    const cappedHeaders = effHeaders.map((h, i) => {
      const mw = options.maxColumnWidths?.[i];
      if (mw == null) return h;
      const p = processCellContent(h, mw, overflow);
      return Array.isArray(p) ? p[0] ?? '' : p;
    });
    const cappedRows = effRows.map((row) =>
      row.map((cell, i) => {
        const mw = options.maxColumnWidths?.[i];
        if (mw == null) return cell;
        const p = processCellContent(cell, mw, overflow);
        // For wrap, we need to handle multi-line later; use first line for width
        return Array.isArray(p) ? p[0] ?? '' : p;
      }),
    );
    // Only for wrap we need multi-line expansion; truncate already single line
    if (overflow === 'wrap') {
      // Expand rows where any cell wraps to multiple lines
      const expanded: string[][] = [];
      for (const row of normRows) {
        const wrappedCols: string[][] = row.map((cell, i) => {
          const mw = options.maxColumnWidths?.[i];
          if (mw == null) return [cell];
          const p = processCellContent(cell, mw, 'wrap');
          return Array.isArray(p) ? p : [p as string];
        });
        const maxLines = Math.max(...wrappedCols.map((c) => c.length));
        for (let lineIdx = 0; lineIdx < maxLines; lineIdx++) {
          expanded.push(wrappedCols.map((col) => col[lineIdx] ?? ''));
        }
      }
      // Headers stay single line (capped)
      effHeaders = cappedHeaders;
      effRows = expanded;
      colWidths = computeColumnWidths(effHeaders, effRows);
      // Cap widths to maxColumnWidths
      for (let i = 0; i < colCount; i++) {
        const mw = options.maxColumnWidths?.[i];
        if (mw != null && colWidths[i]! > mw) colWidths[i] = mw;
      }
    } else {
      effHeaders = cappedHeaders;
      effRows = cappedRows;
      colWidths = computeColumnWidths(effHeaders, effRows);
    }
  } else {
    effHeaders = normHeaders;
    effRows = normRows;
    colWidths = computeColumnWidths(effHeaders, effRows);
  }

  // When not padded, render compact markdown (no extra spaces)
  if (!pad) {
    const headerLine = `| ${effHeaders.join(' | ')} |`;
    const sepCells = effHeaders.map((h) => '-'.repeat(displayWidth(h) + 2));
    const separator = `|${sepCells.join('|')}|`;
    // Compact rows: same as before, ignore computed colWidths for separator
    // But for data rows use the effective cells after truncation/wrapping expansion
    const dataLines = effRows.map((row) => `| ${row.join(' | ')} |`);
    return [headerLine, separator, ...dataLines];
  }

  // Padded aligned mode
  const aligns = options.align ?? [];
  const headerLine =
    '| ' +
    effHeaders.map((h, i) => padCell(h, colWidths[i]!, aligns[i] ?? 'left')).join(' | ') +
    ' |';
  const separator = '|' + colWidths.map((w) => '-'.repeat(w + 2)).join('|') + '|';
  const dataLines = effRows.map(
    (row) =>
      '| ' +
      row.map((cell, i) => padCell(cell, colWidths[i]!, aligns[i] ?? 'left')).join(' | ') +
      ' |',
  );
  return [headerLine, separator, ...dataLines];
}
