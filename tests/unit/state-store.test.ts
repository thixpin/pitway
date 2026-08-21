import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { readFileSync } from 'node:fs';
import {
  MilestoneResolutionError,
  StateStoreError,
  createMilestoneDir,
  loadBacklog,
  loadConfig,
  loadContract,
  loadState,
  loadTasks,
  loadUsage,
  loadVerificationRepairs,
  loadVerificationResults,
  milestoneDirExists,
  nextBacklogId,
  nextRequirementId,
  readInputFile,
  saveBacklog,
  saveConfig,
  saveContract,
  saveRequirement,
  saveState,
  saveTasks,
  saveUsage,
  saveVerificationRepairs,
  saveVerificationResults,
  slugifyTitle,
} from '../../src/state/store.js';
import type {
  BacklogFile,
  BacklogItem,
  PitwayConfig,
  PitwayState,
  TasksFile,
  UsageFile,
  VerificationRepairsFile,
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

  it('round-trips verification-repairs.yaml when the file already exists', () => {
    const repairs: VerificationRepairsFile = {
      schema_version: 1,
      records: [
        {
          id: 'VR001',
          files: ['src/example.ts'],
          checks: ['CT001'],
          change_log: 'fix a thing',
          approved_at: '2026-08-20T00:00:00Z',
          status: 'pending',
        },
      ],
    };
    saveVerificationRepairs(root, 'M001', repairs);
    expect(loadVerificationRepairs(root, 'M001')).toEqual(repairs);
  });
});

// Bootstrap-tolerance regression coverage: a milestone materialized before
// verification-repairs.yaml existed as a concept (M009's own draft
// predates T002's own fix) has no such file at all -- distinct from a file
// that exists but is malformed or otherwise unreadable, which must still
// fail visibly through the same path every other per-milestone file uses.
describe('loadVerificationRepairs bootstrap tolerance', () => {
  it('treats a missing verification-repairs.yaml as an empty, schema-valid store', () => {
    expect(loadVerificationRepairs(root, 'M001')).toEqual({ schema_version: 1, records: [] });
  });

  it('still round-trips a genuinely existing store (not masked by the tolerance path)', () => {
    const repairs: VerificationRepairsFile = { schema_version: 1, records: [] };
    saveVerificationRepairs(root, 'M001', repairs);
    expect(loadVerificationRepairs(root, 'M001')).toEqual(repairs);
  });

  it('still reports malformed YAML with the file path, not silently treated as empty', () => {
    writeFileSync(
      join(root, '.pitway', 'milestones', 'M001', 'verification-repairs.yaml'),
      'records: [unclosed\n',
    );
    expect(() => loadVerificationRepairs(root, 'M001')).toThrowError(StateStoreError);
    expect(() => loadVerificationRepairs(root, 'M001')).toThrowError(/verification-repairs\.yaml/);
  });

  it('still fails visibly on a non-ENOENT read error (path is a directory, not a file)', () => {
    // EISDIR, not ENOENT -- existsSync is true, but readFileSync itself
    // fails, exactly the "other I/O error" case the tolerance must not mask.
    mkdirSync(join(root, '.pitway', 'milestones', 'M001', 'verification-repairs.yaml'));
    expect(() => loadVerificationRepairs(root, 'M001')).toThrowError(StateStoreError);
  });
});

// M018/T001 (AC001): loadBacklog/saveBacklog are root-level, not
// per-milestone -- same absent-file tolerance idiom as
// loadVerificationRepairs above, applied to .pitway/backlog.yaml directly
// under root instead of a milestone directory.
describe('loadBacklog/saveBacklog (root-level, M018/T001)', () => {
  it('treats a missing backlog.yaml as an empty, schema-valid store', () => {
    expect(loadBacklog(root)).toEqual({ schema_version: 1, items: [] });
  });

  it('round-trips a genuinely existing backlog.yaml', () => {
    const backlog: BacklogFile = {
      schema_version: 1,
      items: [
        {
          id: 'B001',
          title: 'Handle stale evidence',
          reason: 'Discovered while implementing T003.',
          status: 'pending',
          source: { milestone: 'M018', task: 'T003' },
          created_at: '2026-08-21T09:00:00Z',
          resolved_at: null,
          promoted_to: null,
          archived_reason: null,
        },
      ],
    };
    saveBacklog(root, backlog);
    expect(loadBacklog(root)).toEqual(backlog);
  });

  it('writes backlog.yaml at the repo root, not inside any milestone directory', () => {
    saveBacklog(root, { schema_version: 1, items: [] });
    expect(readdirSync(join(root, '.pitway'))).toContain('backlog.yaml');
  });

  it('still reports malformed YAML with the file path, not silently treated as empty', () => {
    writeFileSync(join(root, '.pitway', 'backlog.yaml'), 'items: [unclosed\n');
    expect(() => loadBacklog(root)).toThrowError(StateStoreError);
    expect(() => loadBacklog(root)).toThrowError(/backlog\.yaml/);
  });
});

