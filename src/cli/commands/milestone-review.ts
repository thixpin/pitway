import type { Command } from 'commander';
import { startReviewSession, type ReviewSessionView } from '../../core/reviews/session.js';
import { buildReviewBrief, type ReviewBriefView } from '../../core/reviews/brief.js';
import { recordReviewFindings, type RecordReviewView } from '../../core/reviews/record.js';
import { promptForRoles, type PromptStreams } from '../review-prompt.js';
import { renderOutput } from '../output.js';

export interface CommandDeps {
  root?: string;
  write?: (line: string) => void;
  // Injectable prompt streams (AC003) -- default to the real process
  // stdin/stdout, overridden by tests to drive both the interactive and
  // non-interactive branches without a real terminal.
  input?: PromptStreams['input'];
  output?: PromptStreams['output'];
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

function renderBriefHuman(view: ReviewBriefView): string {
  return [
    `📜 Brief for role "${view.role}" — ${view.milestone} (session ${view.sessionId})`,
    `Focus: ${view.focus}`,
    '',
    view.instructions,
    '',
    `--- Contract: ${view.contract.frontmatter.id} "${view.contract.frontmatter.title}" ---`,
    view.contract.body.trim(),
    '',
    `--- Tasks (${view.tasks.length}) ---`,
    ...view.tasks.map((t) => `${t.id}${t.name ? ` — ${t.name}` : ''}: ${t.objective}`),
  ].join('\n');
}

function renderRecordHuman(view: RecordReviewView): string {
  return `📜 Recorded ${view.findingsCount} finding(s) for role "${view.role}" on session ${view.sessionId} (${view.milestone}).`;
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
    .action(async (id: string, options: { roles?: string; json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      let roles: string[];
      if (options.roles !== undefined) {
        roles = parseRolesCsv(options.roles);
      } else {
        const input = deps.input ?? process.stdin;
        const output = deps.output ?? process.stdout;
        if (!input.isTTY) {
          throw new Error(
            'milestone-review start requires --roles <csv> when input is not a TTY (no interactive prompt available)',
          );
        }
        roles = await promptForRoles({ input, output });
      }
      const view = startReviewSession(root, id, { roles });
      write(renderOutput(view, { json: options.json }, renderStartHuman));
    });

  milestoneReview
    .command('brief <id>')
    .description(
      'Read-only: emit one reviewer role\'s brief for the open session -- the bounded envelope ' +
        'a driver forwards to a dispatched reviewer subagent.',
    )
    .requiredOption('--role <role>', 'the role to brief (must be part of the open session)')
    .option('--json', 'output machine-readable JSON')
    .action((id: string, options: { role: string; json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const view = buildReviewBrief(root, id, options.role);
      write(renderOutput(view, { json: options.json }, renderBriefHuman));
    });

  milestoneReview
    .command('record <id>')
    .description(
      'Record one role\'s findings for the open session as a full, append-only snapshot -- ' +
        'never mutates or confirms the milestone itself.',
    )
    .requiredOption('--role <role>', 'the role recording findings (must be part of the open session)')
    .requiredOption('--file <path>', 'path to a YAML file with a top-level findings[] list')
    .option('--json', 'output machine-readable JSON')
    .action((id: string, options: { role: string; file: string; json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const view = recordReviewFindings(root, id, { role: options.role, filePath: options.file });
      write(renderOutput(view, { json: options.json }, renderRecordHuman));
    });
}
