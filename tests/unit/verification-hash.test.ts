import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computeVerificationHash } from '../../src/core/contracts/verification-hash.js';

// Canonicalization contract: sha256 of the raw text of the frontmatter's
// `verification:` block — from the line "verification:" up to (excluding)
// the closing "---" — exactly as the manual bootstrap protocol computed it
// with sed+shasum for M001/M002/M003.
const m003Contract = fileURLToPath(
  new URL('../../.pitway/milestones/M003/contract.md', import.meta.url),
);

describe('computeVerificationHash', () => {
  it('matches the manual sed/shasum canonicalization on the real M003 contract', () => {
    const text = readFileSync(m003Contract, 'utf8');
    const expected = execSync(
      `sed -n '/^verification:/,/^---$/p' '${m003Contract}' | sed '$d' | shasum -a 256 | cut -d' ' -f1`,
    )
      .toString()
      .trim();
    expect(computeVerificationHash(text)).toBe(`sha256:${expected}`);
  });

  it('equals the recorded approved hash of the confirmed M003 contract', () => {
    const text = readFileSync(m003Contract, 'utf8');
    const recorded = /verification_approved_hash: (sha256:[0-9a-f]{64})/.exec(text)?.[1];
    expect(computeVerificationHash(text)).toBe(recorded);
  });

  it('changes when a verification command changes and is insensitive to body changes', () => {
    const base = [
      '---',
      'schema_version: 1',
      'verification:',
      '  - id: CT001',
      '    criterion: AC001',
      '    type: command',
      '    command: npm test',
      '---',
      '',
      '# Body prose',
    ].join('\n');
    const changedCommand = base.replace('npm test', 'npm test -- --evil');
    const changedBody = base.replace('# Body prose', '# Different prose');
    expect(computeVerificationHash(changedCommand)).not.toBe(computeVerificationHash(base));
    expect(computeVerificationHash(changedBody)).toBe(computeVerificationHash(base));
  });

  it('throws on a contract without a verification block', () => {
    expect(() => computeVerificationHash('---\nschema_version: 1\n---\nbody')).toThrowError(
      /verification/,
    );
  });
});
