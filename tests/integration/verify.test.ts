import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCli } from '../../src/cli/index.js';
import { registerInitCommand } from '../../src/cli/commands/init.js';
import { registerMilestoneAddCommand } from '../../src/cli/commands/milestone-add.js';
import { registerMilestoneConfirmCommand } from '../../src/cli/commands/milestone-confirm.js';
import { registerVerifyCommand } from '../../src/cli/commands/verify.js';
import { loadState, loadTasks, loadVerificationResults, saveState, saveTasks } from '../../src/state/store.js';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

const commitCount = (cwd: string): number => Number(git(['rev-list', '--count', 'HEAD'], cwd).trim());

// T002: recursion-guard.ts's evaluateRecursionGuard is a tiny, pure,
// zero-dependency decision function. It's reproduced inline in the
// generated script below rather than imported by its real .ts path, so
// this fixture never depends on Node's native TypeScript-stripping support
// -- absent before Node 22.6 and not what this project's own engines.node
// (>=20) promises real users. Importing the .ts path directly used to work
// here only because every local run happened to use a newer Node; the
// first real run on genuine Node 20 (this project's actual CI) failed with
// ERR_UNKNOWN_FILE_EXTENSION. The logic below must stay byte-identical to
// recursion-guard.ts's own -- it's small and pure specifically so that's
// easy to keep true by inspection.
//
// Builds a plain Node script that reproduces run.ts's exact guard-token
// format (`<canonical-git-dir>#<milestoneId>`) for `gitDirCwd`, evaluates it
// against the real (inherited) PITWAY_VERIFY_GUARD env var using the same
// decision logic evaluateRecursionGuard implements, and reports the outcome
// on stdout/stderr with an unambiguous marker -- exiting fast, never
// sleeping, so a refusal is bounded-time by construction rather than by luck.
//
// Test-isolation hotfix: the marker is printed LAST, after the (potentially
// long, unbounded-length) token data, not as a prefix. run.ts's evidence
// capping keeps the TAIL of a command's output (trimTail, 200 chars,
// tail-preserved) -- a prefix marker is not guaranteed to survive that cap
// once an ambient PITWAY_VERIFY_GUARD token is already present (as it
// genuinely is when this test suite runs as a child of a live outer
// `pitway verify` on this repository itself), which grows the accumulated
// token list past what a leading marker could survive truncation to. A
// trailing marker survives regardless of how long the preceding data is.
function recursionCheckScript(gitDirCwd: string, milestoneId: string): string {
  return `
import { execFileSync } from 'node:child_process';
const SEPARATOR = ',';
function evaluateRecursionGuard(currentValue, candidateToken) {
  const tokens = currentValue ? currentValue.split(SEPARATOR).filter((t) => t.length > 0) : [];
  if (tokens.includes(candidateToken)) {
    return { decision: 'refuse', token: candidateToken };
  }
  return { decision: 'extend', value: [...tokens, candidateToken].join(SEPARATOR) };
}
const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: ${JSON.stringify(gitDirCwd)} }).toString().trim();
const token = gitDir + '#' + ${JSON.stringify(milestoneId)};
const decision = evaluateRecursionGuard(process.env.PITWAY_VERIFY_GUARD, token);
if (decision.decision === 'refuse') {
  console.error(decision.token);
  console.error('RECURSION_REFUSED');
  process.exit(1);
}
console.log(decision.value);
console.log('RECURSION_OK');
`;
}

let root: string;

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

// Cheap fixture commands only — never npm (running the real contract's
// commands from inside the test suite would recurse).
const DEFAULT_CHECKS = `  - id: CT001
    criterion: AC001
    type: command
    command: echo hello
  - id: CT002
    criterion: AC001
    type: command
    command: echo ok
  - id: CT003
    criterion: AC001
    type: manual
    instruction: Check the docs.
`;

const FAILING_CHECKS = `  - id: CT001
    criterion: AC001
    type: command
    command: echo hello
  - id: CT002
    criterion: AC001
    type: command
    command: echo boom && exit 1
  - id: CT003
    criterion: AC001
    type: manual
    instruction: Check the docs.
`;

// M017/T004 (AC004): a failure whose output actually matches
// summarizeFailure's Vitest-style pattern, unlike FAILING_CHECKS's plain
// "boom" (deliberately chosen there to prove the byte-identical
// no-match path stays untouched).
const FAILING_CHECKS_WITH_SUMMARY = `  - id: CT001
    criterion: AC001
    type: command
    command: node -e "console.log('FAIL src/x.test.ts > it fails'); process.exit(1)"
`;

