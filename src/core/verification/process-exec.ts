// Timeout-bounded command execution primitive for verification command
// checks (AC001). Independent of run.ts -- run.ts is wired to this in a
// later task.
//
// Sync vs. async is evidence-gated, not a convenience default: a real
// POSIX fixture (spawned detached, ignoring SIGTERM, forking an
// also-ignoring child that inherits its stdio pipes) was run through this
// exact spawnSync-based implementation and empirically confirmed --
// via real process inspection, not mocks -- to terminate within the
// configured timeout with zero surviving processes. That evidence is what
// keeps this synchronous; see tests/unit/verification-process-exec.test.ts.
//
// The mechanism: spawnSync's own `timeout` + `killSignal` option only
// signals the immediate spawned process, never its descendants -- verified
// empirically to leave a grandchild alive when relied on alone. The
// explicit terminateDescendants() call below, run after every spawnSync
// return (not only on timeout), is therefore load-bearing: on POSIX the
// check is spawned detached so its pid doubles as its process-group id,
// and a negative-pid SIGKILL reaches every descendant that hasn't broken
// away with its own setsid. Windows has no process-group primitive, so
// `taskkill /pid <pid> /t /f` walks the tree instead -- exercised only by
// a platform-mocked test, never live.
import { spawnSync, type SpawnSyncOptions } from 'node:child_process';

// @types/node's SpawnSyncOptions omits `detached`, even though spawnSync
// honors it identically to spawn() at the binding level -- confirmed
// empirically: the negative-pid process-group kill in terminateDescendants
// only reaches descendants when the child was spawned detached. Widen
// locally rather than fighting the upstream type gap.
type SpawnSyncOptionsWithDetached = SpawnSyncOptions & { detached?: boolean };

export type TerminationReason = 'exited' | 'timeout' | 'signal' | 'spawn_error';

export interface ExecuteCommandOptions {
  cwd: string;
  /** Milliseconds before the command and its descendant tree are killed. */
  timeoutMs?: number;
}

export interface ExecuteCommandResult {
  terminationReason: TerminationReason;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

// Same bound this session's own diagnostic isolation testing used
// successfully; also AC001's contracted schema default for timeout_ms.
export const DEFAULT_TIMEOUT_MS = 120_000;

interface SpawnSyncLikeResult {
  error?: NodeJS.ErrnoException;
  signal: NodeJS.Signals | null;
  status: number | null;
  pid?: number;
  stdout?: string | Buffer | null;
  stderr?: string | Buffer | null;
}

function classify(result: SpawnSyncLikeResult): TerminationReason {
  if (result.error) {
    return result.error.code === 'ETIMEDOUT' ? 'timeout' : 'spawn_error';
  }
  if (result.signal !== null) return 'signal';
  return 'exited';
}

function terminateDescendants(pid: number): void {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/t', '/f']);
    return;
  }
  try {
    // Negative pid targets the whole process group (the check was spawned
    // detached, making its pid the group leader's pid too).
    process.kill(-pid, 'SIGKILL');
  } catch {
    // Already gone -- nothing left to clean up.
  }
}

export function executeCommand(
  command: string,
  options: ExecuteCommandOptions,
): ExecuteCommandResult {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const spawnOptions: SpawnSyncOptionsWithDetached = {
    cwd: options.cwd,
    shell: true,
    detached: process.platform !== 'win32',
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    encoding: 'utf8',
  };
  const result = spawnSync(command, spawnOptions) as SpawnSyncLikeResult;

  const terminationReason = classify(result);
  if (result.pid) {
    terminateDescendants(result.pid);
  }

  return {
    terminationReason,
    exitCode: result.status,
    signal: result.signal,
    stdout: typeof result.stdout === 'string' ? result.stdout : (result.stdout?.toString() ?? ''),
    stderr: typeof result.stderr === 'string' ? result.stderr : (result.stderr?.toString() ?? ''),
  };
}
