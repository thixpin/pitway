import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// M027/T002 (AC002): the README-embedded workflow SVG must stay in sync with
// its Mermaid source. These pins cover the diagram's load-bearing nodes -- the
// ones that encode flows added after the original render (quick change against
// a completed milestone, milestone merge, the failed-final-test revision loop)
// plus the B020 RED→GREEN gate -- so either file drifting silently fails here
// by name.

const mmd = readFileSync(join(process.cwd(), 'docs/assets/workflow.mmd'), 'utf8');
const svg = readFileSync(join(process.cwd(), 'docs/assets/workflow.svg'), 'utf8');

const KEY_LABELS = [
  '⚡ Quick Change (completed milestone)',
  'TDD (RED→GREEN)',
  'Milestone Merge',
  'Milestone revision',
  'Backlog',
  'Human Approval',
  'Milestone Complete',
];

describe('workflow diagram source/SVG sync (M027/T002)', () => {
  it.each(KEY_LABELS.map((label) => [label]))('mermaid source declares "%s"', (label) => {
    expect(mmd).toContain(label);
  });

  it.each(KEY_LABELS.map((label) => [label]))('rendered SVG contains "%s"', (label) => {
    expect(svg).toContain(label);
  });

  it('SVG is a mermaid flowchart render of the same graph generation', () => {
    expect(svg).toMatch(/<svg /);
    expect(svg).toMatch(/mermaid|flowchart-v2/);
  });
});
