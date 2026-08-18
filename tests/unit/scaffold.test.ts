import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

describe('project scaffold', () => {
  it('declares the approved package metadata', () => {
    expect(pkg['name']).toBe('pitway');
    expect(pkg['license']).toBe('MIT');
    expect(pkg['type']).toBe('module');
    expect((pkg['engines'] as Record<string, string>)['node']).toBe('>=20');
  });
});
