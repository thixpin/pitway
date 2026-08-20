import { describe, expect, it } from 'vitest';
import { RequiredSkillsError, assertRequiredSkillsAvailable } from '../../src/core/tasks/skills.js';

// T003: assertRequiredSkillsAvailable is pure -- exercised directly against
// plain string arrays, no fixtures, no filesystem.
describe('assertRequiredSkillsAvailable', () => {
  it('is a complete no-op when requiredNames is empty, regardless of availableNames', () => {
    expect(() => assertRequiredSkillsAvailable([], [])).not.toThrow();
    expect(() => assertRequiredSkillsAvailable([], ['debugging'])).not.toThrow();
  });

  it('does not throw when every required name is available', () => {
    expect(() =>
      assertRequiredSkillsAvailable(['debugging'], ['debugging', 'testing']),
    ).not.toThrow();
    expect(() =>
      assertRequiredSkillsAvailable(
        ['debugging', 'testing'],
        ['debugging', 'testing', 'bug-fix'],
      ),
    ).not.toThrow();
  });

  it('throws RequiredSkillsError naming a single missing skill', () => {
    try {
      assertRequiredSkillsAvailable(['debugging'], ['testing']);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RequiredSkillsError);
      expect((error as Error).message).toContain('debugging');
    }
  });

  it('throws naming both missing skills when two are declared and both missing', () => {
    try {
      assertRequiredSkillsAvailable(['debugging', 'testing'], ['bug-fix']);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain('debugging');
      expect((error as Error).message).toContain('testing');
    }
  });

  it('names only the actually-missing skill when one of two is available', () => {
    try {
      assertRequiredSkillsAvailable(['debugging', 'testing'], ['debugging']);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain('testing');
      expect((error as Error).message).not.toContain('debugging');
    }
  });
});
