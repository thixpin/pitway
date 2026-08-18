import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveContract, saveState, saveTasks } from '../../src/state/store.js';
import { buildCli } from '../../src/cli/index.js';
import { registerTaskStatusCommand } from '../../src/cli/commands/task-status.js';
import type { ContractFrontmatter, Task } from '../../src/state/schemas.js';

let root: string;

const frontmatter: ContractFrontmatter = {
  schema_version: 1,
  id: 'M001',
  title: 'Test Milestone',
  status: 'in_progress',
  requirement: null,
  confirmed_at: '2026-08-18T00:00:00Z',
  verification_approved_hash: 'sha256:' + 'a'.repeat(64),
  acceptance_criteria: [{ id: 'AC001', text: 'Secret criterion text' }],
  verification: [{ id: 'CT001', criterion: 'AC001', type: 'command', command: 'npm test' }],
};

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

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pitway-tstatus-'));
  mkdirSync(join(root, '.pitway', 'milestones', 'M001'), { recursive: true });
  saveState(root, { schema_version: 1, active_milestone: 'M001', milestones: ['M001'] });
  saveContract(root, 'M001', { frontmatter, body: '\n# Contract\n' });
  saveTasks(root, 'M001', {
    schema_version: 1,
    tasks: [
      task({
        id: 'T001',
        status: 'completed',
        objective: 'Dependency task',
        result: { summary: 'Dependency done.', evidence: 'tests passed' },
      }),
      task({
        id: 'T002',
        status: 'in_progress',
        objective: 'Target task',
        depends_on: ['T001'],
        acceptance_criteria: ['Target AC'],
        relevant_files: ['src/target.ts'],
        verification: { strategy: 'tdd', detail: 'npm test -- target.test.ts' },
      }),
      task({
        id: 'T003',
        status: 'in_progress',
        objective: 'UNRELATED_SIBLING_MARKER_OBJECTIVE',
        result: { summary: 'UNRELATED_SIBLING_MARKER_RESULT', evidence: 'x' },
      }),
    ],
  });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('pitway task-status', () => {
  it('reports status, dependencies, and result summary by default', async () => {
    const program = buildCli();
    const lines: string[] = [];
    registerTaskStatusCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'task-status', 'T001', '--json']);

    const view = JSON.parse(lines.join('\n'));
    expect(view.id).toBe('T001');
    expect(view.status).toBe('completed');
    expect(view.dependsOn).toEqual([]);
    expect(view.result).toEqual({ summary: 'Dependency done.', evidence: 'tests passed' });
  });

  it('emits exactly the minimal context bundle with --context, excluding unrelated tasks', async () => {
    const program = buildCli();
    const lines: string[] = [];
    registerTaskStatusCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'task-status', 'T002', '--context', '--json']);

    const output = lines.join('\n');
    const bundle = JSON.parse(output);

    expect(bundle.task).toEqual({ id: 'T002', objective: 'Target task' });
    expect(bundle.acceptanceCriteria).toEqual(['Target AC']);
    expect(bundle.contractExcerpt).toEqual({
      title: 'Test Milestone',
      acceptanceCriteria: [{ id: 'AC001', text: 'Secret criterion text' }],
    });
    expect(bundle.dependencyResults).toEqual([{ id: 'T001', summary: 'Dependency done.' }]);
    expect(bundle.relevantFiles).toEqual(['src/target.ts']);
    expect(bundle.verificationInstructions).toBe('npm test -- target.test.ts');

    // Exactly these six keys — nothing else leaks in.
    expect(Object.keys(bundle).sort()).toEqual([
      'acceptanceCriteria',
      'contractExcerpt',
      'dependencyResults',
      'relevantFiles',
      'task',
      'verificationInstructions',
    ]);

    // The unrelated sibling task's content must not appear anywhere.
    expect(output).not.toContain('UNRELATED_SIBLING_MARKER');
  });
});
