import type { Command } from 'commander';
import {
  recordCheckResult,
  runVerification,
  VerifyError,
  type VerifyRecordView,
  type VerifyRunView,
} from '../../core/verification/run.js';
import { renderOutput } from '../output.js';

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

export interface CommandDeps {
  root?: string;
  write?: (line: string) => void;
}

interface VerifyOptions {
  check?: string;
  pass?: boolean;
  fail?: boolean;
  evidence?: string;
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
    .option('--json', 'output machine-readable JSON')
    .action((id: string | undefined, options: VerifyOptions) => {
      const root = deps.root ?? process.cwd();
      if (options.check === undefined) {
        if (options.pass || options.fail || options.evidence !== undefined) {
          throw new VerifyError('--pass, --fail, and --evidence require --check <ctid>');
        }
        const view = runVerification(root, id);
        write(renderOutput(view, { json: options.json }, renderRunHuman));
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
    });
}
