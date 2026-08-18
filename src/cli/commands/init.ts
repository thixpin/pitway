import type { Command } from 'commander';
import { assertGitWorkTree } from '../../git/exec.js';
import { StateStoreError, loadConfig, loadState, saveConfig, saveState } from '../../state/store.js';
import { renderOutput } from '../output.js';

type Probe = 'ok' | 'missing' | 'invalid';

function probe(load: () => unknown): Probe {
  try {
    load();
    return 'ok';
  } catch (error) {
    if (error instanceof StateStoreError && error.message.startsWith('cannot read')) {
      return 'missing';
    }
    return 'invalid';
  }
}

export interface InitView {
  created: boolean;
  message: string;
}

export function runInit(root: string): InitView {
  assertGitWorkTree(root);
  const config = probe(() => loadConfig(root));
  const state = probe(() => loadState(root));

  if (config === 'missing' && state === 'missing') {
    saveConfig(root, { schema_version: 1 });
    saveState(root, { schema_version: 1, active_milestone: null, milestones: [] });
    return { created: true, message: 'Initialized .pitway/ (config.yaml, state.yaml).' };
  }
  if (config === 'ok' && state === 'ok') {
    return { created: false, message: '.pitway/ already initialized; nothing to do.' };
  }
  throw new Error(
    `refusing to initialize: .pitway/ is in an inconsistent or partial state ` +
      `(config.yaml: ${config}, state.yaml: ${state}); will not overwrite — inspect manually`,
  );
}

export interface CommandDeps {
  root?: string;
  write?: (line: string) => void;
}

export function registerInitCommand(program: Command, deps: CommandDeps = {}): void {
  const write = deps.write ?? ((line: string) => console.log(line));
  program
    .command('init')
    .description('Initialize repository-local PitWay state (.pitway/).')
    .option('--json', 'output machine-readable JSON')
    .action((options: { json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const view = runInit(root);
      write(renderOutput(view, { json: options.json }, (v) => `🏁 ${v.message}`));
    });
}
