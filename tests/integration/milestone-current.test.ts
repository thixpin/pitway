import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveContract, saveState } from '../../src/state/store.js';
import { buildCli } from '../../src/cli/index.js';
import { registerMilestoneCurrentCommand } from '../../src/cli/commands/milestone-current.js';
import type { ContractFrontmatter } from '../../src/state/schemas.js';

let root: string;

function frontmatter(id: string, title: string, status: ContractFrontmatter['status']): ContractFrontmatter {
  return {
    schema_version: 1,
    id,
    title,
    status,
    requirement: null,
    confirmed_at: null,
    verification_approved_hash: null,
    acceptance_criteria: [{ id: 'AC001', text: 'x' }],
    verification: [{ id: 'CT001', criterion: 'AC001', type: 'command', command: 'npm test' }],
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pitway-mcurrent-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('pitway milestone-current', () => {
  it('reports no active milestone when state.active_milestone is null', async () => {
    saveState(root, { schema_version: 1, active_milestone: null, milestones: [] });

    const program = buildCli();
    const lines: string[] = [];
    registerMilestoneCurrentCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'milestone-current', '--json']);

    expect(JSON.parse(lines.join('\n'))).toEqual({ active: false, id: null, status: null });
  });

  it('reports the active milestone id and its real contract status, e.g. draft', async () => {
    mkdirSync(join(root, '.pitway', 'milestones', 'M001'), { recursive: true });
    saveState(root, { schema_version: 1, active_milestone: 'M001', milestones: ['M001'] });
    saveContract(root, 'M001', { frontmatter: frontmatter('M001', 'Auth', 'draft'), body: '\n' });

    const program = buildCli();
    const lines: string[] = [];
    registerMilestoneCurrentCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'milestone-current', '--json']);

    expect(JSON.parse(lines.join('\n'))).toEqual({ active: true, id: 'M001', status: 'draft' });
  });

  it('reports the active milestone status as in_progress once confirmed and started', async () => {
    mkdirSync(join(root, '.pitway', 'milestones', 'M002'), { recursive: true });
    saveState(root, { schema_version: 1, active_milestone: 'M002', milestones: ['M002'] });
    saveContract(root, 'M002', { frontmatter: frontmatter('M002', 'Caching', 'in_progress'), body: '\n' });

    const program = buildCli();
    const lines: string[] = [];
    registerMilestoneCurrentCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'milestone-current', '--json']);

    expect(JSON.parse(lines.join('\n'))).toEqual({ active: true, id: 'M002', status: 'in_progress' });
  });

  it('renders a terse human summary when no milestone is active', async () => {
    saveState(root, { schema_version: 1, active_milestone: null, milestones: [] });

    const program = buildCli();
    const lines: string[] = [];
    registerMilestoneCurrentCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'milestone-current']);

    expect(lines.join('\n')).toBe('No active milestone.');
  });

  it('renders the id and a human status label when a milestone is active', async () => {
    mkdirSync(join(root, '.pitway', 'milestones', 'M003'), { recursive: true });
    saveState(root, { schema_version: 1, active_milestone: 'M003', milestones: ['M003'] });
    saveContract(root, 'M003', { frontmatter: frontmatter('M003', 'Billing', 'review'), body: '\n' });

    const program = buildCli();
    const lines: string[] = [];
    registerMilestoneCurrentCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'milestone-current']);

    const output = lines.join('\n');
    expect(output).toContain('M003');
    expect(output).toContain('Review');
  });

  it('is registered under the alias ms-current', async () => {
    saveState(root, { schema_version: 1, active_milestone: null, milestones: [] });

    const program = buildCli();
    const lines: string[] = [];
    registerMilestoneCurrentCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'ms-current']);

    expect(lines.join('\n')).toBe('No active milestone.');
  });
});

// Mirrors milestone-list.test.ts's default CommandDeps coverage.
describe('pitway milestone-current default CommandDeps fallbacks', () => {
  it('falls back to console.log and process.cwd() when no overrides are given', async () => {
    saveState(root, { schema_version: 1, active_milestone: null, milestones: [] });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cwdBefore = process.cwd();
    process.chdir(root);
    let caught: unknown;
    let calls: unknown[][] = [];
    try {
      const program = buildCli();
      registerMilestoneCurrentCommand(program);
      await program.parseAsync(['node', 'pitway', 'milestone-current']);
    } catch (error) {
      caught = error;
    } finally {
      calls = logSpy.mock.calls;
      process.chdir(cwdBefore);
      logSpy.mockRestore();
    }

    expect(caught).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.[0])).toBe('No active milestone.');
  });
});
