import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// T002: structural test asserting neither src/state/claude-assets.ts nor
// src/cli/commands/init.ts references os.homedir, process.env.HOME, or
// process.env.USERPROFILE anywhere -- every classification/installation
// call in this milestone must take an explicit repository root and operate
// only under <root>/.claude/, never the developer's own home directory.
// Later tasks extend FILES for their own new modules once they exist.
const FILES = ['src/state/claude-assets.ts', 'src/cli/commands/init.ts'];

const FORBIDDEN_PATTERN = /os\.homedir\s*\(|process\.env\.HOME\b|process\.env\.USERPROFILE\b/;

describe('no global home-directory access in Claude asset code (T002)', () => {
  it('the detection pattern actually catches a reintroduced reference (proves this test can fail)', () => {
    expect(FORBIDDEN_PATTERN.test('const x = os.homedir();')).toBe(true);
    expect(FORBIDDEN_PATTERN.test('const y = process.env.HOME;')).toBe(true);
    expect(FORBIDDEN_PATTERN.test('const z = process.env.USERPROFILE;')).toBe(true);
    // Similarly-named but unrelated identifiers must not false-positive.
    expect(FORBIDDEN_PATTERN.test('const ok = process.env.HOMEBREW_PREFIX;')).toBe(false);
  });

  for (const file of FILES) {
    it(`${file} never references os.homedir, process.env.HOME, or process.env.USERPROFILE`, () => {
      const content = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
      expect(FORBIDDEN_PATTERN.test(content)).toBe(false);
    });
  }
});
