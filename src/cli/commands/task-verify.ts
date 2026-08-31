import type { Command } from 'commander';
import { runTaskVerify } from '../../core/tasks/verify.js';
import type { JournalTaskVerifyEvidence } from '../../state/journal.js';
import { renderOutput } from '../output.js';
import { writeActiveMilestoneFooter } from '../footer.js';

function renderTaskVerifyHuman(view: JournalTaskVerifyEvidence): string {
  const passed = view.exitCode === 0 && view.terminationReason === 'exited';
  const icon = passed ? '✅ pass' : '❌ fail';
  const counts =
    view.passCount !== undefined || view.failCount !== undefined
      ? ` (${view.passCount ?? 0} passed, ${view.failCount ?? 0} failed)`
      : '';
  const typecheck =
    view.typecheck === undefined
      ? ''
      : `; typecheck ${view.typecheck.exitCode === 0 ? '✅ pass' : '❌ fail'}`;
  // M036/T001: on a pass, name the next command -- the failing case's
  // existing pass/fail/evidence report is already the actionable output.
  const next = passed ? ` Next: task-update ${view.taskId} review.` : '';
  const report =
    `🧪 Task ${view.taskId} verified ${icon}${counts} in ${view.durationMs}ms${typecheck} ` +
    `— evidence ${view.id}.${next}`;
  // M048/T004 (AC004): a failed attempt's journaled failures entries render
  // as additive indented lines under the report (counts are already inline
  // above). Passing attempts and records without the field are unchanged.
  const failures = passed ? [] : (view.failures ?? []).map((entry) => `    - ${entry}`);
  return [report, ...failures].join('\n');
}

export interface CommandDeps {
  root?: string;
  write?: (line: string) => void;
}

export function registerTaskVerifyCommand(program: Command, deps: CommandDeps = {}): void {
  const write = deps.write ?? ((line: string) => console.log(line));
  program
    .command('task-verify <id>')
    .description("Run an in_progress task's approved verification command and persist a formal evidence record.")
    .option('--typecheck <command>', 'an additional typecheck command to run and record alongside verification')
    .option('--timeout <ms>', 'budget for the verification/typecheck command in ms (1000..3600000; default 120000)')
    .option('--json', 'output machine-readable JSON')
    .action((id: string, options: { typecheck?: string; timeout?: string; json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      let timeoutMs: number | undefined;
      if (options.timeout !== undefined) {
        timeoutMs = Number(options.timeout);
        if (!Number.isInteger(timeoutMs)) {
          throw new Error(`invalid --timeout "${options.timeout}": must be an integer (1000..3600000 ms)`);
        }
      }
      const view = runTaskVerify(root, id, { typecheckCommand: options.typecheck, timeoutMs });
      write(renderOutput(view, { json: options.json }, renderTaskVerifyHuman));
      writeActiveMilestoneFooter(root, write, options);
    });
}
