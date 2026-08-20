import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MIN_DESCRIPTION_LENGTH = 20;

// T006: a pure, local function -- no filesystem access of its own, so every
// negative case below is exercised with synthetic string literals, never by
// mutating a real vendored file. This is a structural floor only (name/
// description shape); it never judges description quality or content.
//
// Deliberately NOT a full YAML-document parse: real vendored descriptions
// are free text that may itself contain an unquoted colon (e.g. "one diff
// or branch use the code-quality-review skill."), which a strict YAML
// parser rejects as an ambiguous nested mapping even though it is
// perfectly valid frontmatter in practice. Extracting exactly the two
// single-line keys this shape actually uses avoids that false positive
// without weakening what's actually checked (both real content-driven
// requirements are the same either way).
function validateSkillFrontmatter(directoryName: string, skillMdContent: string): string[] {
  const violations: string[] = [];
  const block = /^---\n([\s\S]*?)\n---/.exec(skillMdContent);
  if (!block) {
    violations.push('missing YAML frontmatter block');
    return violations;
  }
  const frontmatter = block[1]!;

  const nameMatch = /^name:\s*(.*)$/m.exec(frontmatter);
  const name = nameMatch?.[1]?.trim();
  if (!name) {
    violations.push('missing or empty name');
  } else {
    if (!KEBAB_CASE.test(name)) {
      violations.push(`name "${name}" is not valid kebab-case`);
    }
    if (name !== directoryName) {
      violations.push(`name "${name}" does not match its own directory "${directoryName}"`);
    }
  }

  const descriptionMatch = /^description:\s*(.*)$/m.exec(frontmatter);
  const description = descriptionMatch?.[1]?.trim();
  if (!description) {
    violations.push('missing or empty description');
  } else if (description.length < MIN_DESCRIPTION_LENGTH) {
    violations.push(`description is shorter than ${MIN_DESCRIPTION_LENGTH} characters`);
  }

  return violations;
}

describe('validateSkillFrontmatter (pure, synthetic inputs only)', () => {
  const valid = 'debugging';
  const validContent = `---\nname: debugging\ndescription: A description that is definitely long enough.\n---\n\n# Debugging\n`;

  it('reports zero violations for valid frontmatter', () => {
    expect(validateSkillFrontmatter(valid, validContent)).toEqual([]);
  });

  it('reports a violation for a missing name', () => {
    const content = `---\ndescription: A description that is definitely long enough.\n---\n`;
    expect(validateSkillFrontmatter(valid, content)).toContain('missing or empty name');
  });

  it('reports a violation for a missing description', () => {
    const content = `---\nname: debugging\n---\n`;
    expect(validateSkillFrontmatter(valid, content)).toContain('missing or empty description');
  });

  it('reports a violation for a non-kebab-case name', () => {
    const content = `---\nname: Debugging_Skill\ndescription: A description that is definitely long enough.\n---\n`;
    const violations = validateSkillFrontmatter('Debugging_Skill', content);
    expect(violations.some((v) => v.includes('kebab-case'))).toBe(true);
  });

  it('reports a violation when name does not match its own directory', () => {
    const content = `---\nname: debugging\ndescription: A description that is definitely long enough.\n---\n`;
    const violations = validateSkillFrontmatter('bug-fix', content);
    expect(violations.some((v) => v.includes('does not match'))).toBe(true);
  });

  it('reports a violation for a too-short description', () => {
    const content = `---\nname: debugging\ndescription: Too short.\n---\n`;
    expect(
      validateSkillFrontmatter(valid, content).some((v) => v.includes('shorter than')),
    ).toBe(true);
  });

  it('reports a violation for missing frontmatter entirely', () => {
    expect(validateSkillFrontmatter(valid, '# Just a heading\n')).toEqual([
      'missing YAML frontmatter block',
    ]);
  });
});

// Positive case: reads every real vendored SKILL.md, read-only. No
// writeFileSync/rmSync/renameSync anywhere in this file.
describe('vendored skills structural validation (real files, read-only)', () => {
  const skillsRoot = fileURLToPath(new URL('../../src/integrations/claude/skills/', import.meta.url));
  const directories = readdirSync(skillsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  it('discovers exactly the six vendored skill directories', () => {
    expect(directories).toEqual([
      'architecture-review',
      'bug-fix',
      'code-quality-review',
      'debugging',
      'security-audit',
      'testing',
    ]);
  });

  it.each(directories)('%s/SKILL.md has zero structural violations', (directoryName) => {
    const content = readFileSync(`${skillsRoot}${directoryName}/SKILL.md`, 'utf8');
    expect(validateSkillFrontmatter(directoryName, content)).toEqual([]);
  });

  it('every vendored skill has a unique name -- no duplicates across the real set', () => {
    const names = directories.map((directoryName) => {
      const content = readFileSync(`${skillsRoot}${directoryName}/SKILL.md`, 'utf8');
      const block = /^---\n([\s\S]*?)\n---/.exec(content)!;
      const nameMatch = /^name:\s*(.*)$/m.exec(block[1]!)!;
      return nameMatch[1]!.trim();
    });
    expect(new Set(names).size).toBe(names.length);
  });
});
