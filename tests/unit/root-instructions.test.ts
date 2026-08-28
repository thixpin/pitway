import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AGENTS_MD_CONTENT,
  CLAUDE_MD_CONTENT,
  applyRootInstructionFiles,
  classifyRootInstructionFiles,
} from '../../src/state/root-instructions.js';

const START = '<!-- pitway:managed:start -->';
const END = '<!-- pitway:managed:end -->';

// Extracts the managed block (markers plus everything between) from a
// fixed-content constant, so append expectations compose from the shipped
// content rather than a second hand-maintained copy.
function extractBlock(content: string): string {
  const start = content.indexOf(START);
  const end = content.indexOf(END, start + START.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return content.slice(start, end + END.length);
}

// AC011(d) fixtures: the exact pre-B008 full-file forms, reconstructed
// here the way the old code built them (header + bullets + pointer) --
// deliberately NOT imported from the implementation, so a transcription
// typo in the implementation's frozen legacy constants fails these tests
// instead of silently passing.
const LEGACY_BULLETS = [
  '- This project uses [PitWay](https://github.com/thixpin/pitway) to control the engineering workflow.',
  '- Run `pitway resume` before starting or resuming any work.',
  '- Never edit `.pitway/` directly.',
  '- Work only within a confirmed task boundary.',
  "- Obtain a task's bounded context via `pitway task-status <id> --context`.",
].join('\n');
const LEGACY_AGENTS_MD = `# Agent Instructions\n\n${LEGACY_BULLETS}\n`;
const LEGACY_CLAUDE_MD =
  `# Claude Code Instructions\n\n${LEGACY_BULLETS}\n\n` +
  'See AGENTS.md for the shared instructions above, and ' +
  '.claude/protocol-driver.md for the full Claude Code driver protocol.\n';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pitway-root-instructions-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

// AC011(a)/(b): the fixed fresh-file contents themselves.
describe('root instruction content constants', () => {
  it('AGENTS.md carries the 5 shared bullets inside the managed block, under its header', () => {
    expect(AGENTS_MD_CONTENT.startsWith('# Agent Instructions\n')).toBe(true);
    const block = extractBlock(AGENTS_MD_CONTENT);
    expect(block).toContain(LEGACY_BULLETS);
  });

  it('CLAUDE.md carries no bullets -- only the @AGENTS.md import and the protocol-driver pointer, inside the managed block', () => {
    expect(CLAUDE_MD_CONTENT.startsWith('# Claude Code Instructions\n')).toBe(true);
    const block = extractBlock(CLAUDE_MD_CONTENT);
    expect(block).toContain('@AGENTS.md');
    expect(block).toContain('.claude/protocol-driver.md');
    // M043/T002 (AC002): the Orchestrator role's protocol doc is pointed at too.
    expect(block).toContain('.claude/protocol-orchestrator.md');
    expect(AGENTS_MD_CONTENT).toContain('protocol-orchestrator.md');
    // AC: no SHARED_BULLETS text duplicated into CLAUDE.md.
    expect(CLAUDE_MD_CONTENT).not.toContain('pitway resume');
    expect(CLAUDE_MD_CONTENT).not.toContain('- This project uses');
  });
});

describe('classifyRootInstructionFiles', () => {
  it('classifies both files absent when neither exists', () => {
    expect(classifyRootInstructionFiles(root)).toEqual([
      { file: 'AGENTS.md', status: 'absent' },
      { file: 'CLAUDE.md', status: 'absent' },
    ]);
  });

  it('classifies a byte-identical fresh-form file as identical', () => {
    writeFileSync(join(root, 'AGENTS.md'), AGENTS_MD_CONTENT);
    writeFileSync(join(root, 'CLAUDE.md'), CLAUDE_MD_CONTENT);
    expect(classifyRootInstructionFiles(root)).toEqual([
      { file: 'AGENTS.md', status: 'identical' },
      { file: 'CLAUDE.md', status: 'identical' },
    ]);
  });

  it('classifies an appended-form file with an up-to-date managed block as identical', () => {
    const block = extractBlock(AGENTS_MD_CONTENT);
    writeFileSync(join(root, 'AGENTS.md'), `# My own AGENTS.md\n\nMy rules.\n\n${block}\n`);
    expect(classifyRootInstructionFiles(root)[0]).toEqual({ file: 'AGENTS.md', status: 'identical' });
  });

  it('classifies a byte-equal legacy PitWay-generated form as a legacy conflict', () => {
    writeFileSync(join(root, 'AGENTS.md'), LEGACY_AGENTS_MD);
    writeFileSync(join(root, 'CLAUDE.md'), LEGACY_CLAUDE_MD);
    expect(classifyRootInstructionFiles(root)).toEqual([
      { file: 'AGENTS.md', status: 'conflict', conflictKind: 'legacy' },
      { file: 'CLAUDE.md', status: 'conflict', conflictKind: 'legacy' },
    ]);
  });

  it('classifies a user-authored file without a managed block as an unmanaged conflict', () => {
    writeFileSync(join(root, 'AGENTS.md'), '# My own AGENTS.md\n');
    expect(classifyRootInstructionFiles(root)[0]).toEqual({
      file: 'AGENTS.md',
      status: 'conflict',
      conflictKind: 'unmanaged',
    });
  });

  it('classifies a present-but-differing managed block as a block_mismatch conflict', () => {
    const tampered = AGENTS_MD_CONTENT.replace('- Never edit `.pitway/` directly.\n', '');
    writeFileSync(join(root, 'AGENTS.md'), tampered);
    expect(classifyRootInstructionFiles(root)[0]).toEqual({
      file: 'AGENTS.md',
      status: 'conflict',
      conflictKind: 'block_mismatch',
    });
  });

  it('omits CLAUDE.md entirely (not just absent) when includeClaudeMd is false, never reading it', () => {
    // A CLAUDE.md exists but must never be inspected.
    writeFileSync(join(root, 'CLAUDE.md'), 'irrelevant tampered content\n');
    const result = classifyRootInstructionFiles(root, { includeClaudeMd: false });
    expect(result).toEqual([{ file: 'AGENTS.md', status: 'absent' }]);
    expect(result.some((c) => c.file === 'CLAUDE.md')).toBe(false);
  });
});

describe('applyRootInstructionFiles', () => {
  it('creates both files when absent, writing the fixed marked content', () => {
    const result = applyRootInstructionFiles(root, { includeClaudeMd: true });
    expect(result).toEqual({ agentsMd: 'created', claudeMd: 'created' });
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toBe(AGENTS_MD_CONTENT);
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toBe(CLAUDE_MD_CONTENT);
  });

  it('reports identical and writes nothing when both already match', () => {
    writeFileSync(join(root, 'AGENTS.md'), AGENTS_MD_CONTENT);
    writeFileSync(join(root, 'CLAUDE.md'), CLAUDE_MD_CONTENT);
    const result = applyRootInstructionFiles(root, { includeClaudeMd: true });
    expect(result).toEqual({ agentsMd: 'identical', claudeMd: 'identical' });
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toBe(AGENTS_MD_CONTENT);
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toBe(CLAUDE_MD_CONTENT);
  });

  // AC011(c): append to an existing user-authored file, content intact above.
  it('appends the managed block to a user-authored file, separated by a blank line, user content untouched', () => {
    const custom = '# My own AGENTS.md\n\nMy own rules stay first.\n';
    writeFileSync(join(root, 'AGENTS.md'), custom);
    const result = applyRootInstructionFiles(root, { includeClaudeMd: false });
    expect(result).toEqual({ agentsMd: 'appended' });
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toBe(
      `${custom}\n${extractBlock(AGENTS_MD_CONTENT)}\n`,
    );
  });

  it('appends to a user file lacking a trailing newline without gluing lines together', () => {
    const custom = '# My own CLAUDE.md, no trailing newline';
    writeFileSync(join(root, 'CLAUDE.md'), custom);
    const result = applyRootInstructionFiles(root, { includeClaudeMd: true });
    expect(result.claudeMd).toBe('appended');
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toBe(
      `${custom}\n\n${extractBlock(CLAUDE_MD_CONTENT)}\n`,
    );
  });

  it('a rerun after appending reports identical and never double-appends', () => {
    const custom = '# My own AGENTS.md\n';
    writeFileSync(join(root, 'AGENTS.md'), custom);
    applyRootInstructionFiles(root, { includeClaudeMd: false });
    const after = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    const result = applyRootInstructionFiles(root, { includeClaudeMd: false });
    expect(result).toEqual({ agentsMd: 'identical' });
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toBe(after);
  });

  // AC011(d): a byte-equal legacy PitWay-generated file is rewritten to the
  // new marked form outright -- never appended-to, which would duplicate it.
  it('rewrites a legacy PitWay-generated file to the new marked form outright', () => {
    writeFileSync(join(root, 'AGENTS.md'), LEGACY_AGENTS_MD);
    writeFileSync(join(root, 'CLAUDE.md'), LEGACY_CLAUDE_MD);
    const result = applyRootInstructionFiles(root, { includeClaudeMd: true });
    expect(result).toEqual({ agentsMd: 'migrated', claudeMd: 'migrated' });
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toBe(AGENTS_MD_CONTENT);
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toBe(CLAUDE_MD_CONTENT);
  });

  // AC011(e): a differing managed block is the future update command's job.
  it('leaves a file with a present-but-differing managed block completely unmodified, reporting preserved', () => {
    const tampered = CLAUDE_MD_CONTENT.replace('@AGENTS.md', '@SOMETHING_ELSE.md');
    writeFileSync(join(root, 'CLAUDE.md'), tampered);
    const result = applyRootInstructionFiles(root, { includeClaudeMd: true });
    expect(result.claudeMd).toBe('preserved');
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toBe(tampered);
  });

  it('includeClaudeMd: false handles AGENTS.md only, with no claudeMd key and CLAUDE.md never written', () => {
    const result = applyRootInstructionFiles(root, { includeClaudeMd: false });
    expect(result).toEqual({ agentsMd: 'created' });
    expect('claudeMd' in result).toBe(false);
    expect(() => readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toThrow();
  });
});

// M043/T002 (AC002, AC005): a file carrying the exact PRIOR managed block
// (as shipped before protocol-orchestrator.md existed) is migrated in place
// -- only the block is replaced -- while any other differing block is still
// preserved. Frozen prior text is re-declared here independently so a
// drift in the production constant fails by name.
const PRIOR_AGENTS_BLOCK = `<!-- pitway:managed:start -->\n${LEGACY_BULLETS}\n<!-- pitway:managed:end -->`;
const PRIOR_CLAUDE_BLOCK =
  '<!-- pitway:managed:start -->\n@AGENTS.md\n\n' +
  'See .claude/protocol-driver.md for the full Claude Code driver protocol.\n<!-- pitway:managed:end -->';

describe('known prior managed block migrates in place (M043/T002)', () => {
  it('classifies the prior AGENTS.md and CLAUDE.md blocks as prior_block conflicts', () => {
    writeFileSync(join(root, 'AGENTS.md'), `# Agent Instructions\n\n${PRIOR_AGENTS_BLOCK}\n`);
    writeFileSync(join(root, 'CLAUDE.md'), `# Claude Code Instructions\n\n${PRIOR_CLAUDE_BLOCK}\n`);
    expect(classifyRootInstructionFiles(root)).toEqual([
      { file: 'AGENTS.md', status: 'conflict', conflictKind: 'prior_block' },
      { file: 'CLAUDE.md', status: 'conflict', conflictKind: 'prior_block' },
    ]);
  });

  it('replaces only the block, leaving user content above and below untouched, and reports migrated', () => {
    const above = '# My hand-written AGENTS.md\n\nKeep this.\n\n';
    const below = '\n\n## More of mine\n\nAnd this.\n';
    writeFileSync(join(root, 'AGENTS.md'), `${above}${PRIOR_AGENTS_BLOCK}${below}`);
    writeFileSync(join(root, 'CLAUDE.md'), `# Claude Code Instructions\n\n${PRIOR_CLAUDE_BLOCK}\n`);
    const result = applyRootInstructionFiles(root, { includeClaudeMd: true });
    expect(result).toEqual({ agentsMd: 'migrated', claudeMd: 'migrated' });
    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    expect(agents.startsWith(above)).toBe(true);
    expect(agents.endsWith(below)).toBe(true);
    expect(agents).toContain('protocol-orchestrator.md');
    expect(agents).not.toContain(PRIOR_AGENTS_BLOCK);
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toBe(CLAUDE_MD_CONTENT);
    // A rerun is identical: nothing rewritten twice.
    expect(applyRootInstructionFiles(root, { includeClaudeMd: true })).toEqual({ agentsMd: 'identical', claudeMd: 'identical' });
  });

  it('still preserves a managed block that matches neither current nor prior', () => {
    writeFileSync(join(root, 'AGENTS.md'), '# x\n\n<!-- pitway:managed:start -->\nsomething else\n<!-- pitway:managed:end -->\n');
    expect(classifyRootInstructionFiles(root, { includeClaudeMd: false })).toEqual([
      { file: 'AGENTS.md', status: 'conflict', conflictKind: 'block_mismatch' },
    ]);
    expect(applyRootInstructionFiles(root, { includeClaudeMd: false })).toEqual({ agentsMd: 'preserved' });
  });
});
