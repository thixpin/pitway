import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  backlogFileSchema,
  backlogItemSchema,
  configSchema,
  resolveExecutionStrategy,
  contractFrontmatterSchema,
  resolveBranchStrategy,
  reviewFindingsSnapshotSchema,
  reviewsFileSchema,
  stateSchema,
  taskSchema,
  tasksFileSchema,
  usageFileSchema,
  verificationResultsSchema,
  type Task,
} from '../../src/state/schemas.js';
import { buildTaskContextBundle } from '../../src/core/tasks/context-bundle.js';

const fixture = (name: string): unknown =>
  parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

const cases = [
  {
    artifact: 'config',
    schema: configSchema,
    valid: 'valid/config.yaml',
    invalid: 'invalid/config-bad-version.yaml',
    offendingField: 'schema_version',
  },
  {
    artifact: 'state',
    schema: stateSchema,
    valid: 'valid/state.yaml',
    invalid: 'invalid/state-bad-milestone-id.yaml',
    offendingField: 'milestones',
  },
  {
    artifact: 'contract frontmatter',
    schema: contractFrontmatterSchema,
    valid: 'valid/contract-frontmatter.yaml',
    invalid: 'invalid/contract-bad-status.yaml',
    offendingField: 'status',
  },
  {
    artifact: 'tasks',
    schema: tasksFileSchema,
    valid: 'valid/tasks.yaml',
    invalid: 'invalid/tasks-bad-status.yaml',
    offendingField: 'status',
  },
  {
    artifact: 'verification results',
    schema: verificationResultsSchema,
    valid: 'valid/verification-results.yaml',
    invalid: 'invalid/verification-results-bad-status.yaml',
    offendingField: 'status',
  },
  {
    artifact: 'usage',
    schema: usageFileSchema,
    valid: 'valid/usage.yaml',
    invalid: 'invalid/usage-negative-tokens.yaml',
    offendingField: 'total_tokens',
  },
] as const;

describe.each(cases)('$artifact schema', ({ schema, valid, invalid, offendingField }) => {
  it('accepts a valid fixture', () => {
    expect(() => schema.parse(fixture(valid))).not.toThrow();
  });

  it('rejects an invalid fixture with an error naming the offending field', () => {
    const result = schema.safeParse(fixture(invalid));
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path);
      expect(paths.some((path) => path.includes(offendingField))).toBe(true);
    }
  });

  it('rejects an unknown schema_version', () => {
    const data = fixture(valid) as Record<string, unknown>;
    const result = schema.safeParse({ ...data, schema_version: 2 });
    expect(result.success).toBe(false);
  });

  it('rejects unknown top-level keys', () => {
    const data = fixture(valid) as Record<string, unknown>;
    const result = schema.safeParse({ ...data, unexpected_key: true });
    expect(result.success).toBe(false);
  });
});

// AC001/T001 (M012): config.yaml's first real (non-schema_version) field --
// additive-optional, absent resolves to 'main', byte-identical to today.
describe('config schema git.branch_strategy (M012/T001)', () => {
  it('resolves a bare, pre-existing config.yaml (no git key at all) to main', () => {
    const bare = fixture('valid/config.yaml') as Record<string, unknown>;
    const parsed = configSchema.parse(bare);
    expect(resolveBranchStrategy(parsed)).toBe('main');
  });

  it('round-trips git.branch_strategy: milestone through parse', () => {
    const parsed = configSchema.parse({ schema_version: 1, git: { branch_strategy: 'milestone' } });
    expect(resolveBranchStrategy(parsed)).toBe('milestone');
  });

  it('round-trips git.branch_strategy: main explicitly', () => {
    const parsed = configSchema.parse({ schema_version: 1, git: { branch_strategy: 'main' } });
    expect(resolveBranchStrategy(parsed)).toBe('main');
  });

  it('rejects an unrecognized branch_strategy value', () => {
    const result = configSchema.safeParse({
      schema_version: 1,
      git: { branch_strategy: 'feature' },
    });
    expect(result.success).toBe(false);
  });
});

