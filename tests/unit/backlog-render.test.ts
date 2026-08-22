import { describe, it, expect } from 'vitest';
import { wrapText, formatSource, renderListHuman, renderItemHuman } from '../../src/cli/commands/backlog.js';
import type { BacklogItem } from '../../src/state/schemas.js';

function makeItem(overrides: Partial<BacklogItem> = {}): BacklogItem {
  const now = new Date().toISOString();
  return {
    id: 'B001',
    title: 'Example title',
    reason: 'Short reason.',
    status: 'pending',
    source: { milestone: 'M001', task: null },
    created_at: now,
    resolved_at: null,
    promoted_to: null,
    archived_reason: null,
    ...overrides,
  } as BacklogItem;
}

describe('wrapText', () => {
  it('wraps a long paragraph at ~80 cols without exceeding width', () => {
    const long =
      'This is a very long sentence that should be wrapped at eighty columns because it exceeds the default terminal width and contains many words.';
    const wrapped = wrapText(long, 80);
    const lines = wrapped.split('\n');
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(80);
    // Re-joining should preserve words
    expect(wrapped.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()).toBe(long);
  });

  it('preserves blank lines (paragraph breaks)', () => {
    const text = 'First paragraph.\n\nSecond paragraph after blank line.';
    const wrapped = wrapText(text, 80);
    expect(wrapped).toContain('\n\n');
    expect(wrapped.split('\n\n')).toHaveLength(2);
  });

  it('preserves bullet prefix and indents continuation', () => {
    const bullet =
      '- This is a very long bullet point that definitely exceeds eighty characters and should wrap with an indented continuation line aligning under the bullet text.';
    const wrapped = wrapText(bullet, 80);
    const lines = wrapped.split('\n');
    expect(lines[0]!.startsWith('- ')).toBe(true);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(80);
    if (lines.length > 1) expect(lines[1]!.startsWith('  ')).toBe(true);
    // Content words preserved
    expect(wrapped.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()).toBe(bullet.replace(/\s+/g, ' ').trim());
  });

  it('preserves numbered list prefix', () => {
    const numbered =
      '1. This is a numbered item with a very long description that should wrap correctly and keep the numbered prefix on the first line only.';
    const wrapped = wrapText(numbered, 80);
    const lines = wrapped.split('\n');
    expect(lines[0]!.startsWith('1. ')).toBe(true);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(80);
  });

  it('preserves markdown heading line', () => {
    const heading = '## This is a heading that is intentionally made very long to see whether it wraps but still keeps the heading marker on the first line';
    const wrapped = wrapText(heading, 80);
    const lines = wrapped.split('\n');
    expect(lines[0]!.startsWith('## ')).toBe(true);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(80);
  });

  it('handles empty string', () => {
    expect(wrapText('', 80)).toBe('');
  });

  it('handles single long word by hard-breaking', () => {
    const word = 'a'.repeat(100);
    const wrapped = wrapText(word, 80);
    const lines = wrapped.split('\n');
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(80);
    expect(lines.join('')).toBe(word);
  });
});

describe('formatSource', () => {
  it('formats milestone/task as M001/T001', () => {
    expect(formatSource({ milestone: 'M001', task: 'T001' })).toBe('M001/T001');
  });
  it('formats milestone alone', () => {
    expect(formatSource({ milestone: 'M002', task: null })).toBe('M002');
  });
  it('returns em dash when no milestone', () => {
    expect(formatSource({ milestone: null, task: null })).toBe('—');
  });
});

describe('renderListHuman', () => {
  it('renders empty-state line', () => {
    expect(renderListHuman([])).toBe('No backlog items recorded.');
  });

  it('renders header + empty line when filtered empty', () => {
    expect(renderListHuman([], { milestone: 'M999' })).toBe(
      'Backlog (filtered: milestone=M999)\nNo backlog items recorded.',
    );
  });

  it('renders a table with header and rows via shared renderer', () => {
    const items = [makeItem({ id: 'B001', title: 'First', source: { milestone: 'M001', task: null } })];
    const out = renderListHuman(items);
    const lines = out.split('\n');
    // Table header from renderTable
    expect(lines[0]).toBe('| ID | Status | Source | Title |');
    expect(lines[1]).toMatch(/^\|[-|]+\|$/);
    expect(lines[2]).toContain('B001');
    expect(lines[2]).toContain('pending');
    expect(lines[2]).toContain('M001');
    expect(lines[2]).toContain('First');
  });

  it('includes filtered header above the table', () => {
    const items = [makeItem({ id: 'B002', title: 'Second', source: { milestone: 'M002', task: null } })];
    const out = renderListHuman(items, { milestone: 'M002' });
    const lines = out.split('\n');
    expect(lines[0]).toBe('Backlog (filtered: milestone=M002)');
    expect(lines[1]).toBe('| ID | Status | Source | Title |');
  });

  it('shows source as M001/T001 when task present', () => {
    const items = [
      makeItem({ id: 'B003', title: 'With task', source: { milestone: 'M001', task: 'T001' } }),
    ];
    const out = renderListHuman(items);
    expect(out).toContain('M001/T001');
  });
});

describe('renderItemHuman', () => {
  it('presents title/status/source plus wrapped reason', () => {
    const item = makeItem({ id: 'B001', title: 'Thing', reason: 'Why', source: { milestone: 'M001', task: null } });
    const out = renderItemHuman(item);
    expect(out).toContain('B001 [pending] Thing');
    expect(out).toContain('Source: M001');
    expect(out).toContain('Status: pending');
    expect(out).toContain('Why');
  });

  it('wraps long reason and preserves markdown bullets', () => {
    const reason = [
      'This is a long introduction that should be wrapped at eighty columns for terminal readability.',
      '',
      '- First bullet is very long and should wrap with indentation kept aligned under the bullet content for legibility.',
      '- Second bullet short.',
      '',
      '## Heading should stay readable',
    ].join('\n');
    const item = makeItem({ reason });
    const out = renderItemHuman(item);
    // All lines <=80 except the header lines (which are short)
    // Reason portion after blank line should be wrapped
    const reasonLines = out.split('\n').slice(out.split('\n').indexOf('') + 1);
    // But header lines: check bullet preservation inside output
    expect(out).toContain('- First bullet');
    expect(out).toContain('## Heading');
    // Ensure no reason line exceeds 80 after wrapping
    for (const l of reasonLines) {
      if (l.trim() === '' || l.startsWith('B0') || l.startsWith('Source:') || l.startsWith('Status:')) continue;
      expect(l.length).toBeLessThanOrEqual(80);
    }
  });

  it('shows promoted and archived fields when present', () => {
    const promoted = makeItem({
      status: 'promoted',
      promoted_to: { milestone: 'M002', task: 'T002' },
      resolved_at: new Date().toISOString(),
    });
    expect(renderItemHuman(promoted)).toContain('Promoted to: M002/T002');

    const archived = makeItem({
      status: 'archived',
      archived_reason: 'No longer relevant',
      resolved_at: new Date().toISOString(),
    });
    expect(renderItemHuman(archived)).toContain('Archived: No longer relevant');
  });

  it('keeps structured data untouched — JSON via renderOutput is separate (smoke)', () => {
    const item = makeItem({ reason: 'Keep **bold** and - bullets' });
    const human = renderItemHuman(item);
    // Human should contain the raw markdown-ish text
    expect(human).toContain('**bold**');
    expect(human).toContain('- bullets');
  });
});