describe('nextBacklogId (M018/T001)', () => {
  it('returns B001 for an empty items array', () => {
    expect(nextBacklogId([])).toBe('B001');
  });

  it('returns max+1 by scanning the given items array in memory', () => {
    const items = [{ id: 'B001' }, { id: 'B003' }, { id: 'B002' }] as BacklogItem[];
    expect(nextBacklogId(items)).toBe('B004');
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

describe('requirement artifact I/O', () => {
  it('computes R001 as the next requirement id when none exist', () => {
    expect(nextRequirementId(root)).toBe('R001');
  });

  it('computes the next requirement id from existing files', () => {
    saveRequirement(root, 'R001', '# One\n');
    saveRequirement(root, 'R002', '# Two\n');
    expect(nextRequirementId(root)).toBe('R003');
  });

  it('computes the next requirement id past a gap (does not fill it)', () => {
    saveRequirement(root, 'R001', '# One\n');
    saveRequirement(root, 'R005', '# Five\n');
    expect(nextRequirementId(root)).toBe('R006');
  });

  it('saves a requirement artifact and reads it back byte-for-byte', () => {
    saveRequirement(root, 'R001', '# Requirement\n\nDo the thing.\n');
    const text = readFileSync(join(root, '.pitway', 'requirements', 'R001.md'), 'utf8');
    expect(text).toBe('# Requirement\n\nDo the thing.\n');
  });
});

describe('readInputFile', () => {
  it('reads an external file by path', () => {
    const path = join(root, 'draft.md');
    writeFileSync(path, 'draft contents');
    expect(readInputFile(path, 'contract')).toBe('draft contents');
  });

  it('throws StateStoreError with the label and path when the file cannot be read', () => {
    const path = join(root, 'missing.md');
    expect(() => readInputFile(path, 'contract')).toThrowError(StateStoreError);
    expect(() => readInputFile(path, 'contract')).toThrowError(
      new RegExp(`cannot read contract file ${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    );
  });
});

describe('milestoneDirExists', () => {
  it('returns true when a bare milestone directory exists', () => {
    expect(milestoneDirExists(root, 'M001')).toBe(true);
  });

  it('returns true when a slugged milestone directory exists', () => {
    mkdirSync(join(root, '.pitway', 'milestones', 'M002-some-title'), { recursive: true });
    expect(milestoneDirExists(root, 'M002')).toBe(true);
  });

  it('returns false when neither a bare nor a slugged directory exists', () => {
    expect(milestoneDirExists(root, 'M999')).toBe(false);
  });
});

describe('slugifyTitle', () => {
  it('lowercases the title', () => {
    expect(slugifyTitle('Slugged Milestone')).toBe('slugged-milestone');
  });

  it('collapses runs of non-alphanumeric characters into a single hyphen', () => {
    expect(slugifyTitle('Fix: bug #123 (urgent!!)')).toBe('fix-bug-123-urgent');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugifyTitle('--already hyphenated--')).toBe('already-hyphenated');
  });

  it('truncates at a word boundary at or before 40 characters', () => {
    const title = 'This title is deliberately long enough to require truncation';
    const slug = slugifyTitle(title);
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug).toBe('this-title-is-deliberately-long-enough');
  });

  it('produces an empty string for a title with no alphanumeric characters', () => {
    expect(slugifyTitle('!!! --- ???')).toBe('');
  });
});

describe('createMilestoneDir', () => {
  it('creates a slugged directory derived from a real title', () => {
    createMilestoneDir(root, 'M002', 'Slugged Milestone');
    const entries = readdirSync(join(root, '.pitway', 'milestones'));
    expect(entries).toContain('M002-slugged-milestone');
  });

  it('creates a bare directory when the title slugifies to empty', () => {
    createMilestoneDir(root, 'M003', '!!! --- ???');
    const entries = readdirSync(join(root, '.pitway', 'milestones'));
    expect(entries).toContain('M003');
  });
});

describe('milestone directory resolution (via loadTasks)', () => {
  it('resolves a bare directory (grandfathering)', () => {
    const tasks = fixture('valid/tasks.yaml') as TasksFile;
    saveTasks(root, 'M001', tasks);
    expect(loadTasks(root, 'M001')).toEqual(tasks);
  });

  it('resolves a single slugged directory', () => {
    mkdirSync(join(root, '.pitway', 'milestones', 'M002-my-slug'), { recursive: true });
    const tasks = fixture('valid/tasks.yaml') as TasksFile;
    saveTasks(root, 'M002', tasks);
    expect(loadTasks(root, 'M002')).toEqual(tasks);
  });

  it('refuses when zero candidates exist', () => {
    expect(() => loadTasks(root, 'M999')).toThrowError(MilestoneResolutionError);
    expect(() => loadTasks(root, 'M999')).toThrowError(/M999/);
  });

  it('refuses when multiple slugged candidates exist for the same id, naming them', () => {
    mkdirSync(join(root, '.pitway', 'milestones', 'M002-first-slug'), { recursive: true });
    mkdirSync(join(root, '.pitway', 'milestones', 'M002-second-slug'), { recursive: true });
    expect(() => loadTasks(root, 'M002')).toThrowError(MilestoneResolutionError);
    expect(() => loadTasks(root, 'M002')).toThrowError(/M002-first-slug/);
    expect(() => loadTasks(root, 'M002')).toThrowError(/M002-second-slug/);
  });

  it('refuses when a bare and slugged directory coexist for the same id, naming both', () => {
    mkdirSync(join(root, '.pitway', 'milestones', 'M002-some-slug'), { recursive: true });
    mkdirSync(join(root, '.pitway', 'milestones', 'M002'), { recursive: true });
    expect(() => loadTasks(root, 'M002')).toThrowError(MilestoneResolutionError);
    expect(() => loadTasks(root, 'M002')).toThrowError(/M002-some-slug/);
    expect(() => loadTasks(root, 'M002')).toThrowError(/M002(?!-)/);
  });
});
