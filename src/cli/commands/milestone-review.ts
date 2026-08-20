import type { Command } from 'commander';
import { startReviewSession, type ReviewSessionView } from '../../core/reviews/session.js';
import { renderOutput } from '../output.js';

export interface CommandDeps {
  root?: string;
  write?: (line: string) => void;
}

function parseRolesCsv(raw: string): string[] {
  return raw
    .split(',')
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
}

function renderStartHuman(view: ReviewSessionView): string {
  return `📜 Review ${view.id} opened for ${view.milestone} — roles: ${view.roles.join(', ')}.`;
}

export function registerMilestoneReviewCommand(program: Command, deps: CommandDeps = {}): void {
  const write = deps.write ?? ((line: string) => console.log(line));
  const milestoneReview = program
    .command('milestone-review')
    .description(
      'A role-based review workflow: PitWay manages review state (sessions/briefs/findings/decisions); ' +
        'the driver dispatches the actual reviewers.',
    );

  milestoneReview
    .command('start <id>')
    .description(
      'Open a review session for a draft/confirmed/in_progress/review milestone: validates --roles ' +
        'against the registry and pins the current content_hash.',
    )
    .option('--roles <csv>', 'comma-separated list of registered review role ids')
    .option('--json', 'output machine-readable JSON')
    .action((id: string, options: { roles?: string; json?: boolean }) => {
      if (options.roles === undefined) {
        throw new Error('milestone-review start requires --roles <csv>');
      }
      const root = deps.root ?? process.cwd();
      const view = startReviewSession(root, id, { roles: parseRolesCsv(options.roles) });
      write(renderOutput(view, { json: options.json }, renderStartHuman));
    });
}
