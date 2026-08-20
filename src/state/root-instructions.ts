import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// AC004/T004: one shared set of bullet lines, never duplicated
// independently between AGENTS.md and CLAUDE.md's own content constants,
// so the two can never drift apart over time.
const SHARED_BULLETS = [
  '- This project uses [PitWay](https://github.com/thixpin/pitway) to control the engineering workflow.',
  '- Run `pitway resume` before starting or resuming any work.',
  '- Never edit `.pitway/` directly.',
  '- Work only within a confirmed task boundary.',
  "- Obtain a task's bounded context via `pitway task-status <id> --context`.",
].join('\n');

export const AGENTS_MD_CONTENT = `# Agent Instructions\n\n${SHARED_BULLETS}\n`;

export const CLAUDE_MD_CONTENT =
  `# Claude Code Instructions\n\n${SHARED_BULLETS}\n\n` +
  'See AGENTS.md for the shared instructions above, and ' +
  '.claude/protocol-driver.md for the full Claude Code driver protocol.\n';

export interface RootInstructionClassification {
  file: 'AGENTS.md' | 'CLAUDE.md';
  status: 'absent' | 'identical' | 'conflict';
}

function classifyOne(root: string, file: 'AGENTS.md' | 'CLAUDE.md', content: string): RootInstructionClassification {
  const path = join(root, file);
  if (!existsSync(path)) return { file, status: 'absent' };
  const installed = readFileSync(path, 'utf8');
  return { file, status: installed === content ? 'identical' : 'conflict' };
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
  const result: RootInstructionClassification[] = [classifyOne(root, 'AGENTS.md', AGENTS_MD_CONTENT)];
  if (includeClaudeMd) {
    result.push(classifyOne(root, 'CLAUDE.md', CLAUDE_MD_CONTENT));
  }
  return result;
}

export interface ApplyRootInstructionFilesResult {
  agentsMd: 'created' | 'identical' | 'preserved';
  claudeMd?: 'created' | 'identical' | 'preserved';
}

// Built directly on classifyRootInstructionFiles -- absent writes the fixed
// content and reports 'created'; identical reports 'identical' with no
// write; conflict never writes or appends, reporting 'preserved' so the
// caller can warn with the exact fixed content.
export function applyRootInstructionFiles(
  root: string,
  opts: { includeClaudeMd: boolean },
): ApplyRootInstructionFilesResult {
  const classifications = classifyRootInstructionFiles(root, opts);
  const outcomes = new Map<string, 'created' | 'identical' | 'preserved'>();
  for (const { file, status } of classifications) {
    if (status === 'absent') {
      writeFileSync(join(root, file), file === 'AGENTS.md' ? AGENTS_MD_CONTENT : CLAUDE_MD_CONTENT);
      outcomes.set(file, 'created');
    } else if (status === 'identical') {
      outcomes.set(file, 'identical');
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
