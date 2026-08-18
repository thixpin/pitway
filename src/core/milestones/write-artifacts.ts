import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { validateDraftInputs } from './create.js';

export class WriteArtifactsError extends Error {}

export interface WriteArtifactsInputs {
  contractPath: string;
  tasksPath: string;
  destination: string;
  overwrite?: boolean;
}

export interface WriteArtifactsView {
  contractPath: string;
  tasksPath: string;
}

function assertDestinationOutsidePitway(root: string, destination: string): void {
  const pitwayDir = resolve(root, '.pitway');
  const resolvedDestination = resolve(root, destination);
  if (resolvedDestination === pitwayDir || resolvedDestination.startsWith(pitwayDir + sep)) {
    throw new WriteArtifactsError(
      `destination ${destination} is under .pitway/ (${pitwayDir}); write-ms-artifacts writes ` +
        `non-authoritative draft files only and refuses to write inside .pitway/`,
    );
  }
}

export function writeMilestoneArtifacts(root: string, inputs: WriteArtifactsInputs): WriteArtifactsView {
  validateDraftInputs(inputs.contractPath, inputs.tasksPath);

  assertDestinationOutsidePitway(root, inputs.destination);

  const contractDest = join(inputs.destination, 'contract.md');
  const tasksDest = join(inputs.destination, 'tasks.yaml');

  if (!inputs.overwrite) {
    if (existsSync(contractDest)) {
      throw new WriteArtifactsError(`destination file already exists: ${contractDest} (use --overwrite)`);
    }
    if (existsSync(tasksDest)) {
      throw new WriteArtifactsError(`destination file already exists: ${tasksDest} (use --overwrite)`);
    }
  }

  mkdirSync(inputs.destination, { recursive: true });
  writeFileSync(contractDest, readFileSync(inputs.contractPath));
  writeFileSync(tasksDest, readFileSync(inputs.tasksPath));

  return { contractPath: contractDest, tasksPath: tasksDest };
}
