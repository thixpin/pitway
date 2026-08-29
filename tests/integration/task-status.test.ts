import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadTasks, saveContract, saveState, saveTasks } from '../../src/state/store.js';
import { buildCli } from '../../src/cli/index.js';
import { registerTaskStatusCommand } from '../../src/cli/commands/task-status.js';
import { buildTaskContextBundle } from '../../src/core/tasks/context-bundle.js';
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

  // M025/T006 (B009): multi-driver gate -- .opencode install satisfies gate
  describe('required_skills gate multi-driver (M025/T006)', () => {
    function installOpencodeSkill(name: string): void {
      mkdirSync(join(root, '.opencode', 'skills', name), { recursive: true });
      writeFileSync(join(root, '.opencode', 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n`);
    }

    it('succeeds when a required skill is installed under .opencode/skills/', async () => {
      installOpencodeSkill('debugging');
      saveTasks(root, 'M001', {
        schema_version: 1,
        tasks: [
          task({
            id: 'T002',
            status: 'in_progress',
            objective: 'Target task',
            relevant_files: ['src/target.ts'],
            required_skills: ['debugging'],
          }),
        ],
      });
      const program = buildCli();
      const lines: string[] = [];
      registerTaskStatusCommand(program, { root, write: (s) => lines.push(s) });
      await program.parseAsync(['node', 'pitway', 'task-status', 'T002', '--context', '--json']);
      const bundle = JSON.parse(lines.join('\n'));
      expect(bundle.requiredSkills).toEqual(['debugging']);
    });

    it('succeeds when skills are split across both driver directories', async () => {
      mkdirSync(join(root, '.claude', 'skills', 'debugging'), { recursive: true });
      writeFileSync(join(root, '.claude', 'skills', 'debugging', 'SKILL.md'), 'x');
      installOpencodeSkill('testing');
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

    it('refuses by name when a required skill is missing from both drivers', async () => {
      installOpencodeSkill('debugging');
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
    });

    it('does not count a .opencode directory without SKILL.md as installed', async () => {
      mkdirSync(join(root, '.opencode', 'skills', 'debugging'), { recursive: true });
      // no SKILL.md
      saveTasks(root, 'M001', {
        schema_version: 1,
        tasks: [
          task({
            id: 'T002',
            status: 'in_progress',
            objective: 'Target task',
            relevant_files: ['src/target.ts'],
            required_skills: ['debugging'],
          }),
        ],
      });
      const program = buildCli();
      registerTaskStatusCommand(program, { root, write: () => {} });
      await expect(
        program.parseAsync(['node', 'pitway', 'task-status', 'T002', '--context', '--json']),
      ).rejects.toThrow(/debugging/);
    });
  });

  // M033/T004: extend the multi-driver gate to a .codex-driven project --
  // resolution is already driver-symmetric, this pins the missing coverage.
  describe('required_skills gate against a codex-driven project (M033/T004)', () => {
    function installCodexSkill(name: string): void {
      mkdirSync(join(root, '.codex', 'skills', name), { recursive: true });
      writeFileSync(join(root, '.codex', 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n`);
    }

    it('succeeds when a required skill is installed under .codex/skills/', async () => {
      installCodexSkill('debugging');
      saveTasks(root, 'M001', {
        schema_version: 1,
        tasks: [
          task({
            id: 'T002',
            status: 'in_progress',
            objective: 'Target task',
            relevant_files: ['src/target.ts'],
            required_skills: ['debugging'],
          }),
        ],
      });
      const program = buildCli();
      const lines: string[] = [];
      registerTaskStatusCommand(program, { root, write: (s) => lines.push(s) });
      await program.parseAsync(['node', 'pitway', 'task-status', 'T002', '--context', '--json']);
      const bundle = JSON.parse(lines.join('\n'));
      expect(bundle.requiredSkills).toEqual(['debugging']);
    });

    it('succeeds when skills are split across .claude and .codex driver directories', async () => {
      mkdirSync(join(root, '.claude', 'skills', 'debugging'), { recursive: true });
      writeFileSync(join(root, '.claude', 'skills', 'debugging', 'SKILL.md'), 'x');
      installCodexSkill('testing');
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

    it('refuses by name when a required skill is missing from a codex-only project', async () => {
      installCodexSkill('debugging');
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
    });

    it('does not count a .codex directory without SKILL.md as installed', async () => {
      mkdirSync(join(root, '.codex', 'skills', 'debugging'), { recursive: true });
      // no SKILL.md
      saveTasks(root, 'M001', {
        schema_version: 1,
        tasks: [
          task({
            id: 'T002',
            status: 'in_progress',
            objective: 'Target task',
            relevant_files: ['src/target.ts'],
            required_skills: ['debugging'],
          }),
        ],
      });
      const program = buildCli();
      registerTaskStatusCommand(program, { root, write: () => {} });
      await expect(
        program.parseAsync(['node', 'pitway', 'task-status', 'T002', '--context', '--json']),
      ).rejects.toThrow(/debugging/);
    });
  });

  // AC002 (M013/T002): task name id-fallback, both human and --json.
  describe('task name rendering (M013/T002)', () => {
    it('renders a task with name set, in both human and --json output', async () => {
      saveTasks(root, 'M001', {
        schema_version: 1,
        tasks: [task({ id: 'T001', name: 'Config schema for branch_strategy', status: 'in_progress' })],
      });

      const jsonProgram = buildCli();
      const jsonLines: string[] = [];
      registerTaskStatusCommand(jsonProgram, { root, write: (s) => jsonLines.push(s) });
      await jsonProgram.parseAsync(['node', 'pitway', 'task-status', 'T001', '--json']);
      const view = JSON.parse(jsonLines.join('\n'));
      expect(view.name).toBe('Config schema for branch_strategy');

      const humanProgram = buildCli();
      const humanLines: string[] = [];
      registerTaskStatusCommand(humanProgram, { root, write: (s) => humanLines.push(s) });
      await humanProgram.parseAsync(['node', 'pitway', 'task-status', 'T001']);
      expect(humanLines.join('\n')).toContain('🛠 Task T001  Config schema for branch_strategy  ● In Progress');
    });

    it('falls back to the bare id, byte-identical to pre-M013 output, when name is absent', async () => {
      saveTasks(root, 'M001', {
        schema_version: 1,
        tasks: [task({ id: 'T001', status: 'in_progress' })],
      });

      const jsonProgram = buildCli();
      const jsonLines: string[] = [];
      registerTaskStatusCommand(jsonProgram, { root, write: (s) => jsonLines.push(s) });
      await jsonProgram.parseAsync(['node', 'pitway', 'task-status', 'T001', '--json']);
      const view = JSON.parse(jsonLines.join('\n'));
      expect(view.name).toBeNull();

      const humanProgram = buildCli();
      const humanLines: string[] = [];
      registerTaskStatusCommand(humanProgram, { root, write: (s) => humanLines.push(s) });
      await humanProgram.parseAsync(['node', 'pitway', 'task-status', 'T001']);
      expect(humanLines.join('\n')).toContain('🛠 Task T001  ● In Progress');
    });
  });

  describe('human rendering of dependencies and result', () => {
    it('renders a joined dependency list and the result summary when both are present', async () => {
      const program = buildCli();
      const lines: string[] = [];
      registerTaskStatusCommand(program, { root, write: (s) => lines.push(s) });
      // T003 in the shared fixture has a recorded result; T002 depends on T001.
      await program.parseAsync(['node', 'pitway', 'task-status', 'T003']);
      const t3 = lines.join('\n');
      expect(t3).toContain('Result: UNRELATED_SIBLING_MARKER_RESULT');

      const program2 = buildCli();
      const lines2: string[] = [];
      registerTaskStatusCommand(program2, { root, write: (s) => lines2.push(s) });
      await program2.parseAsync(['node', 'pitway', 'task-status', 'T002']);
      const t2 = lines2.join('\n');
      expect(t2).toContain('Depends on: T001');
      expect(t2).toContain('Result: (none yet)');
    });
  });

  describe('refusals', () => {
    it('refuses an unknown task id', async () => {
      const program = buildCli();
      registerTaskStatusCommand(program, { root, write: () => {} });
      await expect(
        program.parseAsync(['node', 'pitway', 'task-status', 'T404', '--json']),
      ).rejects.toThrow(/task T404 not found/);
    });

    it('refuses when no milestone is active, pointing at milestone-add', async () => {
      saveState(root, { schema_version: 1, active_milestone: null, milestones: ['M001'] });
      const program = buildCli();
      registerTaskStatusCommand(program, { root, write: () => {} });
      await expect(
        program.parseAsync(['node', 'pitway', 'task-status', 'T001']),
      ).rejects.toThrow(/no active milestone; run milestone-add first/);
    });
  });

  describe('--context default output mode and CommandDeps fallbacks', () => {
    it('emits JSON for --context even without --json (options.json ?? true)', async () => {
      const program = buildCli();
      const lines: string[] = [];
      registerTaskStatusCommand(program, { root, write: (s) => lines.push(s) });
      await program.parseAsync(['node', 'pitway', 'task-status', 'T002', '--context']);
      const bundle = JSON.parse(lines.join('\n')) as { task: { id: string } };
      expect(bundle.task.id).toBe('T002');
    });

    it('falls back to console.log and process.cwd() when no deps are given', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const cwdBefore = process.cwd();
      process.chdir(root);
      let caught: unknown;
      let calls: unknown[][] = [];
      try {
        const program = buildCli();
        registerTaskStatusCommand(program);
        await program.parseAsync(['node', 'pitway', 'task-status', 'T001', '--json']);
      } catch (error) {
        caught = error;
      } finally {
        // vitest v4: mockRestore() clears recorded calls -- capture first.
        calls = logSpy.mock.calls;
        process.chdir(cwdBefore);
        logSpy.mockRestore();
      }

      expect(caught).toBeUndefined();
      expect(calls).toHaveLength(1);
      const view = JSON.parse(calls[0]![0] as string) as { id: string; status: string };
      expect(view).toMatchObject({ id: 'T001', status: 'completed' });
    });
  });

  describe('buildTaskContextBundle direct edge cases', () => {
    it('throws for an unknown task id', () => {
      expect(() => buildTaskContextBundle(frontmatter, [task({ id: 'T001', status: 'ready' })], 'T404')).toThrow(
        /task T404 not found/,
      );
    });

    it('reports a null summary for a dependency that has no recorded result yet', () => {
      const tasks = [
        task({ id: 'T001', status: 'in_progress' }),
        task({ id: 'T002', status: 'waiting', depends_on: ['T001'] }),
      ];
      const bundle = buildTaskContextBundle(frontmatter, tasks, 'T002');
      expect(bundle.dependencyResults).toEqual([{ id: 'T001', summary: null }]);
    });
  });
});

