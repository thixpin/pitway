import type { Command } from 'commander';
import { appendAutoRunRecord, readJournal } from '../../state/journal.js';
import { loadContract, loadState } from '../../state/store.js';
import { isAutoRunAuthorized, type AutoRunReason } from '../../core/journal/auto-run.js';
import { getFooterForActiveMilestone } from '../../core/milestones/footer.js';
import { renderOutput } from '../output.js';

// M036/T002: enable/disable take an optional (default: active) milestone
// id -- show the footer only when it resolved to the active milestone,
// never one for a different milestone than the one just acted on. status
// is read-only and never gets a footer.
function writeFooterIfActive(root: string, resolvedId: string, write: (line: string) => void): void {
  let isActive = false;
  try {
    isActive = loadState(root).active_milestone === resolvedId;
  } catch {
    isActive = false;
  }
  if (!isActive) return;
  const footer = getFooterForActiveMilestone(root);
  if (footer !== null) write(footer);
}

export class AutoRunError extends Error {}

function resolveActiveMilestone(root: string): string {
  const state = loadState(root);
  if (!state.active_milestone) {
    throw new AutoRunError('no active milestone; run milestone-add first');
  }
  return state.active_milestone;
}

function resolveMilestoneId(root: string, milestoneId: string | undefined): string {
  return milestoneId ?? resolveActiveMilestone(root);
}

export interface AutoRunActionView {
  id: string;
  action: 'enable' | 'disable';
  outcome: 'enabled' | 'already-authorized' | 'disabled';
  hash: string | null;
}

export interface AutoRunStatusView {
  id: string;
  authorized: boolean;
  reason: AutoRunReason | null;
  hash: string | null;
}

// enable requires in_progress (auto-run only ever authorizes continuation of
// live execution) and records the CURRENT verification_approved_hash.
// Idempotent: if the milestone is already authorized against that exact
// hash, no new record is appended -- calling enable again is a no-op.
export function enableAutoRun(root: string, milestoneId: string | undefined): AutoRunActionView {
  const id = resolveMilestoneId(root, milestoneId);
  const contract = loadContract(root, id);
  if (contract.frontmatter.status !== 'in_progress') {
    throw new AutoRunError(
      `cannot enable auto-run for ${id}: milestone must be in_progress (current status: ${contract.frontmatter.status})`,
    );
  }
  const hash = contract.frontmatter.verification_approved_hash;
  if (hash === null) {
    throw new AutoRunError(`cannot enable auto-run for ${id}: no verification_approved_hash recorded`);
  }
  const authorization = isAutoRunAuthorized(readJournal(root), id, hash);
  if (authorization.authorized) {
    return { id, action: 'enable', outcome: 'already-authorized', hash };
  }
  appendAutoRunRecord(root, { milestone: id, action: 'enable', hash });
  return { id, action: 'enable', outcome: 'enabled', hash };
}

// disable works for a milestone in any status -- no status gate, unlike
// enable. loadContract still runs first purely to confirm the milestone
// actually exists (it throws a clear error otherwise, rather than letting an
// auto_run record accumulate for a milestone id that was never real).
export function disableAutoRun(root: string, milestoneId: string | undefined): AutoRunActionView {
  const id = resolveMilestoneId(root, milestoneId);
  loadContract(root, id);
  appendAutoRunRecord(root, { milestone: id, action: 'disable' });
  return { id, action: 'disable', outcome: 'disabled', hash: null };
}

// status works for a milestone in any status.
export function autoRunStatus(root: string, milestoneId: string | undefined): AutoRunStatusView {
  const id = resolveMilestoneId(root, milestoneId);
  const contract = loadContract(root, id);
  const hash = contract.frontmatter.verification_approved_hash;
  const authorization = isAutoRunAuthorized(readJournal(root), id, hash);
  return { id, authorized: authorization.authorized, reason: authorization.reason, hash };
}

function renderActionHuman(view: AutoRunActionView): string {
  if (view.action === 'enable') {
    return view.outcome === 'already-authorized'
      ? `🔁 Auto-run already authorized for ${view.id} at ${view.hash}.`
      : `🔁 Auto-run enabled for ${view.id} at ${view.hash}.`;
  }
  return `🔁 Auto-run disabled for ${view.id}.`;
}

function renderStatusHuman(view: AutoRunStatusView): string {
  return view.authorized
    ? `🔁 Auto-run is authorized for ${view.id}.`
    : `🔁 Auto-run is NOT authorized for ${view.id}: ${view.reason}.`;
}

export interface CommandDeps {
  root?: string;
  write?: (line: string) => void;
}

export function registerAutoRunCommand(program: Command, deps: CommandDeps = {}): void {
  const write = deps.write ?? ((line: string) => console.log(line));
  const autoRun = program
    .command('auto-run')
    .description('Manage auto-run authorization for automatic task continuation.');

  autoRun
    .command('enable [milestone-id]')
    .description('Authorize auto-run for an in_progress milestone at its current verification_approved_hash.')
    .option('--json', 'output machine-readable JSON')
    .action((milestoneId: string | undefined, options: { json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const view = enableAutoRun(root, milestoneId);
      write(renderOutput(view, { json: options.json }, renderActionHuman));
      if (!options.json) writeFooterIfActive(root, view.id, write);
    });

  autoRun
    .command('disable [milestone-id]')
    .description('Revoke auto-run authorization for a milestone in any status.')
    .option('--json', 'output machine-readable JSON')
    .action((milestoneId: string | undefined, options: { json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const view = disableAutoRun(root, milestoneId);
      write(renderOutput(view, { json: options.json }, renderActionHuman));
      if (!options.json) writeFooterIfActive(root, view.id, write);
    });

  autoRun
    .command('status [milestone-id]')
    .description('Report whether auto-run is currently authorized for a milestone in any status, and why not.')
    .option('--json', 'output machine-readable JSON')
    .action((milestoneId: string | undefined, options: { json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const view = autoRunStatus(root, milestoneId);
      write(renderOutput(view, { json: options.json }, renderStatusHuman));
    });
}
