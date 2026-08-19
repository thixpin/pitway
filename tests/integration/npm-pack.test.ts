import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// M008/T002/AC002: proves the npm packaging metadata decisions (name, version,
// files allowlist, license, author, repository, bugs, homepage) against a
// real, installed package -- never just the unpacked dist/ tree. This builds
// from a clean state (no pre-existing dist/) by deleting dist/ and letting
// `npm pack`'s own `prepack` lifecycle (wired in M008/T001) perform the real
// build, packs a real tarball into a throwaway temp directory, inspects the
// tarball's actual file list, installs that tarball into a separate fresh
// temp project (never npm link, never a workspace shortcut), and spawns that
// installed project's own real `pitway` binary. No npm publish or other
// registry-write command runs anywhere in this file; the only registry
// traffic is the ordinary dependency resolution `npm install <tarball>`
// performs for pitway's own runtime dependencies, exactly as a real end-user
// install would.

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const distDir = join(repoRoot, 'dist');

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

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'pipe', timeout: 15_000 });
}

let packDestination: string;
let tarballPath: string;
let installProject: string;
let installedBinary: string;

beforeAll(() => {
  // Clean state: no pre-existing dist/, so the `npm pack` run below exercises
  // the real `prepack` lifecycle (npm run build) from M008/T001, not a stale
  // build from an earlier test file.
  rmSync(distDir, { recursive: true, force: true });

  packDestination = mkdtempSync(join(tmpdir(), 'pitway-npm-pack-dest-'));
  const packOutput = execFileSync(
    'npm',
    ['pack', '--pack-destination', packDestination, '--json'],
    {
      cwd: repoRoot,
      stdio: 'pipe',
      timeout: 180_000,
    },
  ).toString();
  const [manifest] = JSON.parse(packOutput) as [{ filename: string }];
  tarballPath = join(packDestination, manifest.filename);
  expect(existsSync(tarballPath)).toBe(true);

  installProject = mkdtempSync(join(tmpdir(), 'pitway-npm-pack-install-'));
  writeFileSync(
    join(installProject, 'package.json'),
    JSON.stringify({ name: 'pitway-install-check', version: '0.0.0', private: true }, null, 2),
  );
  execFileSync('npm', ['install', tarballPath], {
    cwd: installProject,
    stdio: 'pipe',
    timeout: 180_000,
  });

  installedBinary = join(installProject, 'node_modules', '.bin', 'pitway');
  expect(existsSync(installedBinary)).toBe(true);
}, 240_000);

afterAll(() => {
  rmSync(packDestination, { recursive: true, force: true });
  rmSync(installProject, { recursive: true, force: true });
});

describe('npm pack produces a real, installable tarball (M008/T002/AC002)', () => {
  it('packs the tarball with exactly the allowlisted files, never src/ or tests/', () => {
    const listing = execFileSync('tar', ['-tzf', tarballPath], { stdio: 'pipe', timeout: 15_000 })
      .toString()
      .trim()
      .split('\n')
      .map((p) => p.replace(/^package\//, ''));

    expect(listing).toContain('package.json');
    expect(listing).toContain('LICENSE');
    expect(listing.some((p) => p.startsWith('dist/cli/index.js'))).toBe(true);
    expect(listing.some((p) => p.startsWith('src/'))).toBe(false);
    expect(listing.some((p) => p.startsWith('tests/'))).toBe(false);
  });

  it('installs into a fresh temp project with the real installed binary present', () => {
    expect(existsSync(installedBinary)).toBe(true);
  });

  it('records the exact approved author/repository/bugs/homepage metadata in the packed package.json', () => {
    const packedPackageJsonPath = join(installProject, 'node_modules', 'pitway', 'package.json');
    const packedPackageJson = JSON.parse(readFileSync(packedPackageJsonPath, 'utf8')) as Record<string, unknown>;

    expect(packedPackageJson.name).toBe('pitway');
    expect(packedPackageJson.license).toBe('MIT');
    expect(packedPackageJson.author).toEqual({ name: 'thixpin', url: 'https://github.com/thixpin' });
    expect(packedPackageJson.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/thixpin/pitway.git',
    });
    expect(packedPackageJson.bugs).toEqual({ url: 'https://github.com/thixpin/pitway/issues' });
    expect(packedPackageJson.homepage).toBe('https://github.com/thixpin/pitway#readme');
    expect(packedPackageJson).not.toHaveProperty('main');
    expect(packedPackageJson).not.toHaveProperty('exports');
  });

  describe('real subprocess spawn of the installed binary', () => {
    it('reaches --help', () => {
      const output = execFileSync('node', [installedBinary, '--help'], {
        cwd: installProject,
        stdio: 'pipe',
        timeout: 15_000,
      }).toString();
      expect(output).toContain('pitway');
    });

    it.each(ALL_COMMAND_NAMES)('registers and reaches "%s" via --help', (name) => {
      const output = execFileSync('node', [installedBinary, name, '--help'], {
        cwd: installProject,
        stdio: 'pipe',
        timeout: 15_000,
      }).toString();
      expect(output).toContain(name);
    });

    it('succeeds with representative --json output and exit code 0', () => {
      const tempRepo = mkdtempSync(join(tmpdir(), 'pitway-npm-pack-json-'));
      try {
        git(['init', '-q'], tempRepo);
        git(['config', 'user.email', 'test@example.com'], tempRepo);
        git(['config', 'user.name', 'Test'], tempRepo);

        const output = execFileSync('node', [installedBinary, 'init', '--json'], {
          cwd: tempRepo,
          stdio: 'pipe',
          timeout: 15_000,
        }).toString();
        const view = JSON.parse(output) as { claudeInstalled: boolean };
        expect(view.claudeInstalled).toBe(true);

        const installedAsset = join(tempRepo, '.claude', 'protocol-driver.md');
        expect(existsSync(installedAsset)).toBe(true);
      } finally {
        rmSync(tempRepo, { recursive: true, force: true });
      }
    });

    it('fails an unknown command with a non-zero exit code', () => {
      expect(() =>
        execFileSync('node', [installedBinary, 'not-a-real-command'], {
          cwd: installProject,
          stdio: 'pipe',
          timeout: 15_000,
        }),
      ).toThrow();
    });
  });
});