const makeContract = (verification: string): string => `---
schema_version: 1
id: M999
title: Verifiable milestone
status: draft
requirement: null
confirmed_at: null
verification_approved_hash: null
acceptance_criteria:
  - id: AC001
    text: Behavior holds.
verification:
${verification}---

# Contract

## Objective

Example.

## Change Log
`;

const TASKS_FIXTURE = `schema_version: 1
tasks:
  - id: T001
    objective: Only task.
    status: planned
    depends_on: []
    acceptance_criteria:
      - It works
    relevant_files:
      - src/a.ts
    verification:
      strategy: tdd
      detail: npm test
    result: null
    usage: null
`;

async function run(args: string[], cwd: string): Promise<{ lines: string[]; error?: Error }> {
  const program = buildCli();
  const lines: string[] = [];
  registerInitCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerMilestoneAddCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerMilestoneConfirmCommand(program, { root: cwd, write: (s) => lines.push(s) });
  registerVerifyCommand(program, { root: cwd, write: (s) => lines.push(s) });
  try {
    await program.parseAsync(['node', 'pitway', ...args]);
    return { lines };
  } catch (error) {
    return { lines, error: error as Error };
  }
}

async function addMilestone(verification = DEFAULT_CHECKS): Promise<void> {
  const contract = join(root, 'draft-contract.md');
  const tasks = join(root, 'draft-tasks.yaml');
  writeFileSync(contract, makeContract(verification));
  writeFileSync(tasks, TASKS_FIXTURE);
  const { error } = await run(['milestone-add', '--contract', contract, '--tasks', tasks], root);
  expect(error).toBeUndefined();
  rmSync(contract);
  rmSync(tasks);
}

async function confirmed(verification = DEFAULT_CHECKS): Promise<void> {
  await addMilestone(verification);
  const { error } = await run(['milestone-confirm', 'M001'], root);
  expect(error).toBeUndefined();
}

function milestoneDirName(id: string): string {
  const dir = join(root, '.pitway', 'milestones');
  const match = readdirSync(dir).find((e) => e === id || e.startsWith(`${id}-`));
  if (!match) throw new Error(`no milestone directory found for ${id}`);
  return match;
}

const contractPath = (): string => join(root, '.pitway', 'milestones', milestoneDirName('M001'), 'contract.md');

function editContract(transform: (text: string) => string): void {
  writeFileSync(contractPath(), transform(readFileSync(contractPath(), 'utf8')));
}

const results = (): Array<{
  check: string;
  status: string;
  at: string;
  evidence: string;
  recorded_by: string;
  duration_ms?: number;
  termination_reason?: string;
}> => loadVerificationResults(root, 'M001').results;

