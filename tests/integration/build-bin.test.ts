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
  'init',
  'milestone-add',
  'milestone-complete',
  'milestone-confirm',
  'milestone-list',
  'milestone-status',
  'resume',
  'task-status',
  'task-amend',
  'task-update',
  'usage-add',
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

  it('copies every src/integrations/claude/ asset to dist/integrations/claude/ under the same relative layout', () => {
    const srcAssetsDir = join(repoRoot, 'src', 'integrations', 'claude');
    const distAssetsDir = join(repoRoot, 'dist', 'integrations', 'claude');
    const srcFiles = listFilesRecursive(srcAssetsDir);
    const distFiles = listFilesRecursive(distAssetsDir);
    expect(srcFiles.length).toBeGreaterThan(0);
    expect(distFiles).toEqual(srcFiles);
  });

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
      const view = JSON.parse(output) as { claudeInstalled: boolean };
      expect(view.claudeInstalled).toBe(true);

      const installedAsset = join(tempRepo, '.claude', 'protocol-driver.md');
      expect(existsSync(installedAsset)).toBe(true);
      expect(statSync(installedAsset).isFile()).toBe(true);
    });
  });
});
