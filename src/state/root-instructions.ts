import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// AC011(a): one shared set of bullet lines, living ONLY in AGENTS.md's
// managed block. CLAUDE.md carries a thin pointer instead -- Claude Code's
// documented @AGENTS.md import bridge (docs/evidence/M022/claude-code.md,
// Imports) -- so the two files can never drift apart over time.
const SHARED_BULLETS = [
  '- This project uses [PitWay](https://github.com/thixpin/pitway) to control the engineering workflow.',
  '- Run `pitway resume` before starting or resuming any work.',
  '- Never edit `.pitway/` directly.',
  '- Work only within a confirmed task boundary.',
  "- Obtain a task's bounded context via `pitway task-status <id> --context`.",
  '- The driver protocol is split into roles: `protocol-driver.md` (Main Agent: developer conversation and every approval gate), `protocol-orchestrator.md` (Orchestrator: task execution), and `protocol-worker.md` (Worker: one bounded task) in the installed driver directory.',
].join('\n');

// AC011(b): the delimited PitWay-managed block -- markers plus the content
// between them -- is the one and only region PitWay ever owns in these
// files (the forward-looking contract a future `pitway update` relies on).
const MANAGED_BLOCK_START = '<!-- pitway:managed:start -->';
const MANAGED_BLOCK_END = '<!-- pitway:managed:end -->';

function managedBlock(body: string): string {
  return `${MANAGED_BLOCK_START}\n${body}\n${MANAGED_BLOCK_END}`;
}

// Both the fresh-file form and the append form compose from these single
// block constants -- never two divergent copies of the same text.
const AGENTS_MD_BLOCK = managedBlock(SHARED_BULLETS);
const CLAUDE_MD_BLOCK = managedBlock(
  '@AGENTS.md\n\n' +
    'See .claude/protocol-driver.md for the full Claude Code driver protocol, ' +
    'and .claude/protocol-orchestrator.md for the Orchestrator role.',
);

// M043/T002 (AC002, AC005): the exact managed blocks as they shipped BEFORE
// protocol-orchestrator.md existed, frozen byte-for-byte on the same
// principle as the LEGACY_* forms below -- deliberately NOT rebuilt from
// SHARED_BULLETS, so a later edit to the live block can never silently
// change what counts as a known prior block. A file carrying one of these
// is migrated in place (only the block is replaced, everything around it
// untouched); any other differing block is still block_mismatch and
// preserved. Never update these.
const PRIOR_AGENTS_MD_BLOCK = managedBlock(
  [
    '- This project uses [PitWay](https://github.com/thixpin/pitway) to control the engineering workflow.',
    '- Run `pitway resume` before starting or resuming any work.',
    '- Never edit `.pitway/` directly.',
    '- Work only within a confirmed task boundary.',
    "- Obtain a task's bounded context via `pitway task-status <id> --context`.",
  ].join('\n'),
);
const PRIOR_CLAUDE_MD_BLOCK = managedBlock(
  '@AGENTS.md\n\n' +
    'See .claude/protocol-driver.md for the full Claude Code driver protocol.',
);

export const AGENTS_MD_CONTENT = `# Agent Instructions\n\n${AGENTS_MD_BLOCK}\n`;

export const CLAUDE_MD_CONTENT = `# Claude Code Instructions\n\n${CLAUDE_MD_BLOCK}\n`;

// AC011(d): the exact pre-B008 full-file forms, frozen byte-for-byte as
// they shipped -- deliberately NOT rebuilt from SHARED_BULLETS, so a later
// edit to the live bullets can never silently change what counts as a
// legacy PitWay-generated file. Never update these.
const LEGACY_AGENTS_MD_CONTENT =
  '# Agent Instructions\n' +
  '\n' +
  '- This project uses [PitWay](https://github.com/thixpin/pitway) to control the engineering workflow.\n' +
  '- Run `pitway resume` before starting or resuming any work.\n' +
  '- Never edit `.pitway/` directly.\n' +
  '- Work only within a confirmed task boundary.\n' +
  "- Obtain a task's bounded context via `pitway task-status <id> --context`.\n";

const LEGACY_CLAUDE_MD_CONTENT =
  '# Claude Code Instructions\n' +
  '\n' +
  '- This project uses [PitWay](https://github.com/thixpin/pitway) to control the engineering workflow.\n' +
  '- Run `pitway resume` before starting or resuming any work.\n' +
  '- Never edit `.pitway/` directly.\n' +
  '- Work only within a confirmed task boundary.\n' +
  "- Obtain a task's bounded context via `pitway task-status <id> --context`.\n" +
  '\n' +
  'See AGENTS.md for the shared instructions above, and ' +
  '.claude/protocol-driver.md for the full Claude Code driver protocol.\n';

// 'conflict' subdivides by what apply would do about it: 'legacy' (a
// byte-equal prior PitWay-generated form -- rewrite outright), 'unmanaged'
// (a user-authored file with no managed block -- append the block), and
// 'prior_block' (a byte-equal known prior managed block -- replace the
// block in place, M043/T002), and 'block_mismatch' (managed block present
// but differing from both current and prior -- leave alone, the future
// `pitway update`'s job). The three-value `status` vocabulary
// is unchanged so consumers filtering on 'conflict' (e.g.
// src/state/managed-init-paths.ts) keep their conservative semantics.
export type RootInstructionConflictKind = 'legacy' | 'unmanaged' | 'prior_block' | 'block_mismatch';

