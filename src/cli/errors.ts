import { StateStoreError } from '../state/store.js';

// M017/T005 (AC003): builtin JS error types indicate a genuine unexpected
// bug -- their stack survives so it can be debugged. Every PitWay-authored
// error class (StateStoreError, and the Core layer's many `*Error` classes,
// none of which extend a shared base) is a distinct, non-builtin
// constructor name, which is what actually separates "an expected refusal"
// from "something broke" without importing every one of those classes here.
const BUILTIN_ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'ReferenceError',
  'EvalError',
  'URIError',
]);

function isPitwayError(error: unknown): error is Error {
  return error instanceof Error && !BUILTIN_ERROR_NAMES.has(error.constructor.name);
}

// The one diagnostic PitWay can give beyond the raw error: a StateStoreError
// whose cause is exactly the ENOENT that fired reading .pitway/state.yaml
// (loadState's first read on every command) means there is no PitWay
// workspace here at all -- a wrong directory or the wrong branch, not a
// corrupted one.
function isMissingStateYaml(error: StateStoreError): boolean {
  const cause = error.cause as NodeJS.ErrnoException | undefined;
  return cause?.code === 'ENOENT' && error.message.includes('state.yaml');
}

const MISSING_STATE_MESSAGE =
  'no PitWay workspace found (.pitway/state.yaml is missing). Run `pitway init` in a ' +
  'repository root, or check out the branch that carries .pitway/.';

export interface RenderedCliError {
  message: string;
  exitCode: number;
  printStack: boolean;
}

// The CLI's one error boundary: an expected PitWay refusal prints its clean
// message only; anything else (a real bug, a builtin error type) keeps its
// stack so it stays debuggable. Never used by in-process tests -- those
// catch the raw thrown error directly, unaffected by this formatting.
export function renderCliError(error: unknown): RenderedCliError {
  if (isPitwayError(error)) {
    if (error instanceof StateStoreError && isMissingStateYaml(error)) {
      return { message: MISSING_STATE_MESSAGE, exitCode: 1, printStack: false };
    }
    return { message: error.message, exitCode: 1, printStack: false };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { message, exitCode: 1, printStack: true };
}
