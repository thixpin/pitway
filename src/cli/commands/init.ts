import type { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
import { StateStoreError, loadConfig, loadState, saveState } from '../../state/store.js';
import { renderOutput } from '../output.js';


// Option B defaults (developer directive): the generated config makes the
// recommended workflow explicit -- every milestone on its own branch,
// disjoint-scope tasks dispatching concurrently. Both fields are ordinary
// schema-validated values; the conservative modes ('main', 'sequential')
// remain available by editing these two lines.
const CONFIG_YAML_TEMPLATE = [
  'schema_version: 1',
  'git:',
  '  # Each confirmed milestone works on its own pitway/<id>-<slug> branch;',
  "  # integrate with 'pitway milestone-merge <id>'. Use 'main' to commit",
  '  # milestones directly to the current branch instead.',
  '  branch_strategy: milestone',
  'execution:',
  '  # Independent tasks with disjoint write scopes dispatch concurrently into',
  "  # temporary worktrees. Use 'sequential' to run one task at a time.",
  '  strategy: parallel_worktrees',
  '',
].join('\n');

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
  codexInstalled: boolean;
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
  options: { claude?: boolean; opencode?: boolean; codex?: boolean; reconfigure?: boolean } = {},
): InitView {
  assertGitWorkTree(root);
  const config = probe(() => loadConfig(root));
  const state = probe(() => loadState(root));

  const installClaude = options.claude ?? true;
  // M023/T002/AC006: OpenCode installation is opt-in (--opencode), additive
  // alongside the default-on Claude installation; without the flag no
  // .opencode/ path is ever read or written.
  const installOpencode = options.opencode ?? false;
  // M026/T002/AC004: Codex installation is opt-in (--codex), additive
  // alongside the default-on Claude installation; without the flag no
  // .codex/ path is ever read or written.
  const installCodex = options.codex ?? false;
  const reconfigure = options.reconfigure ?? false;
  // For --reconfigure, refresh an already-present .opencode/.codex installation even
  // without an explicit flag, so repeated reconfigure is idempotent
  // and an existing managed installation is not left stale.
  const effectiveOpencode =
    installOpencode || (reconfigure && existsSync(join(root, '.opencode')));
  const effectiveCodex = installCodex || (reconfigure && existsSync(join(root, '.codex')));
  // Classified up front, alongside config/state, so what happens to every
  // driver asset is decided before anything is written. --no-claude skips
  // classification and every .claude/ read entirely; the same discipline
  // applies to .opencode/ without --opencode (except the reconfigure
  // refresh of an already-present installation above).
  const classification = installClaude ? classifyClaudeAssets(root) : [];
  const opencodeClassification = effectiveOpencode ? classifyDriverAssets(root, 'opencode') : [];
  const codexClassification = effectiveCodex ? classifyDriverAssets(root, 'codex') : [];
  // A PitWay-owned asset whose installed bytes differ from the shipped
  // version is PRESERVED: never overwritten, and — since the divergence may
  // be a deliberate local edit or simply an older shipped version — never a
  // refusal either. It is reported (human warning + preservedAssets in the
  // view) for a future `pitway update` to reconcile. Only the paths PitWay
  // itself ships are ever classified at all: a user's own unknown files in
  // .claude/ or .opencode/ are never inspected, reported, or touched.
  const preservedAssets = reconfigure
    ? []
    : [
        ...classification
          .filter((c) => c.status === 'conflict')
          .map((c) => `${driverDestinationDir('claude')}/${c.asset}`),
        ...opencodeClassification
          .filter((c) => c.status === 'conflict')
          .map((c) => `${driverDestinationDir('opencode')}/${c.asset}`),
        ...codexClassification
          .filter((c) => c.status === 'conflict')
          .map((c) => `${driverDestinationDir('codex')}/${c.asset}`),
      ];

  function finish(created: boolean, message: string): InitView {
    let claudeInstalled = false;
    if (installClaude) {
      const toInstall = reconfigure
        ? classification.filter((c) => c.status !== 'identical').map((c) => c.asset)
        : classification.filter((c) => c.status === 'absent').map((c) => c.asset);
      if (toInstall.length > 0) {
        installClaudeAssets(root, toInstall);
        claudeInstalled = true;
      }
    }
    let opencodeInstalled = false;
    if (effectiveOpencode) {
      const toInstall = reconfigure
        ? opencodeClassification.filter((c) => c.status !== 'identical').map((c) => c.asset)
        : opencodeClassification.filter((c) => c.status === 'absent').map((c) => c.asset);
      if (toInstall.length > 0) {
        installDriverAssets(root, 'opencode', toInstall);
        opencodeInstalled = true;
      }
    }
    let codexInstalled = false;
    if (effectiveCodex) {
      const toInstall = reconfigure
        ? codexClassification.filter((c) => c.status !== 'identical').map((c) => c.asset)
        : codexClassification.filter((c) => c.status === 'absent').map((c) => c.asset);
      if (toInstall.length > 0) {
        installDriverAssets(root, 'codex', toInstall);
        codexInstalled = true;
      }
    }
    // --no-claude still creates/preserves AGENTS.md, since it is the
    // generic agent-discovery file, not a Claude-specific asset.
    const rootInstructions = applyRootInstructionFiles(root, { includeClaudeMd: installClaude });
    return { created, message, claudeInstalled, opencodeInstalled, codexInstalled, rootInstructions, preservedAssets };
  }

  if (config === 'missing' && state === 'missing') {
    // Written from the template (not yaml.stringify) so the generated file
    // carries explanatory comments next to the two policy fields.
    mkdirSync(join(root, '.pitway'), { recursive: true });
    writeFileSync(join(root, '.pitway', 'config.yaml'), CONFIG_YAML_TEMPLATE);
    saveState(root, { schema_version: 1, active_milestone: null, milestones: [] });
    return finish(true, 'Initialized .pitway/ (config.yaml, state.yaml).');
  }
  if (config === 'ok' && state === 'ok') {
    if (reconfigure) {
      return finish(false, 'Reconfigured managed integration assets (.claude/, .opencode/, .codex/ where installed) — .pitway/ preserved.');
    }
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
    .option('--codex', 'also install Codex integration assets (.codex/)')
    .option('--reconfigure', 'refresh managed integration assets on an already-initialized project (preserves .pitway/ state)')
    .option('--json', 'output machine-readable JSON')
    .action(
      (options: { claude?: boolean; opencode?: boolean; codex?: boolean; reconfigure?: boolean; json?: boolean }) => {
        const root = deps.root ?? process.cwd();
        const view = runInit(root, {
          claude: options.claude,
          opencode: options.opencode,
          codex: options.codex,
          reconfigure: options.reconfigure,
        });
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
