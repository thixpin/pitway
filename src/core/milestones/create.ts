import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import {
  createMilestoneDir,
  loadContract,
  loadState,
  milestoneDirExists,
  nextRequirementId,
  readInputFile,
  saveContract,
  saveRequirement,
  saveState,
  saveTasks,
  saveUsage,
  saveVerificationRepairs,
  saveVerificationResults,
} from '../../state/store.js';
import { tasksFileSchema, type PitwayState, type TasksFile } from '../../state/schemas.js';
import { formatIssues, parseContractFile, type ContractFile } from '../../state/contract-file.js';
import { resolveReadyTasks } from '../tasks/dependencies.js';

export class MilestoneAddError extends Error {}

export interface MilestoneAddInputs {
  contractPath: string;
  tasksPath: string;
  requirementPath?: string;
}

export interface MilestoneAddView {
  id: string;
  title: string;
  requirement: string | null;
}

const formatId = (prefix: string, n: number): string => `${prefix}${String(n).padStart(3, '0')}`;

function nextMilestoneId(milestones: string[]): string {
  const max = milestones.reduce((acc, id) => Math.max(acc, Number(id.slice(1))), 0);
  return formatId('M', max + 1);
}

function readInput(path: string, label: string): string {
  try {
    return readInputFile(path, label);
  } catch (error) {
    throw new MilestoneAddError((error as Error).message);
  }
}

function parseContractInput(path: string): ContractFile {
  const text = readInput(path, 'contract');
  try {
    return parseContractFile(text);
  } catch (error) {
    throw new MilestoneAddError(`invalid contract ${path}: ${(error as Error).message}`);
  }
}

function parseTasksInput(path: string): TasksFile {
  const text = readInput(path, 'tasks');
  let data: unknown;
  try {
    data = parse(text);
  } catch (error) {
    throw new MilestoneAddError(`malformed YAML in ${path}: ${(error as Error).message}`);
  }
  const result = tasksFileSchema.safeParse(data);
  if (!result.success) {
    throw new MilestoneAddError(`invalid tasks ${path}: ${formatIssues(result.error)}`);
  }
  return result.data;
}

function checkCriterionReferences(contract: ContractFile): void {
  const known = new Set(contract.frontmatter.acceptance_criteria.map((c) => c.id));
  for (const check of contract.frontmatter.verification) {
    if (!known.has(check.criterion)) {
      throw new MilestoneAddError(
        `verification check ${check.id} references unknown criterion ${check.criterion}`,
      );
    }
  }
}

function assertActiveMilestoneTerminal(root: string, state: PitwayState): void {
  if (state.active_milestone === null) return;
  const status = loadContract(root, state.active_milestone).frontmatter.status;
  if (status !== 'completed' && status !== 'cancelled') {
    throw new MilestoneAddError(
      `cannot add a milestone while ${state.active_milestone} is active (status: ${status}); ` +
        `complete or cancel it first`,
    );
  }
}

export interface ValidatedDraftInputs {
  contract: ContractFile;
  tasksInput: TasksFile;
}

export function validateDraftInputs(contractPath: string, tasksPath: string): ValidatedDraftInputs {
  const contract = parseContractInput(contractPath);
  checkCriterionReferences(contract);
  const tasksInput = parseTasksInput(tasksPath);
  resolveReadyTasks(tasksInput.tasks);
  return { contract, tasksInput };
}

// M045/T002 (W2): scope entries must be files. Core matches dirty paths by
// exact string membership (assertDirtySubset / checkWriteScope), so a
// directory entry validates at draft time but can never be satisfied at
// execution -- M041/T001 blocked on exactly this. Refusal rather than
// expansion: expanding at draft time would silently widen an approved
// scope to files the author never listed and drift as files are added;
// the declared list stays the single source of truth. Not-yet-existing
// paths (files a task will create) are allowed.
export function assertFileScopedTasks(root: string, tasks: TasksFile['tasks'], fail: (message: string) => never): void {
  for (const task of tasks) {
    for (const field of ['write_scope', 'context_files', 'relevant_files'] as const) {
      for (const entry of task[field] ?? []) {
        const isDirectory =
          entry.endsWith('/') || (existsSync(join(root, entry)) && statSync(join(root, entry)).isDirectory());
        if (isDirectory) {
          fail(
            `${task.id}: ${field} entry "${entry}" is a directory; scope entries must be files ` +
              `(Core matches dirty paths exactly)`,
          );
        }
      }
    }
  }
}

