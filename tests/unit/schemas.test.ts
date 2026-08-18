import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  configSchema,
  contractFrontmatterSchema,
  stateSchema,
  tasksFileSchema,
  usageFileSchema,
  verificationResultsSchema,
} from '../../src/state/schemas.js';

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
