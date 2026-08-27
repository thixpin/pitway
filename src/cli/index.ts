#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { registerAutoRunCommand } from './commands/auto-run.js';
import { registerBacklogCommand } from './commands/backlog.js';
import { registerInitCommand } from './commands/init.js';
import { registerMilestoneAddCommand } from './commands/milestone-add.js';
import { registerMilestoneCancelCommand } from './commands/milestone-cancel.js';
import { registerMilestoneCompleteCommand } from './commands/milestone-complete.js';
import { registerMilestoneConfirmCommand } from './commands/milestone-confirm.js';
import { registerMilestoneCurrentCommand } from './commands/milestone-current.js';
import { registerMilestoneListCommand } from './commands/milestone-list.js';
import { registerMilestoneMergeCommand } from './commands/milestone-merge.js';
import { registerMilestoneReviewCommand } from './commands/milestone-review.js';
import { registerMilestoneStatusCommand } from './commands/milestone-status.js';
import { registerQuickChangeCommand } from './commands/quick-change.js';
import { registerResumeCommand } from './commands/resume.js';
import { registerTaskAddCommand } from './commands/task-add.js';
import { registerTaskDispatchCommand } from './commands/task-dispatch.js';
import { registerTaskDiscardCommand } from './commands/task-discard.js';
import { registerTaskIntegrateCommand } from './commands/task-integrate.js';
import { registerTaskStatusCommand } from './commands/task-status.js';
import { registerTaskAmendCommand } from './commands/task-amend.js';
import { registerTaskUpdateCommand } from './commands/task-update.js';
import { registerTaskVerifyCommand } from './commands/task-verify.js';
import { registerUsageAddCommand } from './commands/usage-add.js';
import { registerVerificationRepairCommand } from './commands/verification-repair.js';
import { registerVerifyCommand } from './commands/verify.js';
import { registerWriteMsArtifactsCommand } from './commands/write-ms-artifacts.js';
import { installWorktreeGuard } from './worktree-guard.js';
import { renderCliError } from './errors.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, '../../package.json'), 'utf8')) as {
  version: string;
};

export interface CommandDeps {
  root?: string;
  write?: (line: string) => void;
}

export function buildCli(): Command {
  const program = new Command();
  program
    .name('pitway')
    .description('A controlled workflow for agentic software development.')
    .version(pkg.version);
  return program;
}

export function registerAllCommands(program: Command, deps: CommandDeps = {}): void {
  // AC005/T005 (M014): fail-closed worktree guard, installed once for every
  // command -- present and future -- rather than per-command enumeration.
  installWorktreeGuard(program, deps);
  registerAutoRunCommand(program, deps);
  registerBacklogCommand(program, deps);
  registerInitCommand(program, deps);
  registerMilestoneAddCommand(program, deps);
  registerMilestoneCancelCommand(program, deps);
  registerMilestoneCompleteCommand(program, deps);
  registerMilestoneConfirmCommand(program, deps);
  registerMilestoneCurrentCommand(program, deps);
  registerMilestoneListCommand(program, deps);
  registerMilestoneMergeCommand(program, deps);
  registerMilestoneReviewCommand(program, deps);
  registerMilestoneStatusCommand(program, deps);
  registerQuickChangeCommand(program, deps);
  registerResumeCommand(program, deps);
  registerTaskAddCommand(program, deps);
  registerTaskDispatchCommand(program, deps);
  registerTaskDiscardCommand(program, deps);
  registerTaskIntegrateCommand(program, deps);
  registerTaskStatusCommand(program, deps);
  registerTaskAmendCommand(program, deps);
  registerTaskUpdateCommand(program, deps);
  registerTaskVerifyCommand(program, deps);
  registerUsageAddCommand(program, deps);
  registerVerificationRepairCommand(program, deps);
  registerVerifyCommand(program, deps);
  registerWriteMsArtifactsCommand(program, deps);
}

// M008/T002: process.argv[1] stays the literal invoked path even when that
// path is a symlink -- exactly how npm's generated bin entry always invokes
// a package's CLI -- while import.meta.url resolves through the symlink to
// the module's own realpath. A strict-equality comparison between the two
// never matches for a real installed package, so the CLI silently no-ops
// for every command. Resolving argv[1] to its own realpath first makes the
// comparison symlink-safe.
const isMainModule =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const program = buildCli();
  registerAllCommands(program);
  try {
    // M015/T002: async, not program.parse -- this milestone introduces the
    // first async command action (T003's interactive role-selection prompt),
    // and a sync parse would turn its refusal path into an unhandled
    // rejection in the real binary.
    await program.parseAsync(process.argv);
  } catch (error) {
    // M017/T005 (AC003): the real binary's one error boundary -- without
    // it, an action handler's rejection was an unhandled-rejection stack
    // dump, not a clean CLI message. In-process tests never reach this
    // (they call parseAsync directly and catch the raw error themselves).
    const rendered = renderCliError(error);
    process.stderr.write(`pitway: ${rendered.message}\n`);
    if (rendered.printStack && error instanceof Error && error.stack !== undefined) {
      process.stderr.write(`${error.stack}\n`);
    }
    process.exitCode = rendered.exitCode;
  }
}
