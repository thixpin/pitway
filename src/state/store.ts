import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse, stringify } from 'yaml';
import type { ZodType } from 'zod';
import {
  backlogFileSchema,
  configSchema,
  reviewsFileSchema,
  stateSchema,
  tasksFileSchema,
  usageFileSchema,
  verificationRepairsFileSchema,
  verificationResultsSchema,
  type BacklogFile,
  type BacklogItem,
  type PitwayConfig,
  type PitwayState,
  type ReviewsFile,
  type TasksFile,
  type UsageFile,
  type VerificationRepairsFile,
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
// Extends StateStoreError so existing `toThrowError(StateStoreError)` call
// sites (e.g. loadTasks on a missing milestone) keep working now that
// directory resolution can fail before a load/save even attempts I/O.
export class MilestoneResolutionError extends StateStoreError {}

const pitwayPath = (root: string, ...segments: string[]): string =>
  join(root, '.pitway', ...segments);

/**
 * Derives a milestone directory slug from its title: lowercased, runs of
 * non-alphanumerics collapsed to a single hyphen, leading/trailing hyphens
 * trimmed, truncated at a word boundary at or before 40 chars. A title that
 * slugifies to nothing (e.g. all punctuation) yields an empty string; the
 * caller falls back to the bare id in that case.
 */
export function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length <= 40) return slug;
  const truncated = slug.slice(0, 40);
  const lastHyphen = truncated.lastIndexOf('-');
  return lastHyphen > 0 ? truncated.slice(0, lastHyphen) : truncated;
}

function milestoneDirEntries(root: string): string[] {
  const milestonesDir = pitwayPath(root, 'milestones');
  try {
    return readdirSync(milestonesDir).filter((e) =>
      statSync(join(milestonesDir, e)).isDirectory(),
    );
  } catch {
    return [];
  }
}

// Exported for Core-layer callers that need the resolved repo-relative
// milestone directory name directly (e.g. to construct a git-relative path
// for staging/trailers) rather than going through a loadX/saveX call.
export function resolveMilestoneDirName(root: string, milestoneId: string): string {
  const milestonesDir = pitwayPath(root, 'milestones');
  const entries = milestoneDirEntries(root);
  const candidates = entries.filter(
    (e) => e === milestoneId || e.startsWith(`${milestoneId}-`),
  );
  if (candidates.length === 0) {
    throw new MilestoneResolutionError(
      `no directory found for milestone ${milestoneId} under ${milestonesDir}`,
    );
  }
  if (candidates.length > 1) {
    throw new MilestoneResolutionError(
      `ambiguous directory for milestone ${milestoneId}: multiple candidates found (${candidates.sort().join(', ')})`,
    );
  }
  return candidates[0]!;
}

const milestonePath = (root: string, milestoneId: string, file: string): string =>
  pitwayPath(root, 'milestones', resolveMilestoneDirName(root, milestoneId), file);

/**
 * Creates the (possibly-slugged) on-disk directory for a newly created
 * milestone. Must be called before any saveX call for that milestone id,
 * since milestonePath (and therefore every saveX) resolves against
 * directories that already exist on disk.
 */
export function createMilestoneDir(root: string, milestoneId: string, title: string): void {
  const slug = slugifyTitle(title);
  const dirName = slug.length > 0 ? `${milestoneId}-${slug}` : milestoneId;
  mkdirSync(pitwayPath(root, 'milestones', dirName), { recursive: true });
}

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    // M017/T005 (AC003): preserves the underlying error (e.g. ENOENT) as
    // `cause` so a caller -- specifically src/cli/errors.ts -- can narrow on
    // it without parsing this message string.
    throw new StateStoreError(`cannot read ${path}: ${(error as Error).message}`, { cause: error });
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

// Bootstrap/migration tolerance: a milestone materialized (via milestone-add
// or --replace) before verification-repairs.yaml existed as a concept has no
// such file on disk at all -- ENOENT specifically, checked via existsSync
// before ever attempting a read, never inferred from a caught error's
// message. Treated as an empty, schema-valid store, the same
// additive-optional/grandfathered-migration pattern already used elsewhere
// in this codebase (mapped_ac_ids absent on pre-M007 tasks; bare
// M001-M005 milestone directories predating M006's slug support). A file
// that DOES exist but is malformed YAML, fails schema validation, or can't
// be read for any other reason (permissions, etc.) still fails visibly
// through the exact same loadYaml/readText path every other per-milestone
// file uses -- this tolerance is scoped to "file absent," nothing broader.
export function loadVerificationRepairs(root: string, milestoneId: string): VerificationRepairsFile {
  const path = milestonePath(root, milestoneId, 'verification-repairs.yaml');
  if (!existsSync(path)) {
    return { schema_version: 1, records: [] };
  }
  return loadYaml(path, verificationRepairsFileSchema);
}

export function saveVerificationRepairs(
  root: string,
  milestoneId: string,
  repairs: VerificationRepairsFile,
): void {
  saveYaml(
    milestonePath(root, milestoneId, 'verification-repairs.yaml'),
    verificationRepairsFileSchema,
    repairs,
  );
}

// Same absent-file tolerance as loadVerificationRepairs (AC001/T001,
// M015): a milestone materialized before reviews.yaml existed as a concept
// has no such file at all -- ENOENT specifically, checked via existsSync
// before ever attempting a read. Never created by milestone-add; created
// only on first write (milestone-review start).
export function loadReviews(root: string, milestoneId: string): ReviewsFile {
  const path = milestonePath(root, milestoneId, 'reviews.yaml');
  if (!existsSync(path)) {
    return { schema_version: 1, sessions: [] };
  }
  return loadYaml(path, reviewsFileSchema);
}

export function saveReviews(root: string, milestoneId: string, reviews: ReviewsFile): void {
  saveYaml(milestonePath(root, milestoneId, 'reviews.yaml'), reviewsFileSchema, reviews);
}

// M018/T001 (AC001): root-level, non-milestone-scoped -- mirrors
// loadState/saveState's pattern, not loadTasks/loadReviews's per-milestone-
// directory pattern, since a backlog item's lifetime is not bound to any
// one milestone's directory. Absent-file tolerance mirrors
// loadVerificationRepairs/loadReviews: never part of `pitway init`'s
// scaffold, lazily created by the first `backlog add`.
export function loadBacklog(root: string): BacklogFile {
  const path = pitwayPath(root, 'backlog.yaml');
  if (!existsSync(path)) {
    return { schema_version: 1, items: [] };
  }
  return loadYaml(path, backlogFileSchema);
}

export function saveBacklog(root: string, backlog: BacklogFile): void {
  saveYaml(pitwayPath(root, 'backlog.yaml'), backlogFileSchema, backlog);
}

// In-memory max+1 scan of the currently-loaded items array, mirroring
// nextSequentialTaskId's idiom (src/core/tasks/add.ts) -- never a
// directory scan, since backlog has no one-file-per-item layout.
export function nextBacklogId(items: BacklogItem[]): string {
  const max = items.reduce((acc, item) => {
    const match = /^B(\d{3})$/.exec(item.id);
    return match ? Math.max(acc, Number(match[1])) : acc;
  }, 0);
  return `B${String(max + 1).padStart(3, '0')}`;
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
    throw new StateStoreError(`cannot read ${label} file ${path}: ${(error as Error).message}`, {
      cause: error,
    });
  }
}

export function milestoneDirExists(root: string, milestoneId: string): boolean {
  return milestoneDirEntries(root).some(
    (e) => e === milestoneId || e.startsWith(`${milestoneId}-`),
  );
}
