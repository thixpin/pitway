import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'zod';
import { formatIssues } from '../../state/contract-file.js';
import { trimTail } from '../verification/text-trim.js';
import { TaskUpdateError } from './update-error.js';

// M039/T001: extracted verbatim from src/core/tasks/update.ts -- a responsibility split, not a redesign.

export const resultSchema = z.strictObject({
  summary: z.string().min(1),
  evidence: z.string().min(1),
});

export type TaskResult = z.infer<typeof resultSchema>;

// AC006: worker reports stay concise and machine-readable -- summary/
// evidence are bounded at a fixed character length rather than allowed to
// grow unbounded, reusing T001's shared trimTail helper (a preserved,
// tail-anchored truncation) instead of inventing a second scheme. The cap
// only ever applies to a fresh --result write (parseResultInput, below);
// the completed/re-entry path in completeTask reads task.result as already
// persisted and never re-parses or rewrites it.
export const SUMMARY_CAP = 300;
export const EVIDENCE_CAP = 1000;
export const TRUNCATION_MARKER = '[truncated] ';

export function capField(value: string, cap: number): string {
  if (value.length <= cap) return value;
  const budget = Math.max(0, cap - TRUNCATION_MARKER.length);
  return `${TRUNCATION_MARKER}${trimTail(value, { cap: budget, lines: Number.MAX_SAFE_INTEGER })}`;
}

export function readInput(path: string, label: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    throw new TaskUpdateError(`cannot read ${label} file ${path}: ${(error as Error).message}`);
  }
}

export function parseResultInput(path: string): TaskResult {
  const text = readInput(path, 'result');
  let data: unknown;
  try {
    data = parse(text);
  } catch (error) {
    throw new TaskUpdateError(`malformed YAML in result file ${path}: ${(error as Error).message}`);
  }
  const parsed = resultSchema.safeParse(data);
  if (!parsed.success) {
    throw new TaskUpdateError(`invalid result file ${path}: ${formatIssues(parsed.error)}`);
  }
  return {
    summary: capField(parsed.data.summary, SUMMARY_CAP),
    evidence: capField(parsed.data.evidence, EVIDENCE_CAP),
  };
}
