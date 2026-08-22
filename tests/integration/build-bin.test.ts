import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// M008/T001/AC001: closes the M004/T007 finding that Node's native TS loader
// does not remap this repo's `.js` import specifiers to `.ts` sources, so the
// previous `bin` (`./src/cli/index.ts`, executed directly) failed with
// ERR_MODULE_NOT_FOUND. This test proves the real, tsc-compiled dist/
// artifact is genuinely npm-installable and real-subprocess-invokable: it
// runs `npm run build` for real, then spawns the compiled dist/cli/index.js
// as a real `node` subprocess (never `npx tsx`, never `--experimental-*`
// flags) -- mirroring tests/integration/cli.test.ts's per-command
// reachability discipline, but against the real compiled output this time.

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const distEntry = join(repoRoot, 'dist', 'cli', 'index.js');

const ALL_COMMAND_NAMES = [
  'auto-run',
  'backlog',
  'init',
  'milestone-add',
  'milestone-cancel',
  'milestone-complete',
  'milestone-confirm',
  'milestone-list',
  'milestone-merge',
  'milestone-review',
  'milestone-status',
  'quick-change',
  'resume',
  'task-status',
  'task-add',
  'task-amend',
  'task-discard',
  'task-dispatch',
  'task-integrate',
  'task-update',
  'task-verify',
  'usage-add',
  'verification-repair',
  'verify',
  'write-ms-artifacts',
].sort();

function listFilesRecursive(dir: string, base: string = dir): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(full, base));
    } else if (entry.isFile()) {
      files.push(relative(base, full));
    }
  }
  return files.sort();
}

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

beforeAll(() => {
  // Real build, foreground, bounded timeout -- this actually invokes tsc and
  // the copy script; it is not mocked or skipped.
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'pipe', timeout: 120_000 });
}, 120_000);

