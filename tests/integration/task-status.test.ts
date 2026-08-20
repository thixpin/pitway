import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

// AC011/T010: a second, multi-AC contract fixture used only by the
// mapped_ac_ids filtering tests below -- kept separate from `frontmatter`
// so the existing unfiltered-bundle test above stays byte-for-byte as it
// was before this task.
const multiAcFrontmatter: ContractFrontmatter = {
  ...frontmatter,
  acceptance_criteria: [
    { id: 'AC001', text: 'First criterion text' },
    { id: 'AC002', text: 'Second criterion text' },
    { id: 'AC003', text: 'Third criterion text' },
  ],
  verification: [
    { id: 'CT001', criterion: 'AC001', type: 'command', command: 'npm test' },
    { id: 'CT002', criterion: 'AC002', type: 'command', command: 'npm test' },
    { id: 'CT003', criterion: 'AC003', type: 'command', command: 'npm test' },
  ],
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

  // AC011/T010: mapped_ac_ids filtering, exercised end-to-end through the
  // task-status --context --json command against a synthetic multi-AC
  // contract, separate from the fixtures above.
  describe('mapped_ac_ids filtering (T010)', () => {
    it('filters contractExcerpt.acceptanceCriteria to exactly the mapped ids when present', async () => {
      saveContract(root, 'M001', { frontmatter: multiAcFrontmatter, body: '\n# Contract\n' });
      saveTasks(root, 'M001', {
        schema_version: 1,
        tasks: [
          task({
            id: 'T002',
            status: 'in_progress',
            objective: 'Target task',
            acceptance_criteria: ['Target AC'],
            relevant_files: ['src/target.ts'],
            mapped_ac_ids: ['AC002'],
            verification: { strategy: 'tdd', detail: 'npm test -- target.test.ts' },
          }),
        ],
      });

      const program = buildCli();
      const lines: string[] = [];
      registerTaskStatusCommand(program, { root, write: (s) => lines.push(s) });
      await program.parseAsync(['node', 'pitway', 'task-status', 'T002', '--context', '--json']);

      const bundle = JSON.parse(lines.join('\n'));
      expect(bundle.contractExcerpt.acceptanceCriteria).toEqual([
        { id: 'AC002', text: 'Second criterion text' },
      ]);
    });

    it('leaves contractExcerpt.acceptanceCriteria as the full, unfiltered array when mapped_ac_ids is absent', async () => {
      saveContract(root, 'M001', { frontmatter: multiAcFrontmatter, body: '\n# Contract\n' });
      saveTasks(root, 'M001', {
        schema_version: 1,
        tasks: [
          task({
            id: 'T002',
            status: 'in_progress',
            objective: 'Target task',
            acceptance_criteria: ['Target AC'],
            relevant_files: ['src/target.ts'],
            verification: { strategy: 'tdd', detail: 'npm test -- target.test.ts' },
          }),
        ],
      });

      const program = buildCli();
      const lines: string[] = [];
      registerTaskStatusCommand(program, { root, write: (s) => lines.push(s) });
      await program.parseAsync(['node', 'pitway', 'task-status', 'T002', '--context', '--json']);

      const bundle = JSON.parse(lines.join('\n'));
      expect(bundle.contractExcerpt.acceptanceCriteria).toEqual(multiAcFrontmatter.acceptance_criteria);
    });
  });

  // AC003/T003: pre-dispatch context gate -- State (listInstalledSkillNames)
  // composed with Core (assertRequiredSkillsAvailable) before the bundle is
  // built.
  describe('required_skills pre-dispatch context gate (T003)', () => {
    function installSkill(name: string): void {
      mkdirSync(join(root, '.claude', 'skills', name), { recursive: true });
      writeFileSync(join(root, '.claude', 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n`);
    }

    it('succeeds unchanged when every required skill is installed', async () => {
      installSkill('debugging');
      installSkill('testing');
      saveTasks(root, 'M001', {
        schema_version: 1,
        tasks: [
          task({
            id: 'T002',
            status: 'in_progress',
            objective: 'Target task',
            relevant_files: ['src/target.ts'],
            required_skills: ['debugging', 'testing'],
          }),
        ],
      });

      const program = buildCli();
      const lines: string[] = [];
      registerTaskStatusCommand(program, { root, write: (s) => lines.push(s) });
      await program.parseAsync(['node', 'pitway', 'task-status', 'T002', '--context', '--json']);

      const bundle = JSON.parse(lines.join('\n'));
      expect(bundle.requiredSkills).toEqual(['debugging', 'testing']);
    });

    it('refuses, naming the one missing skill, when one required skill is not installed', async () => {
      installSkill('debugging');
      saveTasks(root, 'M001', {
        schema_version: 1,
        tasks: [
          task({
            id: 'T002',
            status: 'in_progress',
            objective: 'Target task',
            relevant_files: ['src/target.ts'],
            required_skills: ['debugging', 'testing'],
          }),
        ],
      });

      const program = buildCli();
      const lines: string[] = [];
      registerTaskStatusCommand(program, { root, write: (s) => lines.push(s) });
      await expect(
        program.parseAsync(['node', 'pitway', 'task-status', 'T002', '--context', '--json']),
      ).rejects.toThrow(/testing/);
      expect(lines.join('\n')).not.toContain('"task"');
    });

    it('refuses, naming both missing skills, when two required skills are not installed', async () => {
      saveTasks(root, 'M001', {
        schema_version: 1,
        tasks: [
          task({
            id: 'T002',
            status: 'in_progress',
            objective: 'Target task',
            relevant_files: ['src/target.ts'],
            required_skills: ['debugging', 'testing'],
          }),
        ],
      });

      const program = buildCli();
      const lines: string[] = [];
      registerTaskStatusCommand(program, { root, write: (s) => lines.push(s) });
      let caught: Error | undefined;
      try {
        await program.parseAsync(['node', 'pitway', 'task-status', 'T002', '--context', '--json']);
      } catch (error) {
        caught = error as Error;
      }
      expect(caught?.message).toMatch(/debugging/);
      expect(caught?.message).toMatch(/testing/);
    });

    it('is a complete no-op through this whole path when the task has no required_skills', async () => {
      saveTasks(root, 'M001', {
        schema_version: 1,
        tasks: [
          task({
            id: 'T002',
            status: 'in_progress',
            objective: 'Target task',
            relevant_files: ['src/target.ts'],
          }),
        ],
      });

      const program = buildCli();
      const lines: string[] = [];
      registerTaskStatusCommand(program, { root, write: (s) => lines.push(s) });
      await program.parseAsync(['node', 'pitway', 'task-status', 'T002', '--context', '--json']);

      const bundle = JSON.parse(lines.join('\n'));
      expect(bundle.requiredSkills).toBeUndefined();
      expect('requiredSkills' in bundle).toBe(false);
    });
  });
});
