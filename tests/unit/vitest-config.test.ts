import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import vitestConfig from '../../vitest.config.js';

// M017/T007 (AC007): a global vitest.config.ts is the only place that can
// actually widen Vitest's default per-test/per-hook budget for every
// heavy real-git-subprocess test, not just the one that first surfaced the
// timeout (M016/T001). This is the only check that can observe the AC --
// the config's effect is invisible to any test that merely runs fast.
describe('vitest.config.ts (M017/T007)', () => {
  it('exports testTimeout and hookTimeout at 60000', () => {
    expect(vitestConfig.test?.testTimeout).toBe(60000);
    expect(vitestConfig.test?.hookTimeout).toBe(60000);
  });

  it('carries the M016/T001 root-cause comment', () => {
    const source = readFileSync(new URL('../../vitest.config.ts', import.meta.url), 'utf8');
    expect(source).toContain('M016/T001');
    expect(source).toContain('Test timed out in 5000ms');
  });

  it('completed-task-revision-path.test.ts no longer overrides the per-test timeout', () => {
    const source = readFileSync(
      new URL('../integration/completed-task-revision-path.test.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/}, *\d+\);/);
  });
});
