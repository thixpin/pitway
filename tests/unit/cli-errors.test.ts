import { describe, expect, it } from 'vitest';
import { renderCliError } from '../../src/cli/errors.js';
import { StateStoreError } from '../../src/state/store.js';

class SomeCoreError extends Error {}

describe('renderCliError (M017/T005, AC003)', () => {
  it('renders a PitWay-authored error as its own clean message, no stack', () => {
    const rendered = renderCliError(new SomeCoreError('cannot do the thing'));
    expect(rendered).toEqual({ message: 'cannot do the thing', exitCode: 1, printStack: false });
  });

  it('maps a StateStoreError whose cause is ENOENT on state.yaml to the actionable missing-state message', () => {
    const enoent = Object.assign(new Error("ENOENT: no such file or directory, open '/repo/.pitway/state.yaml'"), {
      code: 'ENOENT',
    });
    const error = new StateStoreError('cannot read /repo/.pitway/state.yaml: ENOENT...', { cause: enoent });
    const rendered = renderCliError(error);
    expect(rendered.printStack).toBe(false);
    expect(rendered.exitCode).toBe(1);
    expect(rendered.message).toMatch(/pitway init/);
    expect(rendered.message).toMatch(/\.pitway\//);
  });

  it('does not misfire the missing-state diagnostic for an ordinary StateStoreError', () => {
    const rendered = renderCliError(new StateStoreError('invalid /repo/.pitway/config.yaml: bad schema'));
    expect(rendered.message).toBe('invalid /repo/.pitway/config.yaml: bad schema');
    expect(rendered.printStack).toBe(false);
  });

  it('does not misfire the missing-state diagnostic for an ENOENT on a different file', () => {
    const enoent = Object.assign(new Error("ENOENT: no such file or directory, open '/repo/.pitway/config.yaml'"), {
      code: 'ENOENT',
    });
    const error = new StateStoreError('cannot read /repo/.pitway/config.yaml: ENOENT...', { cause: enoent });
    const rendered = renderCliError(error);
    expect(rendered.message).toBe('cannot read /repo/.pitway/config.yaml: ENOENT...');
  });

  it('keeps the stack for a builtin error type -- a real bug, not an expected refusal', () => {
    const rendered = renderCliError(new TypeError('cannot read properties of undefined'));
    expect(rendered).toEqual({
      message: 'cannot read properties of undefined',
      exitCode: 1,
      printStack: true,
    });
  });

  it('keeps the stack for a non-Error throw', () => {
    const rendered = renderCliError('a plain string throw');
    expect(rendered).toEqual({ message: 'a plain string throw', exitCode: 1, printStack: true });
  });
});
