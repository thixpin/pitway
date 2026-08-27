import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// M038/T002 (AC004, AC005, AC006): the declared layering is
// CLI -> Core -> State + Git. These checks inspect source text, not the
// module graph at runtime, so a re-introduced upward import fails by file
// name before any behavior test could notice it.

function source(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), 'utf8');
}

describe('layering: State never imports Core', () => {
  it.each(['src/state/journal.ts', 'src/state/journal-operations.ts'])(
    '%s has no import from ../core/',
    (file) => {
      expect(source(file)).not.toMatch(/from\s+['"]\.\.\/core\//);
    },
  );
});

describe('layering: src/git/safety.ts is pure Git classification', () => {
  it('imports nothing from ../state/ or ../core/', () => {
    const text = source('src/git/safety.ts');
    expect(text).not.toMatch(/from\s+['"]\.\.\/state\//);
    expect(text).not.toMatch(/from\s+['"]\.\.\/core\//);
  });

  it('imports only its sibling git primitives', () => {
    const imports = [...source('src/git/safety.ts').matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) expect(spec).toMatch(/^\.\/exec\.js$/);
  });
});