// M045/T005 (W5): task-status --json additively exposes the task's declared
// scope and verification definition -- the fields a task-amend needs --
// following --context's omission convention; human output is unchanged.
describe('pitway task-status --json scope and verification fields (M045/T005)', () => {
  async function jsonView(id: string): Promise<Record<string, unknown>> {
    const program = buildCli();
    const lines: string[] = [];
    registerTaskStatusCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'task-status', id, '--json']);
    return JSON.parse(lines.join('\n')) as Record<string, unknown>;
  }

  it('carries relevantFiles and verification for a legacy relevant_files task, omitting contextFiles/writeScope', async () => {
    const view = await jsonView('T002');
    expect(view.relevantFiles).toEqual(['src/target.ts']);
    expect('contextFiles' in view).toBe(false);
    expect('writeScope' in view).toBe(false);
    expect(view.verification).toEqual({ strategy: 'tdd', detail: 'npm test -- target.test.ts' });
    // Existing keys untouched.
    expect(view).toMatchObject({ id: 'T002', status: 'in_progress', dependsOn: ['T001'], driver: null, model: null });
  });

  it('carries contextFiles, writeScope, and verification.timeoutMs for a scoped task, omitting relevantFiles', async () => {
    const file = loadTasks(root, 'M001');
    file.tasks.push({
      ...task({ id: 'T004', status: 'planned' }),
      relevant_files: undefined,
      context_files: ['src/a.ts', 'src/b.ts'],
      write_scope: ['src/a.ts'],
      verification: { strategy: 'command', detail: 'npm test', timeout_ms: 600000 },
    });
    saveTasks(root, 'M001', file);
    const view = await jsonView('T004');
    expect(view.contextFiles).toEqual(['src/a.ts', 'src/b.ts']);
    expect(view.writeScope).toEqual(['src/a.ts']);
    expect('relevantFiles' in view).toBe(false);
    expect(view.verification).toEqual({ strategy: 'command', detail: 'npm test', timeoutMs: 600000 });
  });

  it('leaves human output byte-identical', async () => {
    const program = buildCli();
    const lines: string[] = [];
    registerTaskStatusCommand(program, { root, write: (s) => lines.push(s) });
    await program.parseAsync(['node', 'pitway', 'task-status', 'T002']);
    expect(lines.join('\n')).toBe('🛠 Task T002  ● In Progress\nDepends on: T001\nResult: (none yet)');
  });
});