// AC001/T001 (M014): additive-optional execution block -- absent resolves to
// 'sequential', byte-identical to today; mirrors git.branch_strategy exactly.
describe('config schema execution.strategy (M014/T001)', () => {
  it('resolves a bare, pre-existing config.yaml (no execution key at all) to sequential', () => {
    const bare = fixture('valid/config.yaml') as Record<string, unknown>;
    const parsed = configSchema.parse(bare);
    expect(resolveExecutionStrategy(parsed)).toBe('sequential');
  });

  it('round-trips execution.strategy: parallel_worktrees through parse', () => {
    const parsed = configSchema.parse({
      schema_version: 1,
      execution: { strategy: 'parallel_worktrees' },
    });
    expect(resolveExecutionStrategy(parsed)).toBe('parallel_worktrees');
  });

  it('round-trips execution.strategy: sequential explicitly', () => {
    const parsed = configSchema.parse({
      schema_version: 1,
      execution: { strategy: 'sequential' },
    });
    expect(resolveExecutionStrategy(parsed)).toBe('sequential');
  });

  it('rejects an unrecognized execution.strategy value', () => {
    const result = configSchema.safeParse({
      schema_version: 1,
      execution: { strategy: 'threads' },
    });
    expect(result.success).toBe(false);
  });

  it('accepts execution alongside git without interference', () => {
    const parsed = configSchema.parse({
      schema_version: 1,
      git: { branch_strategy: 'milestone' },
      execution: { strategy: 'parallel_worktrees' },
    });
    expect(resolveBranchStrategy(parsed)).toBe('milestone');
    expect(resolveExecutionStrategy(parsed)).toBe('parallel_worktrees');
  });
});

// AC019: task-side schema split — attempts is an optional task-level field
// independent of usage; task usage carries only token counts; the shared
// milestone-level usage schema (planning/qa) is unchanged.
describe('task schema attempts/usage split', () => {
  const validTask = (): Record<string, unknown> => {
    const file = fixture('valid/tasks.yaml') as { tasks: Record<string, unknown>[] };
    return file.tasks[0]!;
  };

  it('accepts a task-level attempts counter alongside usage without attempts', () => {
    const task = validTask();
    expect(task['attempts']).toBe(2);
    expect(taskSchema.safeParse(task).success).toBe(true);
  });

  it('accepts an existing task record without attempts unedited', () => {
    const { attempts: _attempts, ...withoutAttempts } = validTask();
    expect(taskSchema.safeParse(withoutAttempts).success).toBe(true);
  });

  it('rejects negative and fractional attempts', () => {
    expect(taskSchema.safeParse({ ...validTask(), attempts: -1 }).success).toBe(false);
    expect(taskSchema.safeParse({ ...validTask(), attempts: 1.5 }).success).toBe(false);
  });

  it('rejects attempts inside task usage', () => {
    const task = { ...validTask(), usage: { attempts: 1, total_tokens: 10 } };
    expect(taskSchema.safeParse(task).success).toBe(false);
  });

  it('keeps attempts required in milestone-level planning/qa usage', () => {
    const file = fixture('valid/usage.yaml') as { planning: Record<string, unknown> };
    const { attempts: _attempts, ...planning } = file.planning;
    expect(usageFileSchema.safeParse({ ...file, planning }).success).toBe(false);
    expect(usageFileSchema.safeParse(file).success).toBe(true);
  });
});

describe('verification check variants', () => {
  it('requires command for command checks and instruction for manual/review checks', () => {
    const contract = fixture('valid/contract-frontmatter.yaml') as {
      verification: Array<Record<string, unknown>>;
    };
    const broken = {
      ...contract,
      verification: [{ id: 'CT001', criterion: 'AC001', type: 'command', instruction: 'oops' }],
    };
    expect(contractFrontmatterSchema.safeParse(broken).success).toBe(false);
  });
});

