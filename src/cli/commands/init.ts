import type { Command } from 'commander';
import { assertGitWorkTree } from '../../git/exec.js';
import { classifyClaudeAssets, installClaudeAssets } from '../../state/claude-assets.js';
import {
  classifyDriverAssets,
  driverDestinationDir,
  installDriverAssets,
} from '../../state/driver-assets.js';
import {
  AGENTS_MD_CONTENT,
  CLAUDE_MD_CONTENT,
  applyRootInstructionFiles,
  type ApplyRootInstructionFilesResult,
} from '../../state/root-instructions.js';
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
  opencodeInstalled: boolean;
  rootInstructions: ApplyRootInstructionFilesResult;
}

export function runInit(
  root: string,
  options: { claude?: boolean; opencode?: boolean } = {},
): InitView {
  assertGitWorkTree(root);
  const config = probe(() => loadConfig(root));
  const state = probe(() => loadState(root));

  const installClaude = options.claude ?? true;
  // M023/T002/AC006: OpenCode installation is opt-in (--opencode), additive
  // alongside the default-on Claude installation; without the flag no
  // .opencode/ path is ever read or written.
  const installOpencode = options.opencode ?? false;
  // Classified up front, alongside config/state, so every refusal is
  // decided before anything is written — installing driver assets must
  // never happen if the overall call is about to refuse for an unrelated
  // reason. --no-claude skips classification and every .claude/ read
  // entirely; the same discipline applies to .opencode/ without --opencode.
  const classification = installClaude ? classifyClaudeAssets(root) : [];
  const opencodeClassification = installOpencode ? classifyDriverAssets(root, 'opencode') : [];
  const conflicts = [
    ...classification
      .filter((c) => c.status === 'conflict')
      .map((c) => `${driverDestinationDir('claude')}/${c.asset}`),
    ...opencodeClassification
      .filter((c) => c.status === 'conflict')
      .map((c) => `${driverDestinationDir('opencode')}/${c.asset}`),
  ];
  // Per-file, content-comparing refusal: only an actual byte conflict
  // refuses, naming every conflicting path together (not just the first),
  // across both drivers. A harmless partial mix (some assets absent, none
  // differing) is no longer refused — see finish() below.
  if (conflicts.length > 0) {
    throw new Error(
      'refusing to initialize: existing driver assets have conflicting content relative to the ' +
        `pitway-managed assets shipped under src/integrations/ (will not overwrite): ${conflicts.join(
          ', ',
        )} — inspect manually (or skip driver asset installation via --no-claude / omitting --opencode)`,
    );
  }

  function finish(created: boolean, message: string): InitView {
    let claudeInstalled = false;
    if (installClaude) {
      const absent = classification.filter((c) => c.status === 'absent').map((c) => c.asset);
      if (absent.length > 0) {
        installClaudeAssets(root, absent);
        claudeInstalled = true;
      }
    }
    let opencodeInstalled = false;
    if (installOpencode) {
      const absent = opencodeClassification.filter((c) => c.status === 'absent').map((c) => c.asset);
      if (absent.length > 0) {
        installDriverAssets(root, 'opencode', absent);
        opencodeInstalled = true;
      }
    }
    // AC004/T004: strictly after the .claude/ conflict preflight above has
    // already passed (or been skipped via --no-claude) -- a refused
    // Claude-asset install must never leave a partial instruction setup.
    // --no-claude still creates/preserves AGENTS.md, since it is the
    // generic agent-discovery file, not a Claude-specific asset.
    const rootInstructions = applyRootInstructionFiles(root, { includeClaudeMd: installClaude });
    return { created, message, claudeInstalled, opencodeInstalled, rootInstructions };
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
    .option('--opencode', 'also install OpenCode integration assets (.opencode/)')
    .option('--json', 'output machine-readable JSON')
    .action((options: { claude?: boolean; opencode?: boolean; json?: boolean }) => {
      const root = deps.root ?? process.cwd();
      const view = runInit(root, { claude: options.claude, opencode: options.opencode });
      write(renderOutput(view, { json: options.json }, (v) => `🏁 ${v.message}`));
      if (!options.json) {
        if (view.rootInstructions.agentsMd === 'preserved') {
          write(
            `⚠️  AGENTS.md already exists with different content; left untouched. ` +
              `PitWay's own AGENTS.md would contain:\n${AGENTS_MD_CONTENT}`,
          );
        }
        if (view.rootInstructions.claudeMd === 'preserved') {
          write(
            `⚠️  CLAUDE.md already exists with different content; left untouched. ` +
              `PitWay's own CLAUDE.md would contain:\n${CLAUDE_MD_CONTENT}`,
          );
        }
      }
    });
}
