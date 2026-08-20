import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  configSchema,
  contractFrontmatterSchema,
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
