import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { parseContractFile } from '../../src/state/contract-file.js';
import { reviewRecordInputSchema, taskSchema, tasksFileSchema } from '../../src/state/schemas.js';

// M028/T001 (AC001, AC002): every example embedded in the shared
// draft-formats.md driver asset must be accepted by the REAL production
// parsers. The test extracts each fenced block by section heading, so a doc
// edit that breaks a documented format fails here -- the installed reference
// can never drift from what the CLI accepts.
//
// RED-first note: this file was written before draft-formats.md existed; the
// first run failed on the missing asset, and the GREEN state is the asset
// landing with all six examples validating.

const ASSET_PATH = join(process.cwd(), 'src/integrations/common/draft-formats.md');

function section(heading: string): string {
  const text = readFileSync(ASSET_PATH, 'utf8');
  const marker = `## ${heading}`;
  const start = text.indexOf(marker);
  if (start === -1) throw new Error(`draft-formats.md is missing section "${heading}"`);
  // Contract examples embed '## ' headings inside their fenced blocks, so
  // section boundaries can't be used for extraction -- take the first fenced
  // block after the heading instead.
  const rest = text.slice(start + marker.length);
  const open = rest.indexOf('```');
  if (open === -1) throw new Error(`section "${heading}" has no fenced example`);
  const contentStart = rest.indexOf('\n', open) + 1;
  const close = rest.indexOf('\n```', contentStart);
  if (close === -1) throw new Error(`section "${heading}" fence is unterminated`);
  return rest.slice(contentStart, close);
}

describe('draft-formats.md examples validate against production parsers', () => {
  it('the asset exists and covers all six formats', () => {
    const text = readFileSync(ASSET_PATH, 'utf8');
    for (const heading of [
      'Draft contract',
      'Draft tasks',
      'Amended contract',
      'task-add task file',
      'task-amend partial object',
      'milestone-review findings',
    ]) {
      expect(text).toContain(`## ${heading}`);
    }
  });

  it('contract draft example parses via parseContractFile', () => {
    const parsed = parseContractFile(section('Draft contract'));
    expect(parsed.frontmatter.id).toMatch(/^M\d{3}$/);
    expect(parsed.frontmatter.status).toBe('draft');
    expect(parsed.frontmatter.acceptance_criteria.length).toBeGreaterThan(0);
    expect(parsed.frontmatter.verification.length).toBeGreaterThan(0);
  });

  it('tasks draft example validates via tasksFileSchema', () => {
    const data = parse(section('Draft tasks'));
    const parsed = tasksFileSchema.safeParse(data);
    expect(parsed.success).toBe(true);
  });

  it('amended contract example parses AND carries a Change Log entry (confirm --amend gate)', () => {
    const parsed = parseContractFile(section('Amended contract'));
    expect(parsed.frontmatter.status).not.toBe('draft');
    const lines = parsed.body.split('\n');
    const logAt = lines.findIndex((l) => l.trim() === '## Change Log');
    expect(logAt).toBeGreaterThanOrEqual(0);
    expect(lines.slice(logAt + 1).some((l) => l.trim().length > 0 && !l.startsWith('#'))).toBe(
      true,
    );
  });

  it('task-add example fields produce a valid task once id/status/result/usage are injected', () => {
    const fields = parse(section('task-add task file')) as Record<string, unknown>;
    expect(typeof fields.name).toBe('string');
    expect((fields.name as string).trim().length).toBeGreaterThan(0);
    // add.ts injects status/result/usage and checks id == nextSequentialTaskId;
    // the candidate shape here mirrors that path exactly.
    const candidate = { ...fields, id: fields.id ?? 'T002', status: 'waiting', result: null, usage: null };
    const parsed = taskSchema.safeParse(candidate);
    expect(parsed.success).toBe(true);
  });

  it('task-amend example contains only AMENDABLE_FIELDS keys', () => {
    const allowed = new Set([
      'objective',
      'acceptance_criteria',
      'relevant_files',
      'context_files',
      'write_scope',
      'verification',
    ]);
    const fields = parse(section('task-amend partial object')) as Record<string, unknown>;
    expect(Object.keys(fields).filter((k) => !allowed.has(k))).toEqual([]);
    // And the resulting merged task would still be schema-valid: start from a
    // minimal valid base and overlay the partial.
    const base = {
      id: 'T001',
      objective: 'x',
      status: 'waiting',
      depends_on: [],
      acceptance_criteria: ['x'],
      relevant_files: ['src/a.ts'],
      verification: { strategy: 'command' as const, detail: 'npm test' },
      result: null,
      usage: null,
    };
    const parsed = taskSchema.safeParse({ ...base, ...fields });
    expect(parsed.success).toBe(true);
  });

  it('milestone-review findings example validates via reviewRecordInputSchema', () => {
    const data = parse(section('milestone-review findings'));
    const parsed = reviewRecordInputSchema.safeParse(data);
    expect(parsed.success).toBe(true);
  });
});
