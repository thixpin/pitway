import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // M016/T001 root cause: PitWay's integration tests spawn real `git`
    // subprocesses against real temp repos, never mocked. Diagnosed via the
    // debugging skill by reproducing directly: running two full `vitest run`
    // invocations concurrently -- the same real-subprocess-load condition
    // `task-verify`/`verify` create by nesting a full suite run inside
    // itself -- failed heavy real-git-subprocess tests every time with
    // `Error: Test timed out in 5000ms` (Vitest's default per-test/per-hook
    // budget), never with a thrown error or a wrong result. That uniform,
    // timing-only failure pattern across unrelated tests rules out a PitWay
    // defect and points at inherent OS-level contention (CPU/fork scheduling
    // delays) when many real git child processes run concurrently under
    // load. A wider budget is a ceiling on legitimately slow-but-correct
    // work, not a wait and not a retry: a hung or genuinely broken test
    // still fails, just later, and retrying would hide a real failure if one
    // ever occurs.
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
