import type { Command } from 'commander';
import {
  recordCheckResult,
  runSingleCheck,
  runVerification,
  VerifyError,
  type VerifyCheckRunView,
  type VerifyRecordView,
  type VerifyRunView,
} from '../../core/verification/run.js';
import {
  allChecksPassed,
  computeLatestCheckResults,
  getVerificationStatus,
  type VerifyStatusView,
} from '../../core/verification/status.js';
import { getFooterForActiveMilestone } from '../../core/milestones/footer.js';
import { computeMilestoneProgress } from '../../core/milestones/progress.js';
import { loadContract, loadState, loadTasks } from '../../state/store.js';
import { renderOutput } from '../output.js';

// M036/T002: verify's run/single-check-run/record paths mutate state and
// take an explicit (optional) milestone id -- show the footer only when
// the resolved milestone is the active one, never for --status (read-only).
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

// M036/T003: reuses the exact same helpers footer.ts/complete.ts already
// call for this exact question -- never VerifyRunView's own passed/pending
// fields, which never clear pending for a manual/review check even once
// recorded (so gating on them would make this hint permanently dead
// whenever one exists). Complements, rather than duplicates, the racing
// footer's own "Next: developer approval" phrasing when both appear
// together after the last check turns green.
function completionHintLine(root: string, milestoneId: string): string | null {
  try {
    const contract = loadContract(root, milestoneId);
    const latest = computeLatestCheckResults(root, milestoneId);
    if (!allChecksPassed(contract, latest)) return null;
    const tasksFile = loadTasks(root, milestoneId);
    const progress = computeMilestoneProgress(tasksFile.tasks);
    if (progress.completed !== progress.total) return null;
    return `✅ All checks passed and every task is completed — run milestone-complete ${milestoneId} after developer approval.`;
  } catch {
    return null;
  }
}

function renderRunHuman(view: VerifyRunView): string {
  const lines = [`🔍 Verification ${view.id}`];
  for (const r of view.results) {
    lines.push(`  ${r.check}  ${r.status === 'pass' ? '✅ pass' : '❌ fail'} — ${r.evidence}`);
  }
  for (const id of view.pending) {
    lines.push(`  ${id}  ⏳ pending — record with --check ${id} --pass|--fail --evidence <text>`);
  }
  const failed = view.results.filter((r) => r.status === 'fail').length;
  lines.push(
    view.passed
      ? `✅ All ${view.results.length} command checks passed.`
      : `❌ ${failed} of ${view.results.length} command checks failed.`,
  );
  return lines.join('\n');
}

function renderRecordHuman(view: VerifyRecordView): string {
  return `📝 Recorded ${view.check} as ${view.status} (recorded_by developer) in ${view.id}.`;
}

function renderCheckRunHuman(view: VerifyCheckRunView): string {
  const icon = view.status === 'pass' ? '✅ pass' : '❌ fail';
  return `🔍 ${view.check}  ${icon} — ${view.evidence} (${view.id})`;
}

function renderStatusHuman(view: VerifyStatusView): string {
  const lines = [`🔍 Verification status ${view.id}`];
  for (const c of view.checks) {
    const label = c.status === 'pass' ? '✅ pass' : c.status === 'fail' ? '❌ fail' : '⏳ pending';
    lines.push(`  ${c.check}  ${label}`);
  }
  return lines.join('\n');
}

export interface CommandDeps {
  root?: string;
  write?: (line: string) => void;
}

interface VerifyOptions {
  check?: string;
  pass?: boolean;
  fail?: boolean;
  evidence?: string;
  status?: boolean;
  json?: boolean;
}

export function registerVerifyCommand(program: Command, deps: CommandDeps = {}): void {
  const write = deps.write ?? ((line: string) => console.log(line));
  program
    .command('verify [id]')
    .description('Run the approved command checks, or record a manual/review check result.')
    .option('--check <ctid>', 'record a result for this manual/review check')
    .option('--pass', 'record the check as passing')
    .option('--fail', 'record the check as failing')
    .option('--evidence <text>', 'evidence supporting the recorded result')
    .option('--status', 'show the latest recorded result per check, without executing anything')
    .option('--json', 'output machine-readable JSON')
    .action((id: string | undefined, options: VerifyOptions) => {
      const root = deps.root ?? process.cwd();
      if (options.status) {
        if (options.check !== undefined || options.pass || options.fail || options.evidence !== undefined) {
          throw new VerifyError('--status cannot be combined with --check, --pass, --fail, or --evidence');
        }
        const view = getVerificationStatus(root, id);
        write(renderOutput(view, { json: options.json }, renderStatusHuman));
        return;
      }
      if (options.check === undefined) {
        if (options.pass || options.fail || options.evidence !== undefined) {
          throw new VerifyError('--pass, --fail, and --evidence require --check <ctid>');
        }
        const view = runVerification(root, id);
        write(renderOutput(view, { json: options.json }, renderRunHuman));
        if (!options.json) {
          const hint = completionHintLine(root, view.id);
          if (hint !== null) write(hint);
          writeFooterIfActive(root, view.id, write);
        }
        return;
      }

      // T002: --check alone (no --pass/--fail/--evidence) on a command-type
      // check is an isolated rerun of just that check -- never automatic,
      // only ever this explicit invocation.
      if (!options.pass && !options.fail && options.evidence === undefined) {
        const view = runSingleCheck(root, id, options.check);
        write(renderOutput(view, { json: options.json }, renderCheckRunHuman));
        if (!options.json) writeFooterIfActive(root, view.id, write);
        return;
      }

      if ((options.pass ?? false) === (options.fail ?? false)) {
        throw new VerifyError('recording a check requires exactly one of --pass or --fail');
      }
      if (options.evidence === undefined) {
        throw new VerifyError('recording a check requires --evidence <text>');
      }
      const view = recordCheckResult(root, id, {
        check: options.check,
        status: options.pass ? 'pass' : 'fail',
        evidence: options.evidence,
      });
      write(renderOutput(view, { json: options.json }, renderRecordHuman));
      if (!options.json) {
        const hint = completionHintLine(root, view.id);
        if (hint !== null) write(hint);
        writeFooterIfActive(root, view.id, write);
      }
    });
}