export interface RootInstructionClassification {
  file: 'AGENTS.md' | 'CLAUDE.md';
  status: 'absent' | 'identical' | 'conflict';
  conflictKind?: RootInstructionConflictKind;
}

function classifyOne(root: string, file: 'AGENTS.md' | 'CLAUDE.md'): RootInstructionClassification {
  const path = join(root, file);
  if (!existsSync(path)) return { file, status: 'absent' };
  const installed = readFileSync(path, 'utf8');
  const block = file === 'AGENTS.md' ? AGENTS_MD_BLOCK : CLAUDE_MD_BLOCK;
  const start = installed.indexOf(MANAGED_BLOCK_START);
  const end = start === -1 ? -1 : installed.indexOf(MANAGED_BLOCK_END, start + MANAGED_BLOCK_START.length);
  if (start !== -1 && end !== -1) {
    // A managed block exists; 'identical' means it is exactly current,
    // whether the file is the fresh form or a user file it was appended to.
    const installedBlock = installed.slice(start, end + MANAGED_BLOCK_END.length);
    if (installedBlock === block) return { file, status: 'identical' };
    const prior = file === 'AGENTS.md' ? PRIOR_AGENTS_MD_BLOCK : PRIOR_CLAUDE_MD_BLOCK;
    if (installedBlock === prior) return { file, status: 'conflict', conflictKind: 'prior_block' };
    return { file, status: 'conflict', conflictKind: 'block_mismatch' };
  }
  const legacy = file === 'AGENTS.md' ? LEGACY_AGENTS_MD_CONTENT : LEGACY_CLAUDE_MD_CONTENT;
  if (installed === legacy) return { file, status: 'conflict', conflictKind: 'legacy' };
  return { file, status: 'conflict', conflictKind: 'unmanaged' };
}

// Read-only classifier, mirroring src/state/claude-assets.ts's
// classifyClaudeAssets exactly in shape and semantics. When
// opts.includeClaudeMd is false, CLAUDE.md is never stat'd or read at all
// and is omitted from the returned array entirely (not merely marked
// absent) -- preserving --no-claude's "never inspected" guarantee.
export function classifyRootInstructionFiles(
  root: string,
  opts: { includeClaudeMd?: boolean } = {},
): RootInstructionClassification[] {
  const includeClaudeMd = opts.includeClaudeMd ?? true;
  const result: RootInstructionClassification[] = [classifyOne(root, 'AGENTS.md')];
  if (includeClaudeMd) {
    result.push(classifyOne(root, 'CLAUDE.md'));
  }
  return result;
}

export type RootInstructionOutcome = 'created' | 'identical' | 'appended' | 'migrated' | 'preserved';

export interface ApplyRootInstructionFilesResult {
  agentsMd: RootInstructionOutcome;
  claudeMd?: RootInstructionOutcome;
}

// Built directly on classifyRootInstructionFiles, per AC011's five cases:
// absent writes the full fixed content ('created'); a current managed
// block writes nothing ('identical'); a byte-equal legacy PitWay form is
// rewritten to the new marked form outright ('migrated' -- never
// appended-to, which would duplicate content); a known prior managed block
// has just that block replaced in place ('migrated', M043/T002); a user-authored file
// without a managed block gets the block appended after a blank line, its
// own content fully intact above ('appended'); a present-but-differing
// managed block is left completely unmodified ('preserved') so the caller
// can report it.
export function applyRootInstructionFiles(
  root: string,
  opts: { includeClaudeMd: boolean },
): ApplyRootInstructionFilesResult {
  const classifications = classifyRootInstructionFiles(root, opts);
  const outcomes = new Map<string, RootInstructionOutcome>();
  for (const { file, status, conflictKind } of classifications) {
    const path = join(root, file);
    const content = file === 'AGENTS.md' ? AGENTS_MD_CONTENT : CLAUDE_MD_CONTENT;
    if (status === 'absent') {
      writeFileSync(path, content);
      outcomes.set(file, 'created');
    } else if (status === 'identical') {
      outcomes.set(file, 'identical');
    } else if (conflictKind === 'legacy') {
      writeFileSync(path, content);
      outcomes.set(file, 'migrated');
    } else if (conflictKind === 'prior_block') {
      // Replace only the managed block; user content above/below untouched.
      const block = file === 'AGENTS.md' ? AGENTS_MD_BLOCK : CLAUDE_MD_BLOCK;
      const prior = file === 'AGENTS.md' ? PRIOR_AGENTS_MD_BLOCK : PRIOR_CLAUDE_MD_BLOCK;
      const existing = readFileSync(path, 'utf8');
      writeFileSync(path, existing.replace(prior, block));
      outcomes.set(file, 'migrated');
    } else if (conflictKind === 'unmanaged') {
      const block = file === 'AGENTS.md' ? AGENTS_MD_BLOCK : CLAUDE_MD_BLOCK;
      const existing = readFileSync(path, 'utf8');
      const separator = existing.endsWith('\n') ? '\n' : '\n\n';
      writeFileSync(path, `${existing}${separator}${block}\n`);
      outcomes.set(file, 'appended');
    } else {
      outcomes.set(file, 'preserved');
    }
  }
  const result: ApplyRootInstructionFilesResult = { agentsMd: outcomes.get('AGENTS.md')! };
  if (outcomes.has('CLAUDE.md')) {
    result.claudeMd = outcomes.get('CLAUDE.md');
  }
  return result;
}