interface RunView {
  passed: boolean;
  results: Array<{ check: string; status: string; evidence: string }>;
  pending: string[];
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'pitway-verify-'));
  git(['init', '-q'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  writeFileSync(join(root, 'README.md'), 'seed\n');
  git(['add', 'README.md'], root);
  git(['commit', '-q', '-m', 'init'], root);
  await run(['init'], root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('pitway verify hash gate (AC001)', () => {
  it('refuses an unconfirmed milestone, executing and recording nothing', async () => {
    await addMilestone();
    const { error } = await run(['verify'], root);
    expect(error?.message).toMatch(/approved verification hash/);
    expect(error?.message).toMatch(/confirm/);
    expect(results()).toEqual([]);
  });

  it('refuses a hash mismatch before executing or recording anything', async () => {
    await confirmed();
    editContract((text) => text.replace('command: echo ok', 'command: touch pwned.txt'));

    const { error } = await run(['verify'], root);
    expect(error?.message).toMatch(/hash/);
    expect(error?.message).toMatch(/does not match/);
    // The tampered command never ran and nothing was recorded.
    expect(existsSync(join(root, 'pwned.txt'))).toBe(false);
    expect(results()).toEqual([]);

    // Developer recording is behind the same gate.
    const record = await run(['verify', '--check', 'CT003', '--pass', '--evidence', 'x'], root);
    expect(record.error?.message).toMatch(/hash/);
    expect(results()).toEqual([]);
  });

  it('works again after a milestone-confirm --amend re-approval', async () => {
    await confirmed();
    editContract((text) =>
      text
        .replace('command: echo ok', 'command: echo amended')
        .replace('## Change Log', '## Change Log\n\n- Adjusted CT002.'),
    );
    const refused = await run(['verify'], root);
    expect(refused.error?.message).toMatch(/hash/);

    // M005/T004: --amend no longer reads the hand-edited live contract.md —
    // it requires a validated --file draft carrying the desired content.
    const amendDraft = join(root, 'amend-draft.md');
    writeFileSync(amendDraft, readFileSync(contractPath(), 'utf8'));
    const amend = await run(['milestone-confirm', 'M001', '--amend', '--file', amendDraft], root);
    expect(amend.error).toBeUndefined();

    const { lines, error } = await run(['verify', '--json'], root);
    expect(error).toBeUndefined();
    const view = JSON.parse(lines[0]!) as RunView;
    expect(view.passed).toBe(true);
    const recorded = results();
    expect(recorded.map((r) => [r.check, r.status])).toEqual([
      ['CT001', 'pass'],
      ['CT002', 'pass'],
    ]);
    // The re-approved (amended) command is what executed.
    expect(recorded[1]!.evidence).toBe('amended');
  });
});

describe('pitway verify command checks (AC002)', () => {
  it('runs only approved command checks in contract order with trimmed evidence', async () => {
    await confirmed();
    const before = commitCount(root);
    const { lines, error } = await run(['verify', 'M001', '--json'], root);
    expect(error).toBeUndefined();

    const view = JSON.parse(lines[0]!) as RunView;
    expect(view.passed).toBe(true);
    expect(view.pending).toEqual(['CT003']);

    const recorded = results();
    expect(recorded.map((r) => [r.check, r.status, r.recorded_by])).toEqual([
      ['CT001', 'pass', 'command'],
      ['CT002', 'pass', 'command'],
    ]);
    expect(recorded[0]!.evidence).toBe('hello');
    for (const r of recorded) {
      expect(r.at).toMatch(TIMESTAMP_RE);
    }
    // verify records results locally; committing happens at a later boundary.
    expect(commitCount(root)).toBe(before);
    expect(git(['status', '--porcelain'], root)).toMatch(/verification-results\.yaml/);
  });

  it('records and reports a failing check without hiding other results', async () => {
    await confirmed(FAILING_CHECKS);
    const { lines, error } = await run(['verify', '--json'], root);
    expect(error).toBeUndefined();

    const view = JSON.parse(lines[0]!) as RunView;
    expect(view.passed).toBe(false);

    const recorded = results();
    expect(recorded.map((r) => [r.check, r.status])).toEqual([
      ['CT001', 'pass'],
      ['CT002', 'fail'],
    ]);
    expect(recorded[1]!.evidence).toContain('boom');
  });

  it("prefixes a failing check's evidence with a failures: summary naming the failing test (AC004)", async () => {
    await confirmed(FAILING_CHECKS_WITH_SUMMARY);
    const { error } = await run(['verify'], root);
    expect(error).toBeUndefined();

    const recorded = results();
    expect(recorded[0]!.status).toBe('fail');
    expect(recorded[0]!.evidence.startsWith('failures: FAIL src/x.test.ts > it fails\n')).toBe(true);
    expect(recorded[0]!.evidence).toContain('FAIL src/x.test.ts > it fails');
  });

  it('caps evidence at 200 characters', async () => {
    const longChecks = `  - id: CT001
    criterion: AC001
    type: command
    command: echo ${'x'.repeat(260)}
`;
    await confirmed(longChecks);
    const { error } = await run(['verify'], root);
    expect(error).toBeUndefined();
    expect(results()[0]!.evidence.length).toBe(200);
  });
});

describe('pitway verify --check developer recording (AC003)', () => {
  it('records manual checks as recorded_by developer', async () => {
    await confirmed();
    const { lines, error } = await run(
      ['verify', '--check', 'CT003', '--pass', '--evidence', 'docs reviewed', '--json'],
      root,
    );
    expect(error).toBeUndefined();
    const view = JSON.parse(lines[0]!) as { check: string; status: string };
    expect(view).toMatchObject({ check: 'CT003', status: 'pass' });

    const recorded = results();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      check: 'CT003',
      status: 'pass',
      evidence: 'docs reviewed',
      recorded_by: 'developer',
    });
    expect(recorded[0]!.at).toMatch(TIMESTAMP_RE);
  });

  it('refuses unknown check ids', async () => {
    await confirmed();
    const { error } = await run(['verify', '--check', 'CT099', '--pass', '--evidence', 'x'], root);
    expect(error?.message).toMatch(/CT099/);
    expect(results()).toEqual([]);
  });

  it('refuses developer recording of a command-type check', async () => {
    await confirmed();
    const { error } = await run(['verify', '--check', 'CT001', '--pass', '--evidence', 'x'], root);
    expect(error?.message).toMatch(/command/);
    expect(results()).toEqual([]);
  });

  it('refuses missing --evidence and ambiguous --pass/--fail', async () => {
    await confirmed();
    const noEvidence = await run(['verify', '--check', 'CT003', '--pass'], root);
    expect(noEvidence.error?.message).toMatch(/--evidence/);

    const both = await run(
      ['verify', '--check', 'CT003', '--pass', '--fail', '--evidence', 'x'],
      root,
    );
    expect(both.error?.message).toMatch(/--pass or --fail/);

    const neither = await run(['verify', '--check', 'CT003', '--evidence', 'x'], root);
    expect(neither.error?.message).toMatch(/--pass or --fail/);

    expect(results()).toEqual([]);
  });

  it('refuses --pass/--fail/--evidence without --check', async () => {
    await confirmed();
    const { error } = await run(['verify', '--pass'], root);
    expect(error?.message).toMatch(/--check/);
    expect(results()).toEqual([]);
  });
});

describe('pitway verify append-only results (AC004)', () => {
  it('appends fresh results on re-run without erasing history', async () => {
    await confirmed();
    await run(['verify'], root);
    const first = results();
    expect(first).toHaveLength(2);

    const { error } = await run(['verify'], root);
    expect(error).toBeUndefined();
    const second = results();
    expect(second).toHaveLength(4);
    // History is preserved verbatim; fresh entries follow it.
    expect(second.slice(0, 2)).toEqual(first);
    expect(second.map((r) => r.check)).toEqual(['CT001', 'CT002', 'CT001', 'CT002']);
  });

  it('keeps every developer recording; the latest per check is authoritative', async () => {
    await confirmed();
    await run(['verify', '--check', 'CT003', '--fail', '--evidence', 'docs missing'], root);
    const { error } = await run(
      ['verify', '--check', 'CT003', '--pass', '--evidence', 'docs added'],
      root,
    );
    expect(error).toBeUndefined();

    const recorded = results();
    expect(recorded.map((r) => [r.check, r.status])).toEqual([
      ['CT003', 'fail'],
      ['CT003', 'pass'],
    ]);
    // Latest entry for CT003 is the authoritative one.
    expect(recorded[recorded.length - 1]!.status).toBe('pass');
  });
});

describe('pitway verify milestone resolution', () => {
  it('refuses when no id is given and no milestone is active', async () => {
    const { error } = await run(['verify'], root);
    expect(error?.message).toMatch(/active milestone/);
  });
});

// T002: incremental persistence -- appendResults is called once per
// completed check, not once after the whole loop. Proven for real: CT002's
// own command shells out and reads verification-results.yaml off disk,
// asserting CT001's entry is already there while CT002 itself is still
// running (the glob tolerates the slugged milestone directory name).
describe('pitway verify incremental persistence (T002)', () => {
  it("persists CT001's result to disk before CT002 runs, not only after the full loop", async () => {
    const checks = `  - id: CT001
    criterion: AC001
    type: command
    command: echo first
  - id: CT002
    criterion: AC001
    type: command
    command: grep -q 'CT001' .pitway/milestones/M001*/verification-results.yaml && echo found-CT001-on-disk
`;
    await confirmed(checks);
    const { error } = await run(['verify'], root);
    expect(error).toBeUndefined();

    const recorded = results();
    expect(recorded.map((r) => [r.check, r.status])).toEqual([
      ['CT001', 'pass'],
      ['CT002', 'pass'],
    ]);
    expect(recorded[1]!.evidence).toContain('found-CT001-on-disk');
  });
});

// T002/AC003: per-check timeout_ms, and the duration_ms/termination_reason
// fields that report it.
describe('pitway verify per-check timeout_ms (T002)', () => {
  it('applies a per-check timeout_ms, killing a hung command in bounded time and recording it as a timeout', async () => {
    const checks = `  - id: CT001
    criterion: AC001
    type: command
    command: sleep 30
    timeout_ms: 300
`;
    await confirmed(checks);
    const start = Date.now();
    const { error } = await run(['verify'], root);
    const elapsed = Date.now() - start;
    expect(error).toBeUndefined();
    // Bounded well below both the 30s command and the 120s default -- proves
    // timeout_ms, not the safe default, is what ended it. 15s, not tighter:
    // spawn + kill + bookkeeping needs headroom under a concurrently loaded
    // machine (B042 / M016's real-subprocess contention class); a completed
    // `sleep 30` would still blow this bound.
    expect(elapsed).toBeLessThan(15000);

    const recorded = results();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.status).toBe('fail');
    expect(recorded[0]!.termination_reason).toBe('timeout');
    expect(typeof recorded[0]!.duration_ms).toBe('number');
    expect(recorded[0]!.duration_ms!).toBeGreaterThanOrEqual(300);
  });

  it('records duration_ms and termination_reason "exited" for an ordinary passing command', async () => {
    await confirmed();
    const { error } = await run(['verify'], root);
    expect(error).toBeUndefined();
    for (const r of results()) {
      expect(typeof r.duration_ms).toBe('number');
      expect(r.termination_reason).toBe('exited');
    }
  });
});