// T002/AC002: timeout_ms is additive-optional and command-only.
describe('verification check timeout_ms (T002)', () => {
  const contract = (): { verification: Array<Record<string, unknown>> } =>
    fixture('valid/contract-frontmatter.yaml') as {
      verification: Array<Record<string, unknown>>;
    };

  const withCommandCheck = (overrides: Record<string, unknown>): unknown => {
    const base = contract();
    return {
      ...base,
      verification: [{ ...base.verification[0], ...overrides }, ...base.verification.slice(1)],
    };
  };

  it('accepts a command check without timeout_ms (the omitted-default case)', () => {
    const result = contractFrontmatterSchema.safeParse(contract());
    expect(result.success).toBe(true);
  });

  it('accepts timeout_ms at the minimum bound (1)', () => {
    const result = contractFrontmatterSchema.safeParse(withCommandCheck({ timeout_ms: 1 }));
    expect(result.success).toBe(true);
  });

  it('accepts timeout_ms at the maximum bound (3,600,000 -- one hour)', () => {
    const result = contractFrontmatterSchema.safeParse(withCommandCheck({ timeout_ms: 3_600_000 }));
    expect(result.success).toBe(true);
  });

  it('rejects timeout_ms below the minimum bound (0)', () => {
    const result = contractFrontmatterSchema.safeParse(withCommandCheck({ timeout_ms: 0 }));
    expect(result.success).toBe(false);
  });

  it('rejects timeout_ms above the maximum bound (3,600,001)', () => {
    const result = contractFrontmatterSchema.safeParse(withCommandCheck({ timeout_ms: 3_600_001 }));
    expect(result.success).toBe(false);
  });

  it('rejects a non-integer timeout_ms', () => {
    const result = contractFrontmatterSchema.safeParse(withCommandCheck({ timeout_ms: 1000.5 }));
    expect(result.success).toBe(false);
  });

  it('rejects timeout_ms on a manual check (strictObject discrimination, no new code)', () => {
    const base = contract();
    const broken = {
      ...base,
      verification: [
        base.verification[0],
        { ...base.verification[1], timeout_ms: 5000 },
        base.verification[2],
      ],
    };
    const result = contractFrontmatterSchema.safeParse(broken);
    expect(result.success).toBe(false);
  });

  it('rejects timeout_ms on a review check (strictObject discrimination, no new code)', () => {
    const base = contract();
    const broken = {
      ...base,
      verification: [
        base.verification[0],
        base.verification[1],
        { ...base.verification[2], timeout_ms: 5000 },
      ],
    };
    const result = contractFrontmatterSchema.safeParse(broken);
    expect(result.success).toBe(false);
  });
});

