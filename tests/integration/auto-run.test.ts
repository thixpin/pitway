import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveContract, saveState } from '../../src/state/store.js';
import { appendJournalEntry, readJournal, reconcilePending } from '../../src/state/journal.js';
import { derivePending, resolveTargetPath } from '../../src/core/journal/operations.js';
import { buildCli } from '../../src/cli/index.js';
import { registerAutoRunCommand } from '../../src/cli/commands/auto-run.js';
import type { ContractFrontmatter } from '../../src/state/schemas.js';

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

let root: string;

const HASH_A = 'sha256:' + 'a'.repeat(64);
const HASH_B = 'sha256:' + 'b'.repeat(64);

function baseFrontmatter(overrides: Partial<ContractFrontmatter> = {}): ContractFrontmatter {
  return {
    schema_version: 1,
    id: 'M005',
    title: 'Test Milestone',
    status: 'in_progress',
    requirement: null,
    confirmed_at: '2026-08-18T00:00:00Z',
    verification_approved_hash: HASH_A,
    acceptance_criteria: [{ id: 'AC001', text: 'criterion' }],
    verification: [{ id: 'CT001', criterion: 'AC001', type: 'command', command: 'npm test' }],
    ...overrides,
  };
}

function setupMilestone(frontmatter: ContractFrontmatter): void {
  mkdirSync(join(root, '.pitway', 'milestones', frontmatter.id), { recursive: true });
  saveState(root, { schema_version: 1, active_milestone: frontmatter.id, milestones: [frontmatter.id] });
  saveContract(root, frontmatter.id, { frontmatter, body: '\n# Contract\n' });
}

