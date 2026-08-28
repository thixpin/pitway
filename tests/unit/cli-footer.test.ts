import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeActiveMilestoneFooter } from '../../src/cli/footer.js';
import { getFooterForActiveMilestone } from '../../src/core/milestones/footer.js';
import { saveContract, saveState, saveTasks, saveVerificationResults } from '../../src/state/store.js';
import type { ContractFrontmatter, Task } from '../../src/state/schemas.js';

// B038: the one CLI helper every mutating command uses to append the racing
// footer. It owns the three rules the 16 former call sites hand-repeated:
// never in --json, never when Core yields null (draft / no active
// milestone / unreadable state), and -- for commands that take an explicit
// milestone id -- only when that id IS the active milestone.

let root: string;

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function frontmatter(status: ContractFrontmatter['status']): ContractFrontmatter {
  return {
    schema_version: 1,
    id: 'M001',
    title: 'Test Milestone',
    status,
    requirement: null,
    confirmed_at: null,
    verification_approved_hash: null,
    acceptance_criteria: [{ id: 'AC001', text: 'x' }],
    verification: [{ id: 'CT001', criterion: 'AC001', type: 'command', command: 'npm test' }],
  };
}

function task(overrides: Partial<Task> & Pick<Task, 'id' | 'status'>): Task {
  return {
    objective: 'x',
    depends_on: [],
    acceptance_criteria: ['x'],
    relevant_files: [],
    verification: { strategy: 'tdd', detail: 'npm test' },
    result: null,
    usage: null,
    ...overrides,
  };
}

function confirmedMilestone(): void {
  saveState(root, { schema_version: 1, active_milestone: 'M001', milestones: ['M001'] });
  saveContract(root, 'M001', { frontmatter: frontmatter('in_progress'), body: '\n' });
  saveTasks(root, 'M001', { schema_version: 1, tasks: [task({ id: 'T001', status: 'ready' })] });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pitway-cli-footer-'));
  git(['init', '-q'], root);
  mkdirSync(join(root, '.pitway', 'milestones', 'M001'), { recursive: true });
  saveVerificationResults(root, 'M001', { schema_version: 1, results: [] });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('writeActiveMilestoneFooter', () => {
  it('writes exactly the Core footer, once, for a confirmed active milestone in human mode', () => {
    confirmedMilestone();
    const lines: string[] = [];
    writeActiveMilestoneFooter(root, (l) => lines.push(l), {});
    expect(lines).toEqual([getFooterForActiveMilestone(root)]);
    expect(lines[0]).toMatch(/^🏎️ \d+% · ✅ 0\/1 · Next: T001$/);
  });

  it('writes nothing in --json mode', () => {
    confirmedMilestone();
    const lines: string[] = [];
    writeActiveMilestoneFooter(root, (l) => lines.push(l), { json: true });
    expect(lines).toEqual([]);
  });

  it('writes nothing when Core yields null (draft milestone) and nothing when no milestone is active', () => {
    saveState(root, { schema_version: 1, active_milestone: 'M001', milestones: ['M001'] });
    saveContract(root, 'M001', { frontmatter: frontmatter('draft'), body: '\n' });
    saveTasks(root, 'M001', { schema_version: 1, tasks: [task({ id: 'T001', status: 'planned' })] });
    const lines: string[] = [];
    writeActiveMilestoneFooter(root, (l) => lines.push(l), {});
    expect(lines).toEqual([]);

    saveState(root, { schema_version: 1, active_milestone: null, milestones: ['M001'] });
    writeActiveMilestoneFooter(root, (l) => lines.push(l), {});
    expect(lines).toEqual([]);
  });

  it('never throws when state.yaml is missing or unreadable', () => {
    rmSync(join(root, '.pitway'), { recursive: true, force: true });
    const lines: string[] = [];
    expect(() => writeActiveMilestoneFooter(root, (l) => lines.push(l), {})).not.toThrow();
    mkdirSync(join(root, '.pitway'), { recursive: true });
    writeFileSync(join(root, '.pitway', 'state.yaml'), 'not: [valid\n');
    expect(() => writeActiveMilestoneFooter(root, (l) => lines.push(l), { milestone: 'M001' })).not.toThrow();
    expect(lines).toEqual([]);
  });

  it('with `milestone` set, writes only when that id is the active milestone', () => {
    confirmedMilestone();
    const lines: string[] = [];
    writeActiveMilestoneFooter(root, (l) => lines.push(l), { milestone: 'M002' });
    expect(lines).toEqual([]);
    writeActiveMilestoneFooter(root, (l) => lines.push(l), { milestone: 'M001' });
    expect(lines).toEqual([getFooterForActiveMilestone(root)]);
  });
});