// T002/AC008: verificationResultsSchema's duration_ms/termination_reason are
// additive-optional; every pre-existing fixture/history entry without them
// keeps validating unchanged (covered by the fixture-driven cases above).
describe('verification results duration_ms/termination_reason (T002)', () => {
  const validEntry = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    check: 'CT001',
    status: 'pass',
    at: '2026-08-18T09:00:00Z',
    evidence: 'ok',
    recorded_by: 'command',
    ...overrides,
  });

  it('accepts a result entry without duration_ms/termination_reason (pre-existing shape)', () => {
    const result = verificationResultsSchema.safeParse({
      schema_version: 1,
      results: [validEntry()],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a result entry with duration_ms and termination_reason', () => {
    const result = verificationResultsSchema.safeParse({
      schema_version: 1,
      results: [validEntry({ duration_ms: 42, termination_reason: 'exited' })],
    });
    expect(result.success).toBe(true);
  });

  it.each(['exited', 'timeout', 'signal', 'spawn_error'])(
    'accepts termination_reason %s',
    (termination_reason) => {
      const result = verificationResultsSchema.safeParse({
        schema_version: 1,
        results: [validEntry({ duration_ms: 1, termination_reason })],
      });
      expect(result.success).toBe(true);
    },
  );

  it('rejects an unknown termination_reason value', () => {
    const result = verificationResultsSchema.safeParse({
      schema_version: 1,
      results: [validEntry({ duration_ms: 1, termination_reason: 'bogus' })],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a negative duration_ms', () => {
    const result = verificationResultsSchema.safeParse({
      schema_version: 1,
      results: [validEntry({ duration_ms: -1, termination_reason: 'exited' })],
    });
    expect(result.success).toBe(false);
  });
});

// M005 T003: relevant_files and the new context_files/write_scope fields are
// both schema-optional, but every task must declare exactly one style — see
// the five-case combination rule in the task contract.
describe('task relevant_files / context_files / write_scope combinations', () => {
  const baseTask = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'T001',
    objective: 'Do a thing.',
    status: 'waiting',
    depends_on: [],
    acceptance_criteria: ['It works'],
    verification: { strategy: 'tdd', detail: 'npm test' },
    result: null,
    usage: null,
    ...overrides,
  });

  it('case 1: relevant_files only is valid (legacy, unchanged)', () => {
    const task = baseTask({ relevant_files: ['src/a.ts'] });
    const result = taskSchema.safeParse(task);
    expect(result.success).toBe(true);
  });

  it('a real M001-M004-shaped relevant_files-only task still parses fine', () => {
    const file = fixture('valid/tasks.yaml') as { tasks: Record<string, unknown>[] };
    for (const task of file.tasks) {
      expect(taskSchema.safeParse(task).success).toBe(true);
    }
  });

  it('case 2: write_scope only is valid (unrestricted reads, write_scope is the write boundary)', () => {
    const task = baseTask({ write_scope: ['src/a.ts'] });
    const result = taskSchema.safeParse(task);
    expect(result.success).toBe(true);
  });

  it('case 3: context_files + write_scope is valid when write_scope is a subset of context_files', () => {
    const task = baseTask({
      context_files: ['src/a.ts', 'src/b.ts'],
      write_scope: ['src/a.ts'],
    });
    const result = taskSchema.safeParse(task);
    expect(result.success).toBe(true);
  });

  it('case 3: rejects a write_scope path missing from context_files, naming it', () => {
    const task = baseTask({
      context_files: ['src/a.ts'],
      write_scope: ['src/a.ts', 'src/c.ts'],
    });
    const result = taskSchema.safeParse(task);
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues.map((i) => i.message).join('; ');
      expect(message).toContain('src/c.ts');
      expect(message).not.toContain('src/a.ts:');
    }
  });

  it('case 4: context_files alone is rejected as incomplete (write boundary undefined)', () => {
    const task = baseTask({ context_files: ['src/a.ts'] });
    const result = taskSchema.safeParse(task);
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues.map((i) => i.message).join('; ');
      expect(message.toLowerCase()).toContain('write_scope');
    }
  });

  it('case 5: relevant_files with context_files is rejected as ambiguous, naming both fields', () => {
    const task = baseTask({ relevant_files: ['src/a.ts'], context_files: ['src/a.ts'] });
    const result = taskSchema.safeParse(task);
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues.map((i) => i.message).join('; ');
      expect(message).toContain('relevant_files');
      expect(message).toContain('context_files');
    }
  });

  it('case 5: relevant_files with write_scope is rejected as ambiguous, naming both fields', () => {
    const task = baseTask({ relevant_files: ['src/a.ts'], write_scope: ['src/a.ts'] });
    const result = taskSchema.safeParse(task);
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues.map((i) => i.message).join('; ');
      expect(message).toContain('relevant_files');
      expect(message).toContain('write_scope');
    }
  });

  it('case 5: relevant_files with both context_files and write_scope is rejected as ambiguous', () => {
    const task = baseTask({
      relevant_files: ['src/a.ts'],
      context_files: ['src/a.ts'],
      write_scope: ['src/a.ts'],
    });
    const result = taskSchema.safeParse(task);
    expect(result.success).toBe(false);
  });

  it('case 6: none of relevant_files/context_files/write_scope set is rejected', () => {
    const task = baseTask();
    const result = taskSchema.safeParse(task);
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues.map((i) => i.message).join('; ');
      expect(message).toContain('relevant_files');
      expect(message).toContain('write_scope');
    }
  });
});

// AC011/T010: mapped_ac_ids is a new, additive-optional string array field,
// absent from every M001-M006 historical task.
describe('task schema mapped_ac_ids (T010)', () => {
  const baseTask = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'T001',
    objective: 'Do a thing.',
    status: 'waiting',
    depends_on: [],
    acceptance_criteria: ['It works'],
    write_scope: ['src/a.ts'],
    verification: { strategy: 'tdd', detail: 'npm test' },
    result: null,
    usage: null,
    ...overrides,
  });

  it('accepts mapped_ac_ids as an optional string array', () => {
    const task = baseTask({ mapped_ac_ids: ['AC001', 'AC002'] });
    const result = taskSchema.safeParse(task);
    expect(result.success).toBe(true);
  });

  it('accepts a task without mapped_ac_ids exactly as before (still valid)', () => {
    const task = baseTask();
    expect('mapped_ac_ids' in task).toBe(false);
    const result = taskSchema.safeParse(task);
    expect(result.success).toBe(true);
  });

  it('rejects a mapped_ac_ids entry that is an empty string', () => {
    const task = baseTask({ mapped_ac_ids: [''] });
    const result = taskSchema.safeParse(task);
    expect(result.success).toBe(false);
  });

  it('every M001-M004-shaped historical task (no mapped_ac_ids) still parses fine', () => {
    const file = fixture('valid/tasks.yaml') as { tasks: Record<string, unknown>[] };
    for (const task of file.tasks) {
      expect('mapped_ac_ids' in task).toBe(false);
      expect(taskSchema.safeParse(task).success).toBe(true);
    }
  });
});

