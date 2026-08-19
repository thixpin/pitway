// Test fixture for process-exec.ts's descendant-cleanup tests. Ignores
// SIGTERM and, unless invoked with --child, forks a child (also ignoring
// SIGTERM) that inherits its stdio — reproducing the M005 hang shape: a
// process tree that keeps a stdout/stderr pipe open past a plain SIGTERM.
// Writes {parent, child} pids to the file path given as the first argument
// (the parent already knows the child's pid synchronously from spawn(), so
// the child itself never needs to report in), then idles until killed.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

process.on('SIGTERM', () => {
  // ignore
});

const pidFile = process.argv[2];
const isChild = process.argv.includes('--child');

if (!isChild) {
  const child = spawn(
    process.execPath,
    [import.meta.url.replace('file://', ''), pidFile, '--child'],
    { stdio: 'inherit' },
  );
  writeFileSync(pidFile, JSON.stringify({ parent: process.pid, child: child.pid }));
}

setInterval(() => {}, 1000);
