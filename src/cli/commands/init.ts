import type { Command } from 'commander';
import { assertGitWorkTree } from '../../git/exec.js';
import { installClaudeAssets, probeClaudeAssets } from '../../state/claude-assets.js';
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
  claudeInstalled: boolean;
}

export function runInit(root: string, options: { claude?: boolean } = {}): InitView {
  assertGitWorkTree(root);
  const config = probe(() => loadConfig(root));
  const state = probe(() => loadState(root));

  const installClaude = options.claude ?? true;
  // Probed up front, alongside config/state, so every refusal is decided
  // before anything is written — installing .claude/ assets must never
  // happen if the overall call is about to refuse for an unrelated reason.
  const claudeProbe = installClaude ? probeClaudeAssets(root) : 'ok';
  // Same refusal philosophy as config/state: a fresh install on 'missing',
  // a safe no-op on 'ok', and a hard refusal on any partial/inconsistent
  // mix of the pitway-managed asset set rather than silently overwriting
  // whatever's already under .claude/.
  if (installClaude && claudeProbe === 'invalid') {
    throw new Error(
      'refusing to initialize: .claude/ is in a partial or inconsistent state relative to the ' +
        'pitway-managed assets under src/integrations/claude/; will not overwrite — inspect manually ' +
        '(or pass --no-claude to skip Claude Code asset installation)',
    );
  }

  function finish(created: boolean, message: string): InitView {
    let claudeInstalled = false;
    if (installClaude && claudeProbe === 'missing') {
      installClaudeAssets(root);
      claudeInstalled = true;
    }
    return { created, message, claudeInstalled };
  }

  if (config === 'missing' && state === 'missing') {
    saveConfig(root, { schema_version: 1 });
    saveState(root, { schema_version: 1, active_milestone: null, milestones: [] });
    return finish(true, 'Initialized .pitway/ (config.yaml, state.yaml).');
  }
  if (config === 'ok' && state === 'ok') {
    return finish(false, '.pitway/ already initialized; nothing to do.');
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
    .option('--no-claude', 'skip installing Claude Code integration assets (.claude/)')
    .option('--json', 'output machine-readable JSON')
    .action((options: { claude?: boolean; json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const view = runInit(root, { claude: options.claude });
      write(renderOutput(view, { json: options.json }, (v) => `🏁 ${v.message}`));
    });
}