// AC003/T003: required_skills is a new, additive-optional string array
// field, absent from every M001-M010 historical task, fully independent of
// the relevant_files/context_files/write_scope superRefine.
describe('task schema required_skills (T003)', () => {
  const baseTask = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'T001',
    objective: 'Do a thing.',
    status: 'waiting',
    depends_on: [],
    acceptance_criteria: ['It works'],
    write_scope: ['src/a.ts'],
    verification: { strategy: 'tdd', detail: 'npm test' },
    result: null,
    usage: null,
    ...overrides,
  });

  it('accepts 0, 1, or 2 valid kebab-case required_skills, round-tripping unchanged', () => {
    for (const skills of [[], ['debugging'], ['debugging', 'code-quality-review']]) {
      const task = baseTask({ required_skills: skills });
      const result = taskSchema.safeParse(task);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.required_skills).toEqual(skills);
    }
  });

  it('accepts a task without required_skills exactly as before (still valid)', () => {
    const task = baseTask();
    expect('required_skills' in task).toBe(false);
    const result = taskSchema.safeParse(task);
    expect(result.success).toBe(true);
  });

  it('rejects 3 or more required_skills entries', () => {
    const task = baseTask({ required_skills: ['debugging', 'testing', 'bug-fix'] });
    expect(taskSchema.safeParse(task).success).toBe(false);
  });

  it('rejects a non-kebab-case entry', () => {
    for (const bad of ['Debugging', 'code_quality_review', 'bad-', '-bad', '']) {
      const task = baseTask({ required_skills: [bad] });
      expect(taskSchema.safeParse(task).success).toBe(false);
    }
  });

  it('rejects a duplicate name within one task\'s own list, naming it', () => {
    const task = baseTask({ required_skills: ['debugging', 'debugging'] });
    const result = taskSchema.safeParse(task);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes('debugging'))).toBe(true);
    }
  });

  it('required_skills does not interact with the relevant_files/context_files/write_scope rule', () => {
    // A relevant_files-only task with required_skills must validate on its
    // own scope rule alone, unaffected by required_skills' own checks.
    const task = baseTask({ write_scope: undefined, relevant_files: ['src/a.ts'], required_skills: ['debugging'] });
    expect(taskSchema.safeParse(task).success).toBe(true);
  });

  it('every M001-M010-shaped historical task (no required_skills) still parses fine', () => {
    const file = fixture('valid/tasks.yaml') as { tasks: Record<string, unknown>[] };
    for (const task of file.tasks) {
      expect('required_skills' in task).toBe(false);
      expect(taskSchema.safeParse(task).success).toBe(true);
    }
  });
});

// AC001/T002 (M013): name is a new, additive-optional short-label field,
// absent from every M001-M012 historical task.
describe('task schema name (M013/T002)', () => {
  const baseTask = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'T001',
    objective: 'Do a thing.',
    status: 'waiting',
    depends_on: [],
    acceptance_criteria: ['It works'],
    write_scope: ['src/a.ts'],
    verification: { strategy: 'tdd', detail: 'npm test' },
    result: null,
    usage: null,
    ...overrides,
  });

  it('round-trips a task with name set, unchanged', () => {
    const task = baseTask({ name: 'Config schema for branch_strategy' });
    const result = taskSchema.safeParse(task);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe('Config schema for branch_strategy');
  });

  it('accepts a task without name exactly as before (still valid)', () => {
    const task = baseTask();
    expect('name' in task).toBe(false);
    const result = taskSchema.safeParse(task);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBeUndefined();
  });

  it('rejects an empty-string name', () => {
    const task = baseTask({ name: '' });
    expect(taskSchema.safeParse(task).success).toBe(false);
  });

  it('rejects a name longer than 80 characters', () => {
    const task = baseTask({ name: 'x'.repeat(81) });
    expect(taskSchema.safeParse(task).success).toBe(false);
  });

  it('accepts a name at exactly 80 characters', () => {
    const task = baseTask({ name: 'x'.repeat(80) });
    expect(taskSchema.safeParse(task).success).toBe(true);
  });

  it('every M001-M012-shaped historical task (no name) still parses unchanged', () => {
    const file = fixture('valid/tasks.yaml') as { tasks: Record<string, unknown>[] };
    for (const task of file.tasks) {
      expect('name' in task).toBe(false);
      expect(taskSchema.safeParse(task).success).toBe(true);
    }
  });
});

