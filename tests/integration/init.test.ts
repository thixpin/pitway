import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { buildCli } from '../../src/cli/index.js';
import { registerInitCommand } from '../../src/cli/commands/init.js';

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

let root: string;

async function runInit(cwd: string): Promise<{ lines: string[]; error?: Error }> {
  const program = buildCli();
  const lines: string[] = [];
  registerInitCommand(program, { root: cwd, write: (s) => lines.push(s) });
  try {
    await program.parseAsync(['node', 'pitway', 'init']);
    return { lines };
  } catch (error) {
    return { lines, error: error as Error };
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pitway-init-'));
  git(['init', '-q'], root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('pitway init', () => {
  it('refuses outside a git work tree and creates nothing', async () => {
    const nonRepo = mkdtempSync(join(tmpdir(), 'pitway-init-nongit-'));
    try {
      const { error } = await runInit(nonRepo);
      expect(error?.message).toMatch(/git/i);
      expect(existsSync(join(nonRepo, '.pitway'))).toBe(false);
    } finally {
      rmSync(nonRepo, { recursive: true, force: true });
    }
  });

  it('creates exactly config.yaml and state.yaml in a clean repo', async () => {
    const { error } = await runInit(root);
    expect(error).toBeUndefined();
    const config = parse(readFileSync(join(root, '.pitway', 'config.yaml'), 'utf8'));
    const state = parse(readFileSync(join(root, '.pitway', 'state.yaml'), 'utf8'));
    expect(config).toEqual({ schema_version: 1 });
    expect(state).toEqual({ schema_version: 1, active_milestone: null, milestones: [] });
    const entries = execFileSync('ls', ['-A', join(root, '.pitway')]).toString().trim().split('\n');
    expect(entries.sort()).toEqual(['config.yaml', 'state.yaml']);
  });

  it('is a safe no-op when both files exist and validate', async () => {
    await runInit(root);
    writeFileSync(join(root, 'marker.txt'), 'x\n');
    const before = readFileSync(join(root, '.pitway', 'state.yaml'), 'utf8');
    const { error } = await runInit(root);
    expect(error).toBeUndefined();
    expect(readFileSync(join(root, '.pitway', 'state.yaml'), 'utf8')).toBe(before);
  });

  it('refuses partial state (config present, state missing) without overwriting', async () => {
    await runInit(root);
    rmSync(join(root, '.pitway', 'state.yaml'));
    const { error } = await runInit(root);
    expect(error?.message).toMatch(/inconsistent|partial/i);
    expect(existsSync(join(root, '.pitway', 'state.yaml'))).toBe(false);
  });

  it('refuses invalid existing state without overwriting', async () => {
    await runInit(root);
    writeFileSync(join(root, '.pitway', 'state.yaml'), 'schema_version: 99\n');
    const { error } = await runInit(root);
    expect(error?.message).toMatch(/inconsistent|invalid/i);
    expect(readFileSync(join(root, '.pitway', 'state.yaml'), 'utf8')).toBe('schema_version: 99\n');
  });
});