// T002/AC009-AC011: isolated single-check rerun.
describe('pitway verify --check isolated command rerun (T002)', () => {
  it('reruns exactly one command check through the hash-gated, timeout-protected path and appends a fresh entry', async () => {
    await confirmed();
    const first = await run(['verify'], root);
    expect(first.error).toBeUndefined();
    expect(results()).toHaveLength(2);

    const { lines, error } = await run(['verify', '--check', 'CT001', '--json'], root);
    expect(error).toBeUndefined();
    const view = JSON.parse(lines[0]!) as { id: string; mode: string; check: string; status: string };
    expect(view).toMatchObject({ id: 'M001', mode: 'check-run', check: 'CT001', status: 'pass' });

    const recorded = results();
    expect(recorded.map((r) => r.check)).toEqual(['CT001', 'CT002', 'CT001']);
    expect(recorded[2]!.recorded_by).toBe('command');
  });

  it('refuses an isolated rerun of a manual/review check with a clear message, recording nothing', async () => {
    await confirmed();
    const { error } = await run(['verify', '--check', 'CT003'], root);
    expect(error?.message).toMatch(/manual/);
    expect(results()).toEqual([]);
  });

  it('leaves the existing manual/review --check --pass/--fail/--evidence path unchanged', async () => {
    await confirmed();
    const { error } = await run(
      ['verify', '--check', 'CT003', '--pass', '--evidence', 'reviewed by hand'],
      root,
    );
    expect(error).toBeUndefined();
    expect(results()).toMatchObject([{ check: 'CT003', status: 'pass', recorded_by: 'developer' }]);
  });

  it('never runs automatically: a timed-out attempt and a later isolated rerun are two distinct entries', async () => {
    const checks = `  - id: CT001
    criterion: AC001
    type: command
    command: sleep 30
    timeout_ms: 300
`;
    await confirmed(checks);
    await run(['verify'], root);
    expect(results()).toHaveLength(1);
    expect(results()[0]!.termination_reason).toBe('timeout');

    const { error } = await run(['verify', '--check', 'CT001'], root);
    expect(error).toBeUndefined();
    const recorded = results();
    expect(recorded).toHaveLength(2);
    expect(recorded.every((r) => r.check === 'CT001')).toBe(true);
    expect(recorded[1]!.termination_reason).toBe('timeout');
  });
});

