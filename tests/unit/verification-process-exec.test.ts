import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TIMEOUT_MS,
  executeCommand,
} from '../../src/core/verification/process-exec.js';

const fixture = fileURLToPath(
  new URL('../fixtures/verification/hang-with-children.js', import.meta.url),
);

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntilDead(pid: number, maxMs = 3000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (!alive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !alive(pid);
}

describe('executeCommand', () => {
  const workDirs: string[] = [];
  afterEach(() => {
    for (const dir of workDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exports a safe default timeout of 120000ms', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(120000);
  });

  it('reports exited with exit code 0 for a normal successful command', () => {
    const result = executeCommand('exit 0', { cwd: process.cwd() });
    expect(result.terminationReason).toBe('exited');
    expect(result.exitCode).toBe(0);
  });

  it('reports exited with the real exit code for a normal nonzero exit', () => {
    const result = executeCommand('exit 3', { cwd: process.cwd() });
    expect(result.terminationReason).toBe('exited');
    expect(result.exitCode).toBe(3);
  });

  it('reports signal when the command terminates itself via a signal (not our timeout)', () => {
    const result = executeCommand('kill -TERM $$', {
      cwd: process.cwd(),
      timeoutMs: 5000,
    });
    expect(result.terminationReason).toBe('signal');
    expect(result.signal).toBe('SIGTERM');
  });

  it('reports spawn_error when the command can never be spawned (nonexistent cwd)', () => {
    const result = executeCommand('true', { cwd: '/no/such/directory/for/pitway-test-xyz' });
    expect(result.terminationReason).toBe('spawn_error');
  });

  // AC001 / T001: real POSIX descendant-process fixture. Spawns a process
  // that ignores SIGTERM and forks a child (also ignoring SIGTERM) which
  // inherits its stdio. Proves, via real process inspection (not mocks),
  // that a timeout leaves zero survivors -- both the fixture and its child
  // are actually gone, not merely unresponsive.
  it('kills the full descendant tree on timeout, leaving zero survivors (real fixture, POSIX)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pitway-process-exec-'));
    workDirs.push(dir);
    const pidFile = join(dir, 'pids.json');

    const start = Date.now();
    const result = executeCommand(`node "${fixture}" "${pidFile}"`, {
      cwd: process.cwd(),
      timeoutMs: 500,
    });
    const elapsed = Date.now() - start;

    expect(result.terminationReason).toBe('timeout');
    // Bounded: the call must not have hung waiting on descendant pipes.
    expect(elapsed).toBeLessThan(5000);

    expect(existsSync(pidFile)).toBe(true);
    const pids = JSON.parse(readFileSync(pidFile, 'utf8')) as { parent: number; child: number };

    const parentDead = await waitUntilDead(pids.parent);
    const childDead = await waitUntilDead(pids.child);
    expect({ parentDead, childDead }).toEqual({ parentDead: true, childDead: true });
  });
});

describe('executeCommand on Windows (platform-mocked, not a live Windows execution)', () => {
  afterEach(() => {
    vi.doUnmock('node:child_process');
    vi.resetModules();
  });

  it('invokes taskkill /pid <pid> /t /f to clean up the descendant tree', async () => {
    const spawnSyncMock = vi.fn().mockReturnValue({
      pid: 4242,
      error: undefined,
      signal: null,
      status: 0,
      stdout: 'ok',
      stderr: '',
    });
    vi.doMock('node:child_process', () => ({ spawnSync: spawnSyncMock }));
    vi.resetModules();

    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      const mod = await import('../../src/core/verification/process-exec.js');
      const result = mod.executeCommand('dir', { cwd: process.cwd() });
      expect(result.terminationReason).toBe('exited');
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }

    expect(spawnSyncMock).toHaveBeenCalledTimes(2);
    const taskkillCall = spawnSyncMock.mock.calls[1] as unknown[];
    expect(taskkillCall[0]).toBe('taskkill');
    expect(taskkillCall[1]).toEqual(['/pid', '4242', '/t', '/f']);
  });
});
