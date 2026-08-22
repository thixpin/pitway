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
  // Repo-relative destination paths of PitWay-owned driver assets whose
  // installed bytes differ from the shipped version: left completely
  // untouched (never overwritten, never a refusal) and reported here for a
  // future `pitway update` to reconcile. Additive field; empty on a clean
  // install.
  preservedAssets: string[];
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
  // Classified up front, alongside config/state, so what happens to every
  // driver asset is decided before anything is written. --no-claude skips
  // classification and every .claude/ read entirely; the same discipline
  // applies to .opencode/ without --opencode.
  const classification = installClaude ? classifyClaudeAssets(root) : [];
  const opencodeClassification = installOpencode ? classifyDriverAssets(root, 'opencode') : [];
  // A PitWay-owned asset whose installed bytes differ from the shipped
  // version is PRESERVED: never overwritten, and — since the divergence may
  // be a deliberate local edit or simply an older shipped version — never a
  // refusal either. It is reported (human warning + preservedAssets in the
  // view) for a future `pitway update` to reconcile. Only the paths PitWay
  // itself ships are ever classified at all: a user's own unknown files in
  // .claude/ or .opencode/ are never inspected, reported, or touched.
  const preservedAssets = [
    ...classification
      .filter((c) => c.status === 'conflict')
      .map((c) => `${driverDestinationDir('claude')}/${c.asset}`),
    ...opencodeClassification
      .filter((c) => c.status === 'conflict')
      .map((c) => `${driverDestinationDir('opencode')}/${c.asset}`),
  ];

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
    // --no-claude still creates/preserves AGENTS.md, since it is the
    // generic agent-discovery file, not a Claude-specific asset.
    const rootInstructions = applyRootInstructionFiles(root, { includeClaudeMd: installClaude });
    return { created, message, claudeInstalled, opencodeInstalled, rootInstructions, preservedAssets };
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
        if (view.preservedAssets.length > 0) {
          write(
            `⚠️  ${view.preservedAssets.length} PitWay-managed driver asset(s) differ from the shipped ` +
              `version and were left untouched (never overwritten):\n` +
              view.preservedAssets.map((p) => `  - ${p}`).join('\n') +
              `\nA future \`pitway update\` will offer to reconcile these.`,
          );
        }
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
