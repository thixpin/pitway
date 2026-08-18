import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveContract, saveState } from '../../src/state/store.js';
import { buildCli } from '../../src/cli/index.js';
import { registerMilestoneListCommand } from '../../src/cli/commands/milestone-list.js';
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
  root = mkdtempSync(join(tmpdir(), 'pitway-mlist-'));
  mkdirSync(join(root, '.pitway', 'milestones', 'M001'), { recursive: true });
  mkdirSync(join(root, '.pitway', 'milestones', 'M002'), { recursive: true });

  saveState(root, { schema_version: 1, active_milestone: 'M002', milestones: ['M001', 'M002'] });
  saveContract(root, 'M001', { frontmatter: frontmatter('M001', 'Auth', 'completed'), body: '\n' });
  saveContract(root, 'M002', { frontmatter: frontmatter('M002', 'Caching', 'in_progress'), body: '\n' });
  // Deliberately no tasks.yaml / verification-results.yaml / usage.yaml for
  // either milestone: if milestone-list ever tried to load them, this would
  // throw and fail the test.
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('pitway milestone-list', () => {
  it('lists every milestone from the state index without loading task/verification/usage detail', async () => {
    const program = buildCli();
    const lines: string[] = [];
    registerMilestoneListCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'milestone-list', '--json']);

    const entries = JSON.parse(lines.join('\n'));
    expect(entries).toEqual([
      { id: 'M001', title: 'Auth', status: 'completed' },
      { id: 'M002', title: 'Caching', status: 'in_progress' },
    ]);
  });

  it('renders a concise one-line human summary per milestone', async () => {
    const program = buildCli();
    const lines: string[] = [];
    registerMilestoneListCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'milestone-list']);

    const output = lines.join('\n');
    expect(output).toContain('M001');
    expect(output).toContain('Auth');
    expect(output).toContain('M002');
    expect(output).toContain('Caching');
  });
});
