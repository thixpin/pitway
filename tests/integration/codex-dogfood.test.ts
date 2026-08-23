import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('M026 Codex dogfooding evidence (AC006, AC007)', () => {
  it('docs/evidence/M026/codex-dogfood.md exists with honest scoping and workflow evidence', () => {
    const p = join(process.cwd(), 'docs/evidence/M026/codex-dogfood.md');
    expect(existsSync(p)).toBe(true);
    const text = readFileSync(p, 'utf8');
    expect(text).toContain('Codex');
    expect(text).toContain('honest');
    expect(text).toContain('pitway init --codex');
    expect(text).toContain('Command discovery');
    expect(text).toContain('Asset resolution');
  });

  it('docs/evidence/M026/codex-limitations.md exists dispositioning at least four findings', () => {
    const p = join(process.cwd(), 'docs/evidence/M026/codex-limitations.md');
    expect(existsSync(p)).toBe(true);
    const text = readFileSync(p, 'utf8');
    // At least the four required findings per AC007
    expect(text).toMatch(/\.agents\/skills.*\.codex\/skills/s);
    expect(text).toMatch(/TOML.*markdown|agents.*TOML/i);
    expect(text).toMatch(/custom prompts.*deprecated/i);
    expect(text).toMatch(/sandbox.*approval/i);
  });

  it('README mentions Codex driver', () => {
    const text = readFileSync(join(process.cwd(), 'README.md'), 'utf8');
    expect(text).toContain('Codex');
    expect(text).toContain('pitway init --codex');
  });
});
