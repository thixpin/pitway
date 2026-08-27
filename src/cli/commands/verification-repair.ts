import type { Command } from 'commander';
import {
  approveVerificationRepair,
  cancelVerificationRepair,
  commitVerificationRepair,
  type VerificationRepairApproveView,
  type VerificationRepairCancelView,
  type VerificationRepairCommitView,
} from '../../core/verification/repair.js';
import { getFooterForActiveMilestone } from '../../core/milestones/footer.js';
import { loadState } from '../../state/store.js';
import { renderOutput } from '../output.js';

// M036/T002: approve/commit/cancel each take an explicit milestone -- show
// the footer only when it's the active milestone, never one for a
// different milestone than the one just acted on.
function writeFooterIfActive(root: string, milestone: string, write: (line: string) => void): void {
  let isActive = false;
  try {
    isActive = loadState(root).active_milestone === milestone;
  } catch {
    isActive = false;
  }
  if (!isActive) return;
  const footer = getFooterForActiveMilestone(root);
  if (footer !== null) write(footer);
}

export interface CommandDeps {
  root?: string;
  write?: (line: string) => void;
}

function renderApproveHuman(view: VerificationRepairApproveView): string {
  return (
    `🔧 Approved verification repair ${view.id} for ${view.milestone} ` +
    `(${view.files.length} file(s), ${view.checks.length} check(s)); status pending.`
  );
}

function renderCommitHuman(view: VerificationRepairCommitView): string {
  return view.outcome === 'already-committed'
    ? `🔧 Verification repair ${view.id} already committed at ${view.commit}.`
    : `🔧 Committed verification repair ${view.id} for ${view.milestone} at ${view.commit}.`;
}

function renderCancelHuman(view: VerificationRepairCancelView): string {
  return `🔧 Cancelled verification repair ${view.id} for ${view.milestone}.`;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function registerVerificationRepairCommand(program: Command, deps: CommandDeps = {}): void {
  const write = deps.write ?? ((line: string) => console.log(line));
  const verificationRepair = program
    .command('verification-repair')
    .description(
      'Land a bounded, two-phase, approve-before-edit correction against a milestone whose ' +
        'tasks are all completed but which is not yet milestone-complete\'d.',
    );

  verificationRepair
    .command('approve <milestone>')
    .description(
      'Approve the exact --file/--check scope for a repair before any implementation edit — ' +
        'running this command is itself the approval.',
    )
    .option('--file <path>', 'repeatable: repo-relative path this repair may edit', collect, [])
    .option('--check <id>', 'repeatable: command-type check id this repair reruns before commit', collect, [])
    .option('--change-log <text>', 'free-text rationale for the repair')
    .option('--json', 'output machine-readable JSON')
    .action(
      (
        milestone: string,
        options: { file: string[]; check: string[]; changeLog?: string; json?: boolean },
      ) => {
        if (options.changeLog === undefined) {
          throw new Error('verification-repair approve requires --change-log <text>');
        }
        const root = deps.root ?? process.cwd();
        const view = approveVerificationRepair(root, milestone, {
          files: options.file,
          checks: options.check,
          changeLog: options.changeLog,
        });
        write(renderOutput(view, { json: options.json }, renderApproveHuman));
        if (!options.json) writeFooterIfActive(root, view.milestone, write);
      },
    );

  verificationRepair
    .command('commit <milestone> <vr-id>')
    .description(
      'Rerun every approved check and, only if all pass, atomically commit the corrected files ' +
        'with the VR record and fresh verification results.',
    )
    .option('--json', 'output machine-readable JSON')
    .action((milestone: string, vrId: string, options: { json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const view = commitVerificationRepair(root, milestone, vrId);
      write(renderOutput(view, { json: options.json }, renderCommitHuman));
      if (!options.json) writeFooterIfActive(root, milestone, write);
    });

  verificationRepair
    .command('cancel <milestone> <vr-id>')
    .description('Cancel a still-pending verification repair.')
    .option('--json', 'output machine-readable JSON')
    .action((milestone: string, vrId: string, options: { json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const view = cancelVerificationRepair(root, milestone, vrId);
      write(renderOutput(view, { json: options.json }, renderCancelHuman));
      if (!options.json) writeFooterIfActive(root, milestone, write);
    });
}
