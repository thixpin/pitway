import { createHash } from 'node:crypto';

// Canonicalization: the raw text of the frontmatter's `verification:` block,
// from the line "verification:" through the line before the closing "---",
// hashed with sha256. This matches the manual sed/shasum protocol used to
// approve M001-M003, so hashes recorded during bootstrap stay verifiable.
export function computeVerificationHash(contractText: string): string {
  const lines = contractText.split('\n');
  const start = lines.findIndex((line) => line === 'verification:');
  if (start === -1) {
    throw new Error('contract has no verification block to hash');
  }
  const end = lines.findIndex((line, i) => i > start && line === '---');
  if (end === -1) {
    throw new Error('contract verification block has no closing frontmatter delimiter');
  }
  // Join with trailing newline to match the raw line-stream sed produced.
  const block = lines.slice(start, end).join('\n') + '\n';
  return `sha256:${createHash('sha256').update(block).digest('hex')}`;
}