// T002/AC004-AC006: the recursion guard. Both fixture scripts below run as
// real, separate `node` processes spawned by executeCommand -- they inherit
// PITWAY_VERIFY_GUARD exactly as a literal recursive `pitway verify` command
// check would, and evaluate it with the real, unmocked evaluateRecursionGuard.
//
// Test-isolation hotfix: every test below sets its own PITWAY_VERIFY_GUARD
// starting condition EXPLICITLY via `vi.stubEnv`, rather than assuming the
// ambient environment starts clean. That assumption held as long as this
// suite only ever ran standalone; it stopped holding the first time M006
// dogfooded `pitway verify` on its own live milestone, whose own outer
// invocation sets a real PITWAY_VERIFY_GUARD token before spawning this
// exact test file as CT002's child process -- these tests then inherited
// that ambient token and failed. `vi.stubEnv`/`vi.unstubAllEnvs` (restored
// in this describe block's own afterEach, so it runs even on failure) is
// vitest's own sanctioned mechanism for this: the underlying call chain
// (runVerification -> withRecursionGuard's synchronous callback -> the
// spawnSync-based executeCommand loop) is entirely synchronous with no
// `await` inside it, so the stub-set-run-restore sequence for any one test
// cannot be interleaved with another test's own env access -- it does not
// rely on real OS-process isolation, but on there being no yield point for
// anything else to run during it. Production code (run.ts,
// recursion-guard.ts, process-exec.ts, text-trim.ts) and the evidence cap
// are unchanged by this fix -- the guard's own extend/refuse behavior in
// both tests below was already correct; only the tests' unstated
// environmental assumption was wrong.
describe('pitway verify recursion guard (T002)', () => {
  let rootB: string;

  beforeEach(() => {
    rootB = mkdtempSync(join(tmpdir(), 'pitway-verify-guard-b-'));
    git(['init', '-q'], rootB);
    git(['config', 'user.email', 'test@example.com'], rootB);
    git(['config', 'user.name', 'Test'], rootB);
    writeFileSync(join(rootB, 'README.md'), 'seed\n');
    git(['add', 'README.md'], rootB);
    git(['commit', '-q', '-m', 'init'], rootB);
  });

  afterEach(() => {
    rmSync(rootB, { recursive: true, force: true });
    // Restores PITWAY_VERIFY_GUARD (and any other stubbed var) to whatever
    // it was before this test's own vi.stubEnv call -- runs even if the
    // test itself failed, so one test's stub can never leak into the next.
    vi.unstubAllEnvs();
  });

  it('two nested invocations against two different temp-repo fixtures both succeed without tripping the guard', async () => {
    // CT001's command "nests" into a verification of rootB (a different
    // repo, same milestone id string) -- the real guard must extend, not
    // refuse, since the tokens differ on git-dir.
    const checks = `  - id: CT001
    criterion: AC001
    type: command
    command: node nested-check.mjs
`;
    await confirmed(checks);
    // Written after milestone-confirm: the fixture script is a verify-time
    // input, not milestone content, and must not trip the clean-tree gate.
    writeFileSync(join(root, 'nested-check.mjs'), recursionCheckScript(rootB, 'M001'));

    // Explicit clean-start condition: no ambient auto-run/verify guard token
    // when this test's own outer `pitway verify` begins.
    vi.stubEnv('PITWAY_VERIFY_GUARD', undefined);
    const start = Date.now();
    const { error } = await run(['verify'], root);
    const elapsed = Date.now() - start;
    expect(error).toBeUndefined();
    // Anti-hang bound: discriminates the guard acting from the 120000ms
    // default timeout. 20s, not tighter -- node startup for the nested
    // check script needs headroom under a concurrently loaded machine
    // (B042 / M016's real-subprocess contention class).
    expect(elapsed).toBeLessThan(20000);

    const recorded = results();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.status).toBe('pass');
    expect(recorded[0]!.evidence).toContain('RECURSION_OK');
  });

  it('a real recursive invocation for the SAME live repo/milestone is refused in bounded time, preserving already-completed checks', async () => {
    // CT002's command "nests" into a verification of the SAME repo+milestone
    // that is already running -- the real guard must refuse.
    const checks = `  - id: CT001
    criterion: AC001
    type: command
    command: echo already-completed
  - id: CT002
    criterion: AC001
    type: command
    command: node nested-check.mjs
`;
    await confirmed(checks);
    // Written after milestone-confirm: the fixture script is a verify-time
    // input, not milestone content, and must not trip the clean-tree gate.
    writeFileSync(join(root, 'nested-check.mjs'), recursionCheckScript(root, 'M001'));

    // Explicit clean-start condition -- see the describe block's own comment.
    vi.stubEnv('PITWAY_VERIFY_GUARD', undefined);
    const start = Date.now();
    const { error } = await run(['verify'], root);
    const elapsed = Date.now() - start;
    expect(error).toBeUndefined();
    // Bounded by the guard's immediate refusal, not by any configured
    // timeout (the default is 120000ms) -- a hang would blow this budget.
    // 20s, not tighter: load headroom, see the sibling test above (B042).
    expect(elapsed).toBeLessThan(20000);

    const recorded = results();
    expect(recorded).toHaveLength(2);
    // CT001's already-completed result survives CT002's refusal untouched.
    expect(recorded[0]).toMatchObject({ check: 'CT001', status: 'pass' });
    expect(recorded[1]!.check).toBe('CT002');
    expect(recorded[1]!.status).toBe('fail');
    expect(recorded[1]!.evidence).toContain('RECURSION_REFUSED');
    expect(recorded[1]!.termination_reason).not.toBe('timeout');
  });

  // Regression scenario (test-isolation hotfix): reproduces the exact
  // condition that caused this describe block's first test to fail the
  // first time M006 dogfooded `pitway verify` on its own live milestone --
  // a pre-existing, unrelated PITWAY_VERIFY_GUARD token (a genuinely
  // different repo AND a genuinely different milestone id, standing in for
  // a live outer verify invocation already in progress) is present in the
  // environment BEFORE this test's own outer verify call begins. The real
  // guard must still extend, not refuse -- nesting into an unrelated
  // repo/milestone is always legitimate, however many unrelated tokens are
  // already accumulated ahead of it.
  it('a pre-existing unrelated PITWAY_VERIFY_GUARD token does not block nesting into a different repo/milestone', async () => {
    const checks = `  - id: CT001
    criterion: AC001
    type: command
    command: node nested-check.mjs
`;
    await confirmed(checks);
    writeFileSync(join(root, 'nested-check.mjs'), recursionCheckScript(rootB, 'M001'));

    // The unrelated ambient token: a different repo entirely (rootB's own
    // git-dir) and a different milestone id (M999, never used by `root` or
    // `rootB` in this test) -- reproduces "some other live verify is
    // already in progress elsewhere" without depending on any real outer
    // process actually running.
    const rootBGitDir = git(['rev-parse', '--absolute-git-dir'], rootB).trim();
    vi.stubEnv('PITWAY_VERIFY_GUARD', `${rootBGitDir}#M999`);

    const start = Date.now();
    const { error } = await run(['verify'], root);
    const elapsed = Date.now() - start;
    expect(error).toBeUndefined();
    // 20s anti-hang bound, not tighter: load headroom, see above (B042).
    expect(elapsed).toBeLessThan(20000);

    const recorded = results();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.status).toBe('pass');
    expect(recorded[0]!.evidence).toContain('RECURSION_OK');
  });
});