async function runAutoRun(args: string[]): Promise<{ lines: string[]; error?: Error }> {
  const program = buildCli();
  const lines: string[] = [];
  registerAutoRunCommand(program, { root, write: (s) => lines.push(s) });
  try {
    await program.parseAsync(['node', 'pitway', 'auto-run', ...args]);
    return { lines };
  } catch (error) {
    return { lines, error: error as Error };
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pitway-autorun-'));
  git(['init', '-q'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('pitway auto-run enable', () => {
  it('requires the milestone be in_progress', async () => {
    setupMilestone(baseFrontmatter({ status: 'confirmed' }));
    const { error } = await runAutoRun(['enable', 'M005', '--json']);
    expect(error?.message).toMatch(/in_progress/);
    expect(readJournal(root)).toHaveLength(0);
  });

  it('records the current verification_approved_hash on a fresh enable', async () => {
    setupMilestone(baseFrontmatter());
    const { error, lines } = await runAutoRun(['enable', 'M005', '--json']);
    expect(error).toBeUndefined();
    const view = JSON.parse(lines.join('\n'));
    expect(view).toMatchObject({ id: 'M005', action: 'enable', outcome: 'enabled', hash: HASH_A });

    const journal = readJournal(root);
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({ kind: 'auto_run', milestone: 'M005', action: 'enable', hash: HASH_A });
  });

  it('is idempotent when already authorized against the same hash — no duplicate record is appended', async () => {
    setupMilestone(baseFrontmatter());
    await runAutoRun(['enable', 'M005', '--json']);
    const { error, lines } = await runAutoRun(['enable', 'M005', '--json']);
    expect(error).toBeUndefined();
    const view = JSON.parse(lines.join('\n'));
    expect(view.outcome).toBe('already-authorized');
    expect(readJournal(root)).toHaveLength(1);
  });

  it('appends a fresh enable record when re-enabling after the hash changed', async () => {
    setupMilestone(baseFrontmatter());
    await runAutoRun(['enable', 'M005', '--json']);
    setupMilestone(baseFrontmatter({ verification_approved_hash: HASH_B }));
    const { error, lines } = await runAutoRun(['enable', 'M005', '--json']);
    expect(error).toBeUndefined();
    const view = JSON.parse(lines.join('\n'));
    expect(view).toMatchObject({ outcome: 'enabled', hash: HASH_B });
    const journal = readJournal(root);
    expect(journal.filter((r) => r.kind === 'auto_run')).toHaveLength(2);
  });

  it('defaults to the active milestone when no milestone-id is given', async () => {
    setupMilestone(baseFrontmatter());
    const { error, lines } = await runAutoRun(['enable', '--json']);
    expect(error).toBeUndefined();
    expect(JSON.parse(lines.join('\n')).id).toBe('M005');
  });
});

describe('pitway auto-run disable / status work for a milestone in any status', () => {
  for (const status of ['draft', 'confirmed', 'in_progress', 'review', 'completed'] as const) {
    it(`disable succeeds while status is "${status}"`, async () => {
      setupMilestone(baseFrontmatter({ status }));
      const { error, lines } = await runAutoRun(['disable', 'M005', '--json']);
      expect(error).toBeUndefined();
      expect(JSON.parse(lines.join('\n'))).toMatchObject({ id: 'M005', action: 'disable', outcome: 'disabled' });
    });

    it(`status succeeds while status is "${status}"`, async () => {
      setupMilestone(baseFrontmatter({ status }));
      const { error } = await runAutoRun(['status', 'M005', '--json']);
      expect(error).toBeUndefined();
    });
  }
});

describe('pitway auto-run status reasons', () => {
  it('reports "never enabled" when no auto_run record exists', async () => {
    setupMilestone(baseFrontmatter());
    const { lines } = await runAutoRun(['status', 'M005', '--json']);
    expect(JSON.parse(lines.join('\n'))).toMatchObject({ authorized: false, reason: 'never enabled' });
  });

  it('reports "explicitly disabled" after a disable', async () => {
    setupMilestone(baseFrontmatter());
    await runAutoRun(['enable', 'M005', '--json']);
    await runAutoRun(['disable', 'M005', '--json']);
    const { lines } = await runAutoRun(['status', 'M005', '--json']);
    expect(JSON.parse(lines.join('\n'))).toMatchObject({ authorized: false, reason: 'explicitly disabled' });
  });

  it('reports "hash changed since" after the milestone is re-confirmed/amended to a new hash', async () => {
    setupMilestone(baseFrontmatter());
    await runAutoRun(['enable', 'M005', '--json']);
    setupMilestone(baseFrontmatter({ verification_approved_hash: HASH_B }));
    const { lines } = await runAutoRun(['status', 'M005', '--json']);
    expect(JSON.parse(lines.join('\n'))).toMatchObject({ authorized: false, reason: 'hash changed since' });
  });

  it('reports "amendment recorded since" after a contract_amendment/task_amendment journal entry lands', async () => {
    setupMilestone(baseFrontmatter());
    await runAutoRun(['enable', 'M005', '--json']);
    appendJournalEntry(root, {
      milestone: 'M005',
      type: 'contract_amendment',
      operationId: 'op-amend-1',
      payload: {},
    });
    const { lines } = await runAutoRun(['status', 'M005', '--json']);
    expect(JSON.parse(lines.join('\n'))).toMatchObject({ authorized: false, reason: 'amendment recorded since' });
  });

  it('reports authorized: true right after a fresh enable, with no gate hit', async () => {
    setupMilestone(baseFrontmatter());
    await runAutoRun(['enable', 'M005', '--json']);
    const { lines } = await runAutoRun(['status', 'M005', '--json']);
    expect(JSON.parse(lines.join('\n'))).toMatchObject({ authorized: true, reason: null });
  });
});

// AC: auto_run is a new sibling record kind that is structurally invisible
// to derivePending, resolveTargetPath, checkpoint folding, and
// reconcilePending -- proven here by exercising all four with an auto_run
// record interleaved in the log, without modifying any of those functions
// (they are read-only imports in this test file).
describe('auto_run records are structurally invisible to entry/checkpoint machinery', () => {
  function commitWithTrailers(cwd: string, files: string[], milestone: string): string {
    git(['add', '--', ...files], cwd);
    git(['commit', '-m', `workflow: complete ${milestone}\n\nPitWay-Milestone: ${milestone}`], cwd);
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd }).toString().trim();
  }

  it('derivePending, resolveTargetPath, checkpoint folding, and reconcilePending all ignore an interleaved auto_run record', async () => {
    setupMilestone(baseFrontmatter());
    const milestoneDir = join(root, '.pitway', 'milestones', 'M005');
    const usagePath = join(milestoneDir, 'usage.yaml');
    writeFileSync(usagePath, 'schema_version: 1\nplanning: null\nqa: null\n');

    // An auto_run enable record lands in the log first.
    await runAutoRun(['enable', 'M005', '--json']);

    // Then a genuine pending entry.
    appendJournalEntry(root, {
      milestone: 'M005',
      type: 'usage_recording',
      operationId: 'op-usage-1',
      payload: { total_tokens: 10 },
    });

    // Then another auto_run record, interleaved after the pending entry.
    await runAutoRun(['disable', 'M005', '--json']);

    const all = readJournal(root);
    expect(all.some((r) => r.kind === 'auto_run')).toBe(true);

    // derivePending sees only the entry-kind record, oblivious to both
    // auto_run records surrounding it.
    const pending = derivePending(all);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.operationId).toBe('op-usage-1');

    // resolveTargetPath resolves normally from the entry-kind record alone.
    const relTarget = resolveTargetPath({ type: 'usage_recording' }, 'M005');
    expect(relTarget).toBe('.pitway/milestones/M005/usage.yaml');

    // Checkpoint folding: commit the target file and reconcile.
    const relUsage = '.pitway/milestones/M005/usage.yaml';
    const sha = commitWithTrailers(root, [relUsage], 'M005');
    const created = reconcilePending(root, 'M005');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ entryOperationId: 'op-usage-1', commitSha: sha });
    expect(derivePending(readJournal(root))).toHaveLength(0);

    // The auto_run records themselves are untouched by reconciliation --
    // still present, unmodified, never checkpointed.
    const autoRunRecords = readJournal(root).filter((r) => r.kind === 'auto_run');
    expect(autoRunRecords).toHaveLength(2);
    expect(readJournal(root).filter((r) => r.kind === 'checkpoint')).toHaveLength(1);
  });
});