describe('buildTaskContextBundle context_files/write_scope surfacing', () => {
  const contract = fixture('valid/contract-frontmatter.yaml') as Parameters<
    typeof buildTaskContextBundle
  >[0];

  const baseTask = (overrides: Record<string, unknown>): Task =>
    ({
      id: 'T001',
      objective: 'Target task',
      status: 'waiting',
      depends_on: [],
      acceptance_criteria: ['Target AC'],
      verification: { strategy: 'tdd', detail: 'npm test' },
      result: null,
      usage: null,
      ...overrides,
    }) as Task;

  it('keeps legacy relevant_files-only bundles unchanged (no contextFiles/writeScope keys)', () => {
    const task = baseTask({ relevant_files: ['src/target.ts'] });
    const bundle = buildTaskContextBundle(contract, [task], 'T001');
    expect(bundle.relevantFiles).toEqual(['src/target.ts']);
    expect(bundle.contextFiles).toBeUndefined();
    expect(bundle.writeScope).toBeUndefined();
    // JSON round-trip: undefined-valued keys must not leak into serialized output.
    const serialized = JSON.parse(JSON.stringify(bundle));
    expect(Object.keys(serialized).sort()).toEqual([
      'acceptanceCriteria',
      'contractExcerpt',
      'dependencyResults',
      'relevantFiles',
      'task',
      'verificationInstructions',
    ]);
  });

  it('surfaces write_scope for a write_scope-only task, with no relevantFiles key', () => {
    const task = baseTask({ write_scope: ['src/target.ts'] });
    const bundle = buildTaskContextBundle(contract, [task], 'T001');
    expect(bundle.writeScope).toEqual(['src/target.ts']);
    expect(bundle.relevantFiles).toBeUndefined();
    expect(bundle.contextFiles).toBeUndefined();
  });

  it('surfaces both context_files and write_scope for a bounded-both-ways task', () => {
    const task = baseTask({
      context_files: ['src/target.ts', 'src/other.ts'],
      write_scope: ['src/target.ts'],
    });
    const bundle = buildTaskContextBundle(contract, [task], 'T001');
    expect(bundle.contextFiles).toEqual(['src/target.ts', 'src/other.ts']);
    expect(bundle.writeScope).toEqual(['src/target.ts']);
    expect(bundle.relevantFiles).toBeUndefined();
  });

  // AC003/T003: requiredSkills passes through verbatim, and is omitted
  // (undefined, not an empty array) when the task has none -- the same
  // omission convention as writeScope/contextFiles above.
  it('passes required_skills through verbatim as requiredSkills', () => {
    const task = baseTask({ write_scope: ['src/target.ts'], required_skills: ['debugging', 'testing'] });
    const bundle = buildTaskContextBundle(contract, [task], 'T001');
    expect(bundle.requiredSkills).toEqual(['debugging', 'testing']);
  });

  it('omits requiredSkills entirely when the task has no required_skills', () => {
    const task = baseTask({ write_scope: ['src/target.ts'] });
    const bundle = buildTaskContextBundle(contract, [task], 'T001');
    expect(bundle.requiredSkills).toBeUndefined();
    const serialized = JSON.parse(JSON.stringify(bundle));
    expect('requiredSkills' in serialized).toBe(false);
  });
});

