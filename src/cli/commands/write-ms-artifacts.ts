import type { Command } from 'commander';
import { writeMilestoneArtifacts, type WriteArtifactsView } from '../../core/milestones/write-artifacts.js';
import { renderOutput } from '../output.js';

function renderWriteArtifactsHuman(view: WriteArtifactsView): string {
  return `📜 Wrote draft artifacts:\n  ${view.contractPath}\n  ${view.tasksPath}`;
}

export interface CommandDeps {
  root?: string;
  write?: (line: string) => void;
}

export function registerWriteMsArtifactsCommand(program: Command, deps: CommandDeps = {}): void {
  const write = deps.write ?? ((line: string) => console.log(line));
  program
    .command('write-ms-artifacts')
    .description('Write a drafted contract and task plan as plain files to an explicit destination.')
    .requiredOption('--contract <path>', 'path to the drafted contract markdown file')
    .requiredOption('--tasks <path>', 'path to the drafted tasks YAML file')
    .requiredOption('--destination <dir>', 'directory to write the draft artifact files into')
    .option('--overwrite', 'allow overwriting existing files at the destination')
    .option('--json', 'output machine-readable JSON')
    .action(
      (options: { contract: string; tasks: string; destination: string; overwrite?: boolean; json?: boolean }) => {
        const root = deps.root ?? process.cwd();
        const view = writeMilestoneArtifacts(root, {
          contractPath: options.contract,
          tasksPath: options.tasks,
          destination: options.destination,
          overwrite: options.overwrite,
        });
        write(renderOutput(view, { json: options.json }, renderWriteArtifactsHuman));
      },
    );
}
