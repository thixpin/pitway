import { dirname, resolve } from 'node:path';
import type { Command } from 'commander';
import { detectTaskWorktree } from '../git/worktree.js';
import { git } from '../git/exec.js';

// AC005/T005 (M014): fail-closed authoritative-state protection. EVERY
// pitway command refuses inside a PitWay task worktree except the
// enumerated read-only allowlist below -- default-deny polarity, so
// commands not individually considered (init, write-ms-artifacts, and every
// future command) are covered structurally the moment they register. The
// worktree's committed .pitway/ copy is stale transport data (pre-dispatch
// state; the per-worktree git path makes the journal read empty there):
// the allowlisted reads are a convenience, never an authoritative view.

export class WorktreeGuardError extends Error {}

// `verify` is flag-aware: bare verify executes commands (mutating), only
// --status is read-only. Everything else here is unconditionally read-only.
const READ_ONLY_COMMANDS = new Set([
  'resume',
  'task-status',
  'milestone-status',
  'milestone-list',
  'milestone-current',
]);

export interface WorktreeGuardDeps {
  root?: string;
}

export function installWorktreeGuard(program: Command, deps: WorktreeGuardDeps = {}): void {
  program.hook('preAction', (_thisCommand, actionCommand) => {
    const root = deps.root ?? process.cwd();
    const detected = detectTaskWorktree(root);
    if (detected === null) return;

    const name = actionCommand.name();
    if (READ_ONLY_COMMANDS.has(name)) return;
    if (name === 'verify' && (actionCommand.opts() as { status?: boolean }).status === true) {
      return;
    }

    const mainRoot = dirname(resolve(root, git(['rev-parse', '--git-common-dir'], root).trim()));
    throw new WorktreeGuardError(
      `refusing to run "${name}" inside the PitWay task worktree for ` +
        `${detected.marker.milestone}/${detected.marker.task} (${detected.topLevel}): ` +
        `authoritative .pitway/ state lives only in the main working tree at ${mainRoot}; ` +
        `workers commit code on the scaffolding branch and never run state-mutating pitway commands`,
    );
  });
}