// AC008 (M013): read-only status view, never executes anything, never
// mutates verification-results.yaml.
describe('pitway verify --status (M013/T001)', () => {
  interface StatusView {
    id: string;
    checks: Array<{ check: string; status: string }>;
  }

  it('reports pending for every check before any run, without executing or recording anything', async () => {
    await confirmed();
    const before = commitCount(root);
    const { lines, error } = await run(['verify', '--status', '--json'], root);
    expect(error).toBeUndefined();
    const view = JSON.parse(lines[0]!) as StatusView;
    expect(view.checks).toEqual([
      { check: 'CT001', status: 'pending' },
      { check: 'CT002', status: 'pending' },
      { check: 'CT003', status: 'pending' },
    ]);
    expect(results()).toEqual([]);
    expect(commitCount(root)).toBe(before);
  });

  it('reflects previously recorded results without re-executing command checks', async () => {
    await confirmed(FAILING_CHECKS);
    await run(['verify'], root);
    await run(['verify', '--check', 'CT003', '--pass', '--evidence', 'docs reviewed'], root);
    const recordedBefore = results().length;

    const { lines, error } = await run(['verify', '--status', '--json'], root);
    expect(error).toBeUndefined();
    const view = JSON.parse(lines[0]!) as StatusView;
    expect(view.checks).toEqual([
      { check: 'CT001', status: 'pass' },
      { check: 'CT002', status: 'fail' },
      { check: 'CT003', status: 'pass' },
    ]);
    // Nothing was appended by --status itself.
    expect(results().length).toBe(recordedBefore);
  });

  it('works for an unconfirmed (draft) milestone, unlike bare verify', async () => {
    await addMilestone();
    const { lines, error } = await run(['verify', '--status', '--json'], root);
    expect(error).toBeUndefined();
    const view = JSON.parse(lines[0]!) as StatusView;
    expect(view.checks.every((c) => c.status === 'pending')).toBe(true);
  });

  it('refuses when combined with --check/--pass/--fail/--evidence', async () => {
    await confirmed();
    const { error } = await run(
      ['verify', '--status', '--check', 'CT003', '--pass', '--evidence', 'x'],
      root,
    );
    expect(error?.message).toMatch(/--status/);
  });

  it('accepts an explicit milestone id instead of resolving the active one', async () => {
    await confirmed();
    const { lines, error } = await run(['verify', 'M001', '--status', '--json'], root);
    expect(error).toBeUndefined();
    const view = JSON.parse(lines[0]!) as StatusView;
    expect(view.id).toBe('M001');
    expect(view.checks).toHaveLength(3);
  });

  it('refuses when no id is given and no milestone is active', async () => {
    await confirmed();
    saveState(root, { ...loadState(root), active_milestone: null });
    const { error } = await run(['verify', '--status'], root);
    expect(error?.message).toMatch(/no active milestone/);
  });

  it('renders the human status view with pass, fail, and pending labels', async () => {
    await confirmed(FAILING_CHECKS);
    await run(['verify'], root);

    const { lines, error } = await run(['verify', '--status'], root);
    expect(error).toBeUndefined();
    const output = lines.join('\n');
    expect(output).toContain('🔍 Verification status M001');
    expect(output).toContain('CT001  ✅ pass');
    expect(output).toContain('CT002  ❌ fail');
    expect(output).toContain('CT003  ⏳ pending');
  });
});

