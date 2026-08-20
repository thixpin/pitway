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

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pitway-root-instructions-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

// T004: focused unit tests for classifyRootInstructionFiles and
// applyRootInstructionFiles against a real temp directory tree.
describe('classifyRootInstructionFiles', () => {
  it('classifies both files absent when neither exists', () => {
    expect(classifyRootInstructionFiles(root)).toEqual([
      { file: 'AGENTS.md', status: 'absent' },
      { file: 'CLAUDE.md', status: 'absent' },
    ]);
  });

  it('classifies a byte-identical file as identical', () => {
    writeFileSync(join(root, 'AGENTS.md'), AGENTS_MD_CONTENT);
    writeFileSync(join(root, 'CLAUDE.md'), CLAUDE_MD_CONTENT);
    expect(classifyRootInstructionFiles(root)).toEqual([
      { file: 'AGENTS.md', status: 'identical' },
      { file: 'CLAUDE.md', status: 'identical' },
    ]);
  });

  it('classifies a byte-different file as conflict', () => {
    writeFileSync(join(root, 'AGENTS.md'), '# My own AGENTS.md\n');
    expect(classifyRootInstructionFiles(root)[0]).toEqual({ file: 'AGENTS.md', status: 'conflict' });
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
  it('creates both files when absent, writing the fixed content', () => {
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
  });

  it('preserves a conflicting file byte-for-byte, never writing or appending', () => {
    const custom = '# My own AGENTS.md, do not touch\n';
    writeFileSync(join(root, 'AGENTS.md'), custom);
    const result = applyRootInstructionFiles(root, { includeClaudeMd: false });
    expect(result).toEqual({ agentsMd: 'preserved' });
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toBe(custom);
  });

  it('includeClaudeMd: false creates/preserves AGENTS.md only, with no claudeMd key at all', () => {
    const result = applyRootInstructionFiles(root, { includeClaudeMd: false });
    expect(result).toEqual({ agentsMd: 'created' });
    expect('claudeMd' in result).toBe(false);
  });
});