describe('backlog item schema (M018/T001)', () => {
  const baseItem = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'B001',
    title: 'Handle stale evidence',
    reason: 'Discovered while implementing T003; unrelated to that scope.',
    status: 'pending',
    source: { milestone: null, task: null },
    created_at: '2026-08-21T09:00:00Z',
    resolved_at: null,
    promoted_to: null,
    archived_reason: null,
    ...overrides,
  });

  it('accepts a minimal pending item with no source', () => {
    expect(backlogItemSchema.safeParse(baseItem()).success).toBe(true);
  });

  it('accepts a pending item with source.milestone and source.task set', () => {
    const item = baseItem({ source: { milestone: 'M018', task: 'T003' } });
    expect(backlogItemSchema.safeParse(item).success).toBe(true);
  });

  it('rejects an id that does not match B000', () => {
    const result = backlogItemSchema.safeParse(baseItem({ id: 'B1' }));
    expect(result.success).toBe(false);
  });

  it('rejects source.task set without source.milestone', () => {
    const result = backlogItemSchema.safeParse(baseItem({ source: { milestone: null, task: 'T003' } }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.message).join('; ')).toContain('source.milestone');
    }
  });

  it('accepts a promoted item with resolved_at and promoted_to set', () => {
    const item = baseItem({
      status: 'promoted',
      resolved_at: '2026-08-21T10:00:00Z',
      promoted_to: { milestone: 'M019', task: 'T001' },
    });
    expect(backlogItemSchema.safeParse(item).success).toBe(true);
  });

  it('rejects a promoted item missing promoted_to', () => {
    const item = baseItem({ status: 'promoted', resolved_at: '2026-08-21T10:00:00Z' });
    expect(backlogItemSchema.safeParse(item).success).toBe(false);
  });

  it('rejects promoted_to.task set without promoted_to.milestone', () => {
    const item = baseItem({
      status: 'promoted',
      resolved_at: '2026-08-21T10:00:00Z',
      promoted_to: { milestone: null, task: 'T001' },
    });
    const result = backlogItemSchema.safeParse(item);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.message).join('; ')).toContain('promoted_to.milestone');
    }
  });

  it('accepts an archived item with resolved_at and archived_reason set', () => {
    const item = baseItem({
      status: 'archived',
      resolved_at: '2026-08-21T10:00:00Z',
      archived_reason: 'No longer relevant.',
    });
    expect(backlogItemSchema.safeParse(item).success).toBe(true);
  });

  it('rejects an archived item missing archived_reason', () => {
    const item = baseItem({ status: 'archived', resolved_at: '2026-08-21T10:00:00Z' });
    expect(backlogItemSchema.safeParse(item).success).toBe(false);
  });

  it('rejects a pending item that already carries promoted_to', () => {
    const item = baseItem({ promoted_to: { milestone: 'M019', task: null } });
    expect(backlogItemSchema.safeParse(item).success).toBe(false);
  });

  it('rejects an unknown extra field (strictObject)', () => {
    const item = baseItem({ priority: 'high' });
    expect(backlogItemSchema.safeParse(item).success).toBe(false);
  });

  it('backlogFileSchema accepts an empty items array', () => {
    expect(backlogFileSchema.safeParse({ schema_version: 1, items: [] }).success).toBe(true);
  });
});

// M021/AC001 (B006): reviewFindingsSnapshotSchema gains a nullable `usage`
// field reusing taskUsageSchema verbatim -- additive-optional, so every
// reviews.yaml written before this milestone (no `usage` key at all) still
// parses unchanged.
describe('reviewFindingsSnapshotSchema usage field (M021/AC001)', () => {
  const baseSnapshot = {
    role: 'developer',
    recorded_at: '2026-08-21T00:00:00Z',
    findings: [],
  };

  it('accepts a snapshot with no usage key at all -- the pre-existing shape', () => {
    const result = reviewFindingsSnapshotSchema.safeParse(baseSnapshot);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.usage).toBeUndefined();
    }
  });

  it('accepts a snapshot with usage explicitly null', () => {
    const result = reviewFindingsSnapshotSchema.safeParse({ ...baseSnapshot, usage: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.usage).toBeNull();
    }
  });

  it('accepts a snapshot with a well-formed measured usage object', () => {
    const usage = { input_tokens: 100, output_tokens: 50, total_tokens: 150 };
    const result = reviewFindingsSnapshotSchema.safeParse({ ...baseSnapshot, usage });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.usage).toEqual(usage);
    }
  });

  it('rejects a malformed usage object, naming the offending field', () => {
    const result = reviewFindingsSnapshotSchema.safeParse({
      ...baseSnapshot,
      usage: { total_tokens: -5 },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path);
      expect(paths.some((path) => path.includes('total_tokens'))).toBe(true);
    }
  });

  it('rejects an unknown extra field inside usage (strictObject, reused verbatim)', () => {
    const result = reviewFindingsSnapshotSchema.safeParse({
      ...baseSnapshot,
      usage: { total_tokens: 10, cost_usd: 0.05 },
    });
    expect(result.success).toBe(false);
  });

  it('reviewsFileSchema round-trips a session whose findings snapshots predate this field', () => {
    const legacyFile = {
      schema_version: 1,
      sessions: [
        {
          id: 'rev-1eaac1e5',
          status: 'decided',
          created_at: '2026-08-20T00:00:00Z',
          roles: ['developer'],
          content_hash: 'sha256:' + 'a'.repeat(64),
          findings: [
            {
              role: 'developer',
              recorded_at: '2026-08-20T01:00:00Z',
              findings: [],
              // no `usage` key -- exactly what every reviews.yaml written
              // before this milestone looks like on disk.
            },
          ],
          decision: null,
        },
      ],
    };
    const result = reviewsFileSchema.safeParse(legacyFile);
    expect(result.success).toBe(true);
  });
});

