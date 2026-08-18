#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, '../../package.json'), 'utf8')) as {
  version: string;
};

export function buildCli(): Command {
  const program = new Command();
  program
    .name('pitway')
    .description('A controlled workflow for agentic software development.')
    .version(pkg.version);
  return program;
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  buildCli().parse(process.argv);
}
