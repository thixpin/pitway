#!/usr/bin/env node
// tsc compiles TypeScript to JS but has no concept of Unix file permissions,
// so dist/cli/index.js -- the package's own `bin` entry, shebang and all --
// always comes out of every build non-executable. That went unnoticed
// through every prior npm-pack/install smoke test (none of them exercise
// npm's own publish-time bin validation), and only surfaced during the real
// first `npm publish`: npm auto-corrects a non-executable bin script by
// silently REMOVING the `bin` entry from the published package.json rather
// than failing the command, which would have shipped a `pitway` package
// with no `pitway` CLI command at all. `fs.chmodSync` (not a shell `chmod`)
// keeps this step meaningful on every platform `npm run build` runs on.
import { chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const binEntry = join(here, '..', 'dist', 'cli', 'index.js');

chmodSync(binEntry, 0o755);