// M045/T001 (W1): additive optional task-level verification timeout.
describe('task verification.timeout_ms (M045/T001)', () => {
  it('accepts a declared timeout within the contract-check bounds and rejects out-of-range values', () => {
    const base = {
      schema_version: 1,
      tasks: [
        {
          id: 'T001',
          objective: 'x',
          status: 'planned',
          depends_on: [],
          acceptance_criteria: ['x'],
          relevant_files: ['a.ts'],
          verification: { strategy: 'command', detail: 'npm test', timeout_ms: 600000 },
          result: null,
          usage: null,
        },
      ],
    };
    expect(tasksFileSchema.safeParse(base).success).toBe(true);
    const tooBig = structuredClone(base);
    (tooBig.tasks[0] as { verification: { timeout_ms: number } }).verification.timeout_ms = 3_600_001;
    expect(tasksFileSchema.safeParse(tooBig).success).toBe(false);
  });
});

// M047/T001 (AC001, AC005): additive-optional, append-only usage readings
// keyed by M040 Decision 3's buckets -- exactly the fields the M042 synthesis
// (section 9) allows, strict against everything it forbids.
describe('usage.yaml readings (M047/T001)', () => {
  const base = { schema_version: 1, planning: null, qa: null };
  const reading = {
    bucket: 'orchestrator',
    count: 72821,
    semantics: 'undetermined',
    recorded_at: '2026-08-29T00:00:00Z',
  };

  it('parses an existing usage.yaml with no readings key unchanged', () => {
    const parsed = usageFileSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    expect(parsed.success && 'readings' in parsed.data).toBe(false);
  });

  it('accepts a required-only reading and every optional field present or null-free absent', () => {
    expect(usageFileSchema.safeParse({ ...base, readings: [reading] }).success).toBe(true);
    const full = {
      ...reading,
      bucket: 'worker',
      semantics: 'per-turn',
      dimensions: { input: 308, output: 65, reasoning: 21, cache_read: 8561, cache_write: 0 },
      model: 'muse-spark-1.2-contributor-free',
      provider: 'opencode',
      instance_id: 'ses_fb68f099affewgwx9iHa60K1ef',
      raw: { total: 8955, input: 308, output: 65, reasoning: 21, cache: { write: 0, read: 8561 } },
    };
    expect(usageFileSchema.safeParse({ ...base, readings: [full] }).success).toBe(true);
    expect(usageFileSchema.safeParse({ ...base, readings: [{ ...reading, raw: '<usage><subagent_tokens>30201</subagent_tokens></usage>' }] }).success).toBe(true);
  });

  it('rejects any total or percentage field on a reading (section 9 must-not)', () => {
    for (const extra of [{ total_tokens: 1 }, { total: 1 }, { percent: 50 }, { percentage: 50 }]) {
      expect(usageFileSchema.safeParse({ ...base, readings: [{ ...reading, ...extra }] }).success).toBe(false);
    }
  });

  it('rejects an unknown bucket or semantics, a negative or non-integer count, and a missing required field', () => {
    expect(usageFileSchema.safeParse({ ...base, readings: [{ ...reading, bucket: 'agent' }] }).success).toBe(false);
    expect(usageFileSchema.safeParse({ ...base, readings: [{ ...reading, semantics: 'cumulative' }] }).success).toBe(false);
    expect(usageFileSchema.safeParse({ ...base, readings: [{ ...reading, count: -1 }] }).success).toBe(false);
    expect(usageFileSchema.safeParse({ ...base, readings: [{ ...reading, count: 1.5 }] }).success).toBe(false);
    const { semantics: _s, ...noSemantics } = reading;
    expect(usageFileSchema.safeParse({ ...base, readings: [noSemantics] }).success).toBe(false);
  });

  it('stores two readings as two entries -- never one summed value', () => {
    const parsed = usageFileSchema.safeParse({ ...base, readings: [reading, { ...reading, count: 94451 }] });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.readings).toHaveLength(2);
      expect(parsed.data.readings!.map((r) => r.count)).toEqual([72821, 94451]);
    }
  });
});
