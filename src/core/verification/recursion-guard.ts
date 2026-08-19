// Pure recursion-guard decision function (AC001). Prevents a verification
// command from re-entering runVerification for the SAME live repository +
// milestone, while explicitly permitting nested verification of an
// unrelated repository or milestone. This module does zero I/O and zero
// git calls: it only reasons about the accumulated guard-token env value
// (a comma-separated list of previously-entered repo+milestone tokens) and
// a candidate token. Resolving the actual git-dir identity into a token is
// a later task's responsibility.

const SEPARATOR = ',';

export type RecursionGuardDecision =
  | { decision: 'extend'; value: string }
  | { decision: 'refuse'; token: string };

export function evaluateRecursionGuard(
  currentValue: string | undefined,
  candidateToken: string,
): RecursionGuardDecision {
  const tokens = currentValue ? currentValue.split(SEPARATOR).filter((t) => t.length > 0) : [];
  if (tokens.includes(candidateToken)) {
    return { decision: 'refuse', token: candidateToken };
  }
  return { decision: 'extend', value: [...tokens, candidateToken].join(SEPARATOR) };
}
