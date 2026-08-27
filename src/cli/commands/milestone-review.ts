import type { Command } from 'commander';
import { startReviewSession, type ReviewSessionView } from '../../core/reviews/session.js';
import { buildReviewBrief, type ReviewBriefView } from '../../core/reviews/brief.js';
import { recordReviewFindings, type RecordReviewView } from '../../core/reviews/record.js';
import { buildReviewReport, type ReviewReportView } from '../../core/reviews/report.js';
import { decideReview, type DecideReviewView } from '../../core/reviews/decide.js';
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

// B032: unlike a dispatched task (which leaves a worktree_dispatch journal
// record computeUsageWarning can key off), a reviewer subagent's dispatch is
// deliberately unconfined -- no worktree, no journal trail -- so there is no
// PitWay-observable signal to gate a warning on. This is therefore always-on
// and neutral, never an accusation: it fires for a genuinely inline
// recording exactly the same as a forgotten dispatch forward.
function renderUsageReminder(role: string): string {
  return (
    `ℹ️  Usage not recorded for role "${role}". If this finding came from a ` +
    `dispatched reviewer subagent, forward its reported usage via --usage next time (dispatch.md step 8).`
  );
}

// Mirrors src/cli/commands/milestone-status.ts's own formatTokens/
// formatTokenValue -- kept as a local, module-private duplicate rather
// than a cross-module import (this codebase's established precedent for
// small rendering helpers; see normalizeRepoRelativePath's comment in
// src/core/tasks/update.ts). Tokens only, never a dollar-cost figure.
const formatTokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const formatTokenValue = (n: number | null): string => (n === null ? 'N/A' : formatTokens(n));

// Human rendering lives here, per the codebase's zero-rendering-in-Core
// convention -- report.ts builds the view only.
function renderReportHuman(view: ReviewReportView): string {
  const missingRoles = view.usage.missingRoles;
  const lines = [
    `📜 Review report — ${view.milestone} (session ${view.sessionId}, ${view.status})`,
    `Usage: ${formatTokenValue(view.usage.totalTokens)} (${missingRoles} role${missingRoles === 1 ? '' : 's'} missing usage)`,
    '',
  ];

  for (const role of view.roles) {
    if (!role.recorded) {
      lines.push(`## ${role.role} — pending (not yet recorded)`);
      lines.push('');
      continue;
    }
    const superseded = role.supersededCount > 0 ? ` (${role.supersededCount} superseded snapshot(s))` : '';
    lines.push(`## ${role.role} — recorded ${role.recordedAt}${superseded}`);
    lines.push(
      `  Usage: ${role.usage !== null ? `${formatTokens(role.usage.total_tokens)} tokens` : 'N/A'}`,
    );
    if (role.findings.length === 0) {
      lines.push('  (no findings -- a clean review)');
    }
    for (const f of role.findings) {
      const targets = f.targets.length > 0 ? ` [${f.targets.join(', ')}${f.unknownTargets.length > 0 ? ` — unknown: ${f.unknownTargets.join(', ')}` : ''}]` : '';
      lines.push(`  [${f.severity}] ${f.finding}${targets}`);
      lines.push(`    → ${f.recommendation}`);
      if (f.conflictsWith.length > 0) lines.push(`    ⚠ conflicts with: ${f.conflictsWith.join(', ')}`);
    }
    lines.push('');
  }

  if (view.pendingRoles.length > 0) {
    lines.push(`Pending roles: ${view.pendingRoles.join(', ')}`, '');
  }

  if (view.sharedTargetConflicts.length > 0) {
    lines.push('⚠ Shared-target disagreements:');
    for (const c of view.sharedTargetConflicts) {
      lines.push(`  ${c.target}:`);
      for (const e of c.entries) lines.push(`    - ${e.role} [${e.severity}]: ${e.finding}`);
    }
    lines.push('');
  }

  if (view.declaredConflicts.length > 0) {
    lines.push('⚠ Declared role disagreements:');
    for (const c of view.declaredConflicts) {
      lines.push(`  ${c.role} vs ${c.conflictsWith.join(', ')}: ${c.finding}`);
    }
    lines.push('');
  }

  lines.push(...view.honesty);
  return lines.join('\n');
}

// AC007: the human output for revision_requested names both sanctioned
// revision paths -- a draft milestone-add --replace's, a confirmed
// milestone-confirm --amend's.
function renderDecideHuman(view: DecideReviewView): string {
  const base = `📜 Session ${view.sessionId} (${view.milestone}) decided: ${view.outcome}.`;
  if (view.outcome !== 'revision_requested') return base;
  return `${base} Revise via \`milestone-add --replace\` (draft) or \`milestone-confirm --amend\` (confirmed).`;
}

const DECIDE_OUTCOMES = ['accepted', 'revision_requested', 'rejected'] as const;

export function registerMilestoneReviewCommand(program: Command, deps: CommandDeps = {}): void {
  const write = deps.write ?? ((line: string) => console.log(line));
  const milestoneReview = program
    .command('milestone-review')
    .alias('ms-review')
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
    .option('--usage <json>', 'measured token usage JSON to attach to this role\'s recorded snapshot')
    .option('--json', 'output machine-readable JSON')
    .action((id: string, options: { role: string; file: string; usage?: string; json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const view = recordReviewFindings(root, id, {
        role: options.role,
        filePath: options.file,
        usage: options.usage,
      });
      write(renderOutput(view, { json: options.json }, renderRecordHuman));
      if (!options.json && options.usage === undefined) {
        write(renderUsageReminder(options.role));
      }
    });

  milestoneReview
    .command('report <id>')
    .description(
      'Read-only: render the most recently created session\'s collected findings -- severity-ordered, ' +
        'grouped conflicts, pending roles, and the honesty text.',
    )
    .option('--json', 'output machine-readable JSON')
    .action((id: string, options: { json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const view = buildReviewReport(root, id);
      write(renderOutput(view, { json: options.json }, renderReportHuman));
    });

  milestoneReview
    .command('decide <id>')
    .description(
      'Close the open session: accepted/revision_requested require every selected role recorded; ' +
        'rejected is the explicit abandonment path for an unfinished review.',
    )
    .requiredOption('--outcome <outcome>', `one of: ${DECIDE_OUTCOMES.join(', ')}`)
    .option('--note <text>', 'optional decision note, up to 300 characters')
    .option('--json', 'output machine-readable JSON')
    .action((id: string, options: { outcome: string; note?: string; json?: boolean }) => {
      if (!(DECIDE_OUTCOMES as readonly string[]).includes(options.outcome)) {
        throw new Error(`--outcome must be one of: ${DECIDE_OUTCOMES.join(', ')}`);
      }
      const root = deps.root ?? process.cwd();
      const view = decideReview(root, id, {
        outcome: options.outcome as (typeof DECIDE_OUTCOMES)[number],
        note: options.note,
      });
      write(renderOutput(view, { json: options.json }, renderDecideHuman));
    });
}
