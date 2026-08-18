import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { readFileSync } from 'node:fs';
import {
  StateStoreError,
  loadConfig,
  loadContract,
  loadState,
  loadTasks,
  loadUsage,
  loadVerificationResults,
  saveConfig,
  saveContract,
  saveState,
  saveTasks,
  saveUsage,
  saveVerificationResults,
} from '../../src/state/store.js';
import type {
  PitwayConfig,
  PitwayState,
  TasksFile,
  UsageFile,
  VerificationResults,
} from '../../src/state/schemas.js';

const fixture = (name: string): unknown =>
  parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pitway-test-'));
  mkdirSync(join(root, '.pitway', 'milestones', 'M001'), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('state store round-trips', () => {
  it('round-trips config.yaml', () => {
    const config = fixture('valid/config.yaml') as PitwayConfig;
    saveConfig(root, config);
    expect(loadConfig(root)).toEqual(config);
  });

  it('round-trips state.yaml', () => {
    const state = fixture('valid/state.yaml') as PitwayState;
    saveState(root, state);
    expect(loadState(root)).toEqual(state);
  });

  it('round-trips tasks.yaml', () => {
    const tasks = fixture('valid/tasks.yaml') as TasksFile;
    saveTasks(root, 'M001', tasks);
    expect(loadTasks(root, 'M001')).toEqual(tasks);
  });

  it('round-trips verification-results.yaml', () => {
    const results = fixture('valid/verification-results.yaml') as VerificationResults;
    saveVerificationResults(root, 'M001', results);
    expect(loadVerificationResults(root, 'M001')).toEqual(results);
  });

  it('round-trips usage.yaml', () => {
    const usage = fixture('valid/usage.yaml') as UsageFile;
    saveUsage(root, 'M001', usage);
    expect(loadUsage(root, 'M001')).toEqual(usage);
  });

  it('round-trips contract.md preserving the body byte-for-byte', () => {
    const frontmatter = fixture('valid/contract-frontmatter.yaml');
    const body = '\n# Contract\n\nProse stays untouched.\n';
    saveContract(root, 'M001', { frontmatter, body } as never);
    const loaded = loadContract(root, 'M001');
    expect(loaded.frontmatter).toEqual(frontmatter);
    expect(loaded.body).toBe(body);
  });
});

describe('state store validation', () => {
  it('rejects an unknown schema_version with a clear error', () => {
    writeFileSync(join(root, '.pitway', 'config.yaml'), 'schema_version: 2\n');
    expect(() => loadConfig(root)).toThrowError(StateStoreError);
    expect(() => loadConfig(root)).toThrowError(/config\.yaml.*schema_version/s);
  });

  it('rejects invalid data on save', () => {
    const state = { schema_version: 1, active_milestone: 'nope', milestones: [] };
    expect(() => saveState(root, state as never)).toThrowError(StateStoreError);
  });

  it('reports a missing milestone directory with the milestone id', () => {
    expect(() => loadTasks(root, 'M999')).toThrowError(StateStoreError);
    expect(() => loadTasks(root, 'M999')).toThrowError(/M999/);
  });

  it('reports malformed YAML with the file path', () => {
    writeFileSync(join(root, '.pitway', 'state.yaml'), 'milestones: [unclosed\n');
    expect(() => loadState(root)).toThrowError(StateStoreError);
    expect(() => loadState(root)).toThrowError(/state\.yaml/);
  });

  it('reports a missing .pitway directory clearly', () => {
    rmSync(join(root, '.pitway'), { recursive: true });
    expect(() => loadConfig(root)).toThrowError(/\.pitway/);
  });
});
