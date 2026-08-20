// AC003/T003: pure Core comparison, nothing else. No filesystem access, no
// root parameter, no node:fs import, and no knowledge of .claude/ or any
// install-path convention anywhere in this file -- it only compares two
// plain string arrays. The State layer (src/state/claude-assets.ts's
// listInstalledSkillNames) owns discovering what is actually installed;
// the CLI layer (task-status.ts) composes the two.

export class RequiredSkillsError extends Error {}

// A complete no-op when requiredNames is empty. Otherwise throws, naming
// every entry of requiredNames absent from availableNames -- not just the
// first.
export function assertRequiredSkillsAvailable(
  requiredNames: string[],
  availableNames: string[],
): void {
  if (requiredNames.length === 0) return;
  const available = new Set(availableNames);
  const missing = requiredNames.filter((name) => !available.has(name));
  if (missing.length > 0) {
    throw new RequiredSkillsError(`required skill(s) not installed: ${missing.join(', ')}`);
  }
}