export function createMilestone(root: string, inputs: MilestoneAddInputs): MilestoneAddView {
  const state = loadState(root);
  assertActiveMilestoneTerminal(root, state);

  const id = nextMilestoneId(state.milestones);
  if (milestoneDirExists(root, id)) {
    throw new MilestoneAddError(
      `.pitway/milestones/${id} already exists but is not registered in state.yaml; ` +
        `a previous milestone-add may have been interrupted — inspect and reconcile manually`,
    );
  }

  const { contract, tasksInput } = validateDraftInputs(inputs.contractPath, inputs.tasksPath);
  assertFileScopedTasks(root, tasksInput.tasks, (m) => { throw new MilestoneAddError(m); });
  const requirementText =
    inputs.requirementPath === undefined ? null : readInput(inputs.requirementPath, 'requirement');

  let requirementId: string | null = null;
  if (requirementText !== null) {
    requirementId = nextRequirementId(root);
    saveRequirement(root, requirementId, requirementText);
  }

  createMilestoneDir(root, id, contract.frontmatter.title);

  saveContract(root, id, {
    frontmatter: {
      ...contract.frontmatter,
      id,
      status: 'draft',
      requirement: requirementId,
      confirmed_at: null,
      verification_approved_hash: null,
    },
    body: contract.body,
  });
  saveTasks(root, id, {
    schema_version: tasksInput.schema_version,
    tasks: tasksInput.tasks.map((t) => ({ ...t, status: 'planned', result: null, usage: null })),
  });
  saveVerificationResults(root, id, { schema_version: 1, results: [] });
  saveVerificationRepairs(root, id, { schema_version: 1, records: [] });
  saveUsage(root, id, { schema_version: 1, planning: null, qa: null });
  saveState(root, { ...state, active_milestone: id, milestones: [...state.milestones, id] });

  return { id, title: contract.frontmatter.title, requirement: requirementId };
}

// AC001: draft-only, same-id, no-git-operation in-place correction. Reuses
// the same validation as createMilestone; overwrites contract.md/tasks.yaml/
// verification-results.yaml/usage.yaml under the SAME id -- no new id is
// minted and state.milestones is unchanged. Requirement handling: an omitted
// --requirement preserves the draft's currently materialized requirement id
// (never cleared); a supplied one creates a fresh requirement file, leaving
// the prior one on disk (requirements are append-only, never deleted).
export function replaceMilestoneDraft(
  root: string,
  id: string,
  inputs: MilestoneAddInputs,
): MilestoneAddView {
  const existing = loadContract(root, id);
  if (existing.frontmatter.status !== 'draft') {
    throw new MilestoneAddError(
      `cannot replace ${id}: status is "${existing.frontmatter.status}", not draft; ` +
        `use milestone-confirm --amend to change a confirmed milestone instead`,
    );
  }

  const { contract, tasksInput } = validateDraftInputs(inputs.contractPath, inputs.tasksPath);
  assertFileScopedTasks(root, tasksInput.tasks, (m) => { throw new MilestoneAddError(m); });

  let requirementId: string | null = existing.frontmatter.requirement;
  if (inputs.requirementPath !== undefined) {
    const requirementText = readInput(inputs.requirementPath, 'requirement');
    requirementId = nextRequirementId(root);
    saveRequirement(root, requirementId, requirementText);
  }

  saveContract(root, id, {
    frontmatter: {
      ...contract.frontmatter,
      id,
      status: 'draft',
      requirement: requirementId,
      confirmed_at: null,
      verification_approved_hash: null,
    },
    body: contract.body,
  });
  saveTasks(root, id, {
    schema_version: tasksInput.schema_version,
    tasks: tasksInput.tasks.map((t) => ({ ...t, status: 'planned', result: null, usage: null })),
  });
  saveVerificationResults(root, id, { schema_version: 1, results: [] });
  saveVerificationRepairs(root, id, { schema_version: 1, records: [] });
  saveUsage(root, id, { schema_version: 1, planning: null, qa: null });

  const state = loadState(root);
  if (state.active_milestone !== id) {
    saveState(root, { ...state, active_milestone: id });
  }

  return { id, title: contract.frontmatter.title, requirement: requirementId };
}