describe('pitway verify --check isolated rerun human rendering', () => {
  it('renders a passing isolated rerun without --json', async () => {
    await confirmed();
    const { lines, error } = await run(['verify', '--check', 'CT001'], root);
    expect(error).toBeUndefined();
    expect(lines.join('\n')).toMatch(/🔍 CT001 {2}✅ pass — hello \(M001\)/);
  });
});

// The default CommandDeps fallbacks (deps.write ?? console.log,
// deps.root ?? process.cwd()) are only reached when a caller registers the
// command with no overrides -- the real shape a bare `pitway verify`
// invocation takes outside this test file's harness.
describe('pitway verify default CommandDeps fallbacks', () => {
  it('falls back to console.log and process.cwd() when no overrides are given', async () => {
    await confirmed();

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cwdBefore = process.cwd();
    process.chdir(root);
    let caught: unknown;
    let calls: unknown[][] = [];
    try {
      const program = buildCli();
      registerVerifyCommand(program);
      await program.parseAsync(['node', 'pitway', 'verify', '--status']);
    } catch (error) {
      caught = error;
    } finally {
      calls = logSpy.mock.calls;
      process.chdir(cwdBefore);
      logSpy.mockRestore();
    }

    expect(caught).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.[0])).toContain('🔍 Verification status M001');
  });
});

