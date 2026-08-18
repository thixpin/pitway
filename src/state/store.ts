import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse, stringify } from 'yaml';
import type { ZodType } from 'zod';
import {
  configSchema,
  stateSchema,
  tasksFileSchema,
  usageFileSchema,
  verificationResultsSchema,
  type PitwayConfig,
  type PitwayState,
  type TasksFile,
  type UsageFile,
  type VerificationResults,
} from './schemas.js';
import {
  ContractFileError,
  formatIssues,
  parseContractFile,
  serializeContractFile,
  type ContractFile,
} from './contract-file.js';

export class StateStoreError extends Error {}

const pitwayPath = (root: string, ...segments: string[]): string =>
  join(root, '.pitway', ...segments);

const milestonePath = (root: string, milestoneId: string, file: string): string =>
  pitwayPath(root, 'milestones', milestoneId, file);

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    throw new StateStoreError(`cannot read ${path}: ${(error as Error).message}`);
  }
}

function loadYaml<T>(path: string, schema: ZodType<T>): T {
  const text = readText(path);
  let data: unknown;
  try {
    data = parse(text);
  } catch (error) {
    throw new StateStoreError(`malformed YAML in ${path}: ${(error as Error).message}`);
  }
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new StateStoreError(`invalid ${path}: ${formatIssues(result.error)}`);
  }
  return result.data;
}

function saveYaml<T>(path: string, schema: ZodType<T>, value: T): void {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new StateStoreError(`refusing to save invalid ${path}: ${formatIssues(result.error)}`);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stringify(result.data));
}

export function loadConfig(root: string): PitwayConfig {
  return loadYaml(pitwayPath(root, 'config.yaml'), configSchema);
}

export function saveConfig(root: string, config: PitwayConfig): void {
  saveYaml(pitwayPath(root, 'config.yaml'), configSchema, config);
}

export function loadState(root: string): PitwayState {
  return loadYaml(pitwayPath(root, 'state.yaml'), stateSchema);
}

export function saveState(root: string, state: PitwayState): void {
  saveYaml(pitwayPath(root, 'state.yaml'), stateSchema, state);
}

export function loadTasks(root: string, milestoneId: string): TasksFile {
  return loadYaml(milestonePath(root, milestoneId, 'tasks.yaml'), tasksFileSchema);
}

export function saveTasks(root: string, milestoneId: string, tasks: TasksFile): void {
  saveYaml(milestonePath(root, milestoneId, 'tasks.yaml'), tasksFileSchema, tasks);
}

export function loadVerificationResults(root: string, milestoneId: string): VerificationResults {
  return loadYaml(
    milestonePath(root, milestoneId, 'verification-results.yaml'),
    verificationResultsSchema,
  );
}

export function saveVerificationResults(
  root: string,
  milestoneId: string,
  results: VerificationResults,
): void {
  saveYaml(
    milestonePath(root, milestoneId, 'verification-results.yaml'),
    verificationResultsSchema,
    results,
  );
}

export function loadUsage(root: string, milestoneId: string): UsageFile {
  return loadYaml(milestonePath(root, milestoneId, 'usage.yaml'), usageFileSchema);
}

export function saveUsage(root: string, milestoneId: string, usage: UsageFile): void {
  saveYaml(milestonePath(root, milestoneId, 'usage.yaml'), usageFileSchema, usage);
}

export function loadContract(root: string, milestoneId: string): ContractFile {
  const path = milestonePath(root, milestoneId, 'contract.md');
  const text = readText(path);
  try {
    return parseContractFile(text);
  } catch (error) {
    if (error instanceof ContractFileError) {
      throw new StateStoreError(`invalid ${path}: ${error.message}`);
    }
    throw error;
  }
}

export function saveContract(root: string, milestoneId: string, contract: ContractFile): void {
  const path = milestonePath(root, milestoneId, 'contract.md');
  let text: string;
  try {
    text = serializeContractFile(contract);
  } catch (error) {
    if (error instanceof ContractFileError) {
      throw new StateStoreError(`refusing to save invalid ${path}: ${error.message}`);
    }
    throw error;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

const requirementsDir = (root: string): string => pitwayPath(root, 'requirements');

export function nextRequirementId(root: string): string {
  let entries: string[];
  try {
    entries = readdirSync(requirementsDir(root));
  } catch {
    entries = [];
  }
  const max = entries.reduce((acc, name) => {
    const match = /^R(\d{3})\.md$/.exec(name);
    return match ? Math.max(acc, Number(match[1])) : acc;
  }, 0);
  return `R${String(max + 1).padStart(3, '0')}`;
}

export function saveRequirement(root: string, id: string, text: string): void {
  const dir = requirementsDir(root);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.md`), text);
}

export function readInputFile(path: string, label: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    throw new StateStoreError(`cannot read ${label} file ${path}: ${(error as Error).message}`);
  }
}

export function milestoneDirExists(root: string, milestoneId: string): boolean {
  return existsSync(pitwayPath(root, 'milestones', milestoneId));
}
