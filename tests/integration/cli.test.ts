import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderOutput } from '../../src/cli/output.js';

const cliPath = fileURLToPath(new URL('../../src/cli/index.ts', import.meta.url));
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
) as { version: string };

function runCli(args: string[]): string {
  return execFileSync('node', [cliPath, ...args], { stdio: 'pipe' }).toString();
}

describe('pitway bin entry point', () => {
  it('resolves and runs, reporting the package version', () => {
    const output = runCli(['--version']);
    expect(output.trim()).toBe(pkg.version);
  });

  it('shows help naming the pitway program', () => {
    const output = runCli(['--help']);
    expect(output).toContain('pitway');
  });
});

describe('renderOutput', () => {
  it('renders valid JSON when json is requested', () => {
    const rendered = renderOutput({ a: 1 }, { json: true }, () => 'human');
    expect(() => JSON.parse(rendered)).not.toThrow();
    expect(JSON.parse(rendered)).toEqual({ a: 1 });
  });

  it('renders via the human formatter otherwise', () => {
    const rendered = renderOutput({ a: 1 }, { json: false }, (d) => `human:${d.a}`);
    expect(rendered).toBe('human:1');
  });
});
