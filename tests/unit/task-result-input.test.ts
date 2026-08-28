import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EVIDENCE_CAP,
  SUMMARY_CAP,
  TRUNCATION_MARKER,
  capField,
  parseResultInput,
  readInput,
} from '../../src/core/tasks/result-input.js';
import { TaskUpdateError } from '../../src/core/tasks/update.js';

// M039/T001 (AC004): --result file parsing and the summary/evidence caps,
// exercised directly.

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pitway-result-input-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('capField', () => {
  it('returns the value untouched at or under the cap', () => {
    expect(capField('abc', 3)).toBe('abc');
    expect(capField('ab', 3)).toBe('ab');
  });

  it('prefixes the truncation marker and keeps the tail when over the cap', () => {
    const value = 'x'.repeat(50) + 'TAIL';
    const capped = capField(value, 30);
    expect(capped.startsWith(TRUNCATION_MARKER)).toBe(true);
    expect(capped.endsWith('TAIL')).toBe(true);
    expect(capped.length).toBeLessThanOrEqual(30);
  });

  it('exposes the same caps completeTask applies', () => {
    expect(SUMMARY_CAP).toBe(300);
    expect(EVIDENCE_CAP).toBe(1000);
    expect(TRUNCATION_MARKER).toBe('[truncated] ');
  });
});

describe('readInput', () => {
  it('reads a file and names the label in the refusal when it cannot', () => {
    writeFileSync(join(dir, 'msg.txt'), 'hello\n');
    expect(readInput(join(dir, 'msg.txt'), 'message')).toBe('hello\n');
    const missing = join(dir, 'nope.txt');
    expect(() => readInput(missing, 'message')).toThrow(TaskUpdateError);
    expect(() => readInput(missing, 'message')).toThrow(`cannot read message file ${missing}: `);
  });
});

describe('parseResultInput', () => {
  it('parses a valid YAML result and caps each field', () => {
    const path = join(dir, 'result.yaml');
    writeFileSync(path, `summary: done\nevidence: ${'e'.repeat(1200)}\n`);
    const result = parseResultInput(path);
    expect(result.summary).toBe('done');
    expect(result.evidence.startsWith(TRUNCATION_MARKER)).toBe(true);
    expect(result.evidence.length).toBeLessThanOrEqual(EVIDENCE_CAP);
  });

  it('refuses malformed YAML naming the file', () => {
    const path = join(dir, 'bad.yaml');
    writeFileSync(path, 'summary: [unclosed\n');
    expect(() => parseResultInput(path)).toThrow(TaskUpdateError);
    expect(() => parseResultInput(path)).toThrow(`malformed YAML in result file ${path}: `);
  });

  it('refuses a schema violation (missing evidence, unknown key) naming the file', () => {
    const path = join(dir, 'schema.yaml');
    writeFileSync(path, 'summary: done\nextra: 1\n');
    expect(() => parseResultInput(path)).toThrow(TaskUpdateError);
    expect(() => parseResultInput(path)).toThrow(`invalid result file ${path}: `);
  });

  it('refuses a missing file through readInput with the result label', () => {
    const path = join(dir, 'missing.yaml');
    expect(() => parseResultInput(path)).toThrow(`cannot read result file ${path}: `);
  });
});
