#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { registerAutoRunCommand } from './commands/auto-run.js';
import { registerInitCommand } from './commands/init.js';
import { registerMilestoneAddCommand } from './commands/milestone-add.js';
import { registerMilestoneCompleteCommand } from './commands/milestone-complete.js';
import { registerMilestoneConfirmCommand } from './commands/milestone-confirm.js';
import { registerMilestoneListCommand } from './commands/milestone-list.js';
import { registerMilestoneStatusCommand } from './commands/milestone-status.js';
import { registerResumeCommand } from './commands/resume.js';
import { registerTaskStatusCommand } from './commands/task-status.js';
import { registerTaskAmendCommand } from './commands/task-amend.js';
import { registerTaskUpdateCommand } from './commands/task-update.js';
import { registerUsageAddCommand } from './commands/usage-add.js';
import { registerVerifyCommand } from './commands/verify.js';
import { registerWriteMsArtifactsCommand } from './commands/write-ms-artifacts.js';

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
  registerAutoRunCommand(program, deps);
  registerInitCommand(program, deps);
  registerMilestoneAddCommand(program, deps);
  registerMilestoneCompleteCommand(program, deps);
  registerMilestoneConfirmCommand(program, deps);
  registerMilestoneListCommand(program, deps);
  registerMilestoneStatusCommand(program, deps);
  registerResumeCommand(program, deps);
  registerTaskStatusCommand(program, deps);
  registerTaskAmendCommand(program, deps);
  registerTaskUpdateCommand(program, deps);
  registerUsageAddCommand(program, deps);
  registerVerifyCommand(program, deps);
  registerWriteMsArtifactsCommand(program, deps);
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  const program = buildCli();
  registerAllCommands(program);
  program.parse(process.argv);
}