// M036/T002: the racing footer on verify's mutating paths (run, single-check
// run, record), guarded to the active milestone; never on --status.
describe('pitway verify racing footer (M036/T002)', () => {
  it('appends the footer for a run against the active milestone', async () => {
    await confirmed();
    const { error, lines } = await run(['verify', 'M001'], root);
    expect(error).toBeUndefined();
    expect(lines[lines.length - 1]).toMatch(/🏎️|🏁|🔧/);
  });

  it('never appends a footer for a run against a milestone other than the active one', async () => {
    await confirmed();
    // Point active_milestone elsewhere -- verify still targets M001
    // explicitly, so this proves the guard, not milestone-add's own
    // single-active-milestone constraint.
    saveState(root, { ...loadState(root), active_milestone: 'M999' });
    const { error, lines } = await run(['verify', 'M001'], root);
    expect(error).toBeUndefined();
    expect(lines[lines.length - 1]).not.toMatch(/🏎️|🏁|🔧/);
  });

  it('never appends a footer to --status even against the active milestone', async () => {
    await confirmed();
    const { error, lines } = await run(['verify', 'M001', '--status'], root);
    expect(error).toBeUndefined();
    expect(lines).toHaveLength(1);
  });

  it('never appends a footer line in --json mode', async () => {
    await confirmed();
    const { error, lines } = await run(['verify', 'M001', '--json'], root);
    expect(error).toBeUndefined();
    expect(lines).toHaveLength(1);
  });
});

// M036/T003: the milestone-complete hint, gated on the real completion
// precondition (allChecksPassed + full task completion) -- never on
// VerifyRunView's own passed/pending fields, which stay non-empty for a
// pending manual check even once it's recorded pass.
describe('pitway verify milestone-complete hint (M036/T003)', () => {
  function markAllTasksCompleted(): void {
    const tasksFile = loadTasks(root, 'M001');
    saveTasks(root, 'M001', {
      ...tasksFile,
      tasks: tasksFile.tasks.map((t) => ({ ...t, status: 'completed' })),
    });
  }

  it('never appears on a run alone (DEFAULT_CHECKS leaves CT003 pending)', async () => {
    await confirmed();
    markAllTasksCompleted();
    const { error, lines } = await run(['verify', 'M001'], root);
    expect(error).toBeUndefined();
    expect(lines.join('\n')).not.toContain('milestone-complete M001');
  });

  it('appears once the last pending check is recorded pass AND every task is completed', async () => {
    await confirmed();
    markAllTasksCompleted();
    await run(['verify', 'M001'], root); // records CT001/CT002 pass, CT003 stays pending
    const { error, lines } = await run(
      ['verify', 'M001', '--check', 'CT003', '--pass', '--evidence', 'docs reviewed'],
      root,
    );
    expect(error).toBeUndefined();
    expect(lines.join('\n')).toContain('milestone-complete M001');
    expect(lines.join('\n')).toContain('developer approval');
  });

  it('does not appear when checks all pass but a required task is not yet completed', async () => {
    await confirmed(); // T001 stays 'planned' -- never marked completed
    await run(['verify', 'M001'], root);
    const { error, lines } = await run(
      ['verify', 'M001', '--check', 'CT003', '--pass', '--evidence', 'docs reviewed'],
      root,
    );
    expect(error).toBeUndefined();
    expect(lines.join('\n')).not.toContain('milestone-complete M001');
  });

  it('never appears on --status', async () => {
    await confirmed();
    markAllTasksCompleted();
    await run(['verify', 'M001'], root);
    await run(['verify', 'M001', '--check', 'CT003', '--pass', '--evidence', 'docs reviewed'], root);
    const { error, lines } = await run(['verify', 'M001', '--status'], root);
    expect(error).toBeUndefined();
    expect(lines.join('\n')).not.toContain('milestone-complete M001');
  });

  it('never appears in --json mode', async () => {
    await confirmed();
    markAllTasksCompleted();
    await run(['verify', 'M001'], root);
    const { error, lines } = await run(
      ['verify', 'M001', '--check', 'CT003', '--pass', '--evidence', 'docs reviewed', '--json'],
      root,
    );
    expect(error).toBeUndefined();
    expect(lines).toHaveLength(1);
  });
});
