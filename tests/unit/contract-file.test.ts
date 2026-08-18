import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseContractFile, serializeContractFile } from '../../src/state/contract-file.js';

const frontmatterYaml = readFileSync(
  new URL('../fixtures/valid/contract-frontmatter.yaml', import.meta.url),
  'utf8',
);

const body = [
  '',
  '# Contract — M001',
  '',
  '## Objective',
  '',
  'Do the thing.   ',
  '',
  '```yaml',
  'status: in_progress',
  '```',
  '',
].join('\n');

const contractText = `---\n${frontmatterYaml}---\n${body}`;

describe('parseContractFile', () => {
  it('parses frontmatter into a validated object', () => {
    const contract = parseContractFile(contractText);
    expect(contract.frontmatter.id).toBe('M001');
    expect(contract.frontmatter.status).toBe('in_progress');
    expect(contract.frontmatter.acceptance_criteria).toHaveLength(2);
    expect(contract.frontmatter.verification).toHaveLength(3);
  });

  it('preserves the body byte-for-byte', () => {
    const contract = parseContractFile(contractText);
    expect(contract.body).toBe(body);
  });

  it('rejects text without a frontmatter block', () => {
    expect(() => parseContractFile('# Just markdown\n')).toThrowError(/frontmatter/);
  });

  it('rejects invalid frontmatter naming the offending field', () => {
    const broken = contractText.replace('status: in_progress\nrequirement', 'status: racing\nrequirement');
    expect(() => parseContractFile(broken)).toThrowError(/status/);
  });
});

describe('serializeContractFile', () => {
  it('round-trips frontmatter data and body without loss', () => {
    const contract = parseContractFile(contractText);
    const reparsed = parseContractFile(serializeContractFile(contract));
    expect(reparsed.frontmatter).toEqual(contract.frontmatter);
    expect(reparsed.body).toBe(contract.body);
  });
});