describe('build produces a real, spawnable dist/ binary (M008/T001/AC001)', () => {
  it('emits dist/cli/index.js', () => {
    expect(existsSync(distEntry)).toBe(true);
    expect(statSync(distEntry).isFile()).toBe(true);
  });

  // M023/T001: both source tiers ship -- dist/state/driver-assets.js
  // resolves from dist/integrations/<driver>/ AND dist/integrations/common/.
  // M023/T002: the opencode driver directory rides the same whole-tree copy.
  it.each(['claude', 'common', 'opencode'])(
    'copies every src/integrations/%s/ asset to dist/integrations/ under the same relative layout',
    (tier) => {
      const srcAssetsDir = join(repoRoot, 'src', 'integrations', tier);
      const distAssetsDir = join(repoRoot, 'dist', 'integrations', tier);
      const srcFiles = listFilesRecursive(srcAssetsDir);
      const distFiles = listFilesRecursive(distAssetsDir);
      expect(srcFiles.length).toBeGreaterThan(0);
      expect(distFiles).toEqual(srcFiles);
    },
  );

  describe('real subprocess spawn of the compiled binary', () => {
    it.each(ALL_COMMAND_NAMES)('registers and reaches "%s" via --help', (name) => {
      const output = execFileSync('node', [distEntry, name, '--help'], {
        cwd: repoRoot,
        stdio: 'pipe',
      }).toString();
      expect(output).toContain(name);
    });

    it.each(['enable', 'disable', 'status'])(
      'registers and reaches "auto-run %s" via --help',
      (subcommand) => {
        const output = execFileSync('node', [distEntry, 'auto-run', subcommand, '--help'], {
          cwd: repoRoot,
          stdio: 'pipe',
        }).toString();
        expect(output).toContain(subcommand);
      },
    );

    it.each(['add', 'list', 'show', 'promote', 'archive'])(
      'registers and reaches "backlog %s" via --help',
      (subcommand) => {
        const output = execFileSync('node', [distEntry, 'backlog', subcommand, '--help'], {
          cwd: repoRoot,
          stdio: 'pipe',
        }).toString();
        expect(output).toContain(subcommand);
      },
    );

    // M019/T003 (AC011) + post-M019 quick-change qc-7e6fb2a4 (ms-merge): the
    // 8 named milestone-* commands' ms-* aliases, reachable via the real
    // compiled binary too, not only the in-process construction
    // cli.test.ts already covers in depth.
    it.each([
      'ms-add',
      'ms-cancel',
      'ms-complete',
      'ms-confirm',
      'ms-list',
      'ms-merge',
      'ms-review',
      'ms-status',
    ])(
      'registers and reaches "%s" via --help on the real binary',
      (alias) => {
        const output = execFileSync('node', [distEntry, alias, '--help'], {
          cwd: repoRoot,
          stdio: 'pipe',
        }).toString();
        expect(output).toContain(alias);
      },
    );

    it('reports the package version', () => {
      const output = execFileSync('node', [distEntry, '--version'], {
        cwd: repoRoot,
        stdio: 'pipe',
      }).toString();
      expect(output.trim().length).toBeGreaterThan(0);
    });
  });

  describe('real init round trip in a throwaway temp repo', () => {
    // Fixed worker rule 1's explicit exception: `git` is run here only inside
    // a throwaway temp directory this test itself creates via mkdtempSync,
    // never against the real pitway repository or its own .git/.pitway/.
    let tempRepo: string;

    beforeAll(() => {
      tempRepo = mkdtempSync(join(tmpdir(), 'pitway-build-bin-'));
      git(['init', '-q'], tempRepo);
      git(['config', 'user.email', 'test@example.com'], tempRepo);
      git(['config', 'user.name', 'Test'], tempRepo);
    });

    afterAll(() => {
      rmSync(tempRepo, { recursive: true, force: true });
    });

    it('installs the Claude assets by default via a real spawned init', () => {
      const output = execFileSync('node', [distEntry, 'init', '--json'], {
        cwd: tempRepo,
        stdio: 'pipe',
      }).toString();
      const view = JSON.parse(output) as { claudeInstalled: boolean; opencodeInstalled: boolean };
      expect(view.claudeInstalled).toBe(true);
      // M023/T002: OpenCode is opt-in -- the default init never touches it.
      expect(view.opencodeInstalled).toBe(false);
      expect(existsSync(join(tempRepo, '.opencode'))).toBe(false);

      const installedAsset = join(tempRepo, '.claude', 'protocol-driver.md');
      expect(existsSync(installedAsset)).toBe(true);
      expect(statSync(installedAsset).isFile()).toBe(true);
    });

    // M023/T002 (AC006): the OpenCode opt-in round trip, in its own fresh
    // temp repo so it never depends on the default-init test above.
    it('installs the OpenCode assets via a real spawned `init --opencode`', () => {
      const opencodeRepo = mkdtempSync(join(tmpdir(), 'pitway-build-bin-opencode-'));
      try {
        git(['init', '-q'], opencodeRepo);
        git(['config', 'user.email', 'test@example.com'], opencodeRepo);
        git(['config', 'user.name', 'Test'], opencodeRepo);

        const output = execFileSync('node', [distEntry, 'init', '--opencode', '--json'], {
          cwd: opencodeRepo,
          stdio: 'pipe',
        }).toString();
        const view = JSON.parse(output) as { claudeInstalled: boolean; opencodeInstalled: boolean };
        expect(view.claudeInstalled).toBe(true);
        expect(view.opencodeInstalled).toBe(true);

        // AC006's explicit destination layout, resolved from the real
        // compiled dist/ assets: root-level protocol doc, command doc,
        // and skill.
        for (const path of [
          join('.opencode', 'protocol-driver.md'),
          join('.opencode', 'commands', 'milestone-status.md'),
          join('.opencode', 'skills', 'debugging', 'SKILL.md'),
        ]) {
          const installed = join(opencodeRepo, path);
          expect(existsSync(installed)).toBe(true);
          expect(statSync(installed).isFile()).toBe(true);
        }
      } finally {
        rmSync(opencodeRepo, { recursive: true, force: true });
      }
    });
  });

  // M017/T005 (AC003): the CLI's error boundary, only observable via a real
  // subprocess -- an in-process test never hits the unhandled-rejection
  // path this replaces.
  describe('the CLI error boundary (real subprocess)', () => {
    function runExpectingFailure(args: string[], cwd: string): { status: number; stderr: string } {
      try {
        execFileSync('node', [distEntry, ...args], { cwd, stdio: 'pipe' });
        throw new Error('expected the subprocess to exit non-zero');
      } catch (error) {
        const e = error as { status: number | null; stderr: Buffer };
        return { status: e.status ?? -1, stderr: e.stderr.toString() };
      }
    }

    it('a directory with no .pitway/ yields the actionable missing-state message, exit 1, no stack frames', () => {
      const bareRepo = mkdtempSync(join(tmpdir(), 'pitway-build-bin-bare-'));
      try {
        git(['init', '-q'], bareRepo);
        const { status, stderr } = runExpectingFailure(['resume'], bareRepo);
        expect(status).toBe(1);
        expect(stderr).toContain('pitway:');
        expect(stderr).toMatch(/pitway init/);
        expect(stderr).toMatch(/\.pitway\//);
        expect(stderr).not.toMatch(/^\s*at /m);
      } finally {
        rmSync(bareRepo, { recursive: true, force: true });
      }
    });

    it('an ordinary refusal in a real repo prints the message only, no stack frames', () => {
      const initedRepo = mkdtempSync(join(tmpdir(), 'pitway-build-bin-refusal-'));
      try {
        git(['init', '-q'], initedRepo);
        git(['config', 'user.email', 'test@example.com'], initedRepo);
        git(['config', 'user.name', 'Test'], initedRepo);
        execFileSync('node', [distEntry, 'init'], { cwd: initedRepo, stdio: 'pipe' });
        const { status, stderr } = runExpectingFailure(['milestone-confirm', 'M001'], initedRepo);
        expect(status).toBe(1);
        expect(stderr.trim()).toBe(stderr.split('\n')[0]!.trim());
        expect(stderr).not.toMatch(/^\s*at /m);
      } finally {
        rmSync(initedRepo, { recursive: true, force: true });
      }
    });

    // M020/T005 (AC006): renderCliError's other branch -- error.ts's
    // isPitwayError narrows only on constructor.name, so any thrown error
    // whose class is literally the builtin `Error` (rather than one of
    // PitWay's dedicated `*Error` subclasses, e.g. StateStoreError) is
    // classified as "unexpected" and keeps its stack. task-status's
    // resolveActiveMilestone does exactly this (`throw new Error('no active
    // milestone; run milestone-add first')`) -- confirmed the intuitive
    // alternative (malformed .pitway/state.yaml) does NOT hit this branch,
    // since state/store.ts's loadYaml always wraps a YAML parse failure in
    // StateStoreError, which isPitwayError treats as PitWay-authored.
    it('a genuine non-PitWay error (a bare `Error`, not a dedicated PitWay error class) DOES print a stack trace', () => {
      const initedRepo = mkdtempSync(join(tmpdir(), 'pitway-build-bin-stack-'));
      try {
        git(['init', '-q'], initedRepo);
        git(['config', 'user.email', 'test@example.com'], initedRepo);
        git(['config', 'user.name', 'Test'], initedRepo);
        execFileSync('node', [distEntry, 'init'], { cwd: initedRepo, stdio: 'pipe' });
        const { status, stderr } = runExpectingFailure(['task-status', 'T001'], initedRepo);
        expect(status).toBe(1);
        expect(stderr).toContain('pitway: no active milestone; run milestone-add first');
        expect(stderr).toMatch(/^\s*at /m);
      } finally {
        rmSync(initedRepo, { recursive: true, force: true });
      }
    });
  });
});
