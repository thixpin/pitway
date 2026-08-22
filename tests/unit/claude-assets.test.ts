import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  classifyClaudeAssets,
  listClaudeAssets,
  listInstalledSkillNames,
} from '../../src/state/claude-assets.js';
import {
  resolveAssetsFromDirs,
  resolveAssetSourceFromDirs,
  resolveDriverAssets,
  resolveDriverAssetSource,
} from '../../src/state/driver-assets.js';

let root: string;

// M023/T001: shipped sources are resolved via driver-assets.ts's
// driver-then-common fallback, never a single hardcoded source directory.
function shippedContent(asset: string): Buffer {
  return readFileSync(resolveDriverAssetSource('claude', asset));
}

// Independent recursive .md scan for the resolution-equivalence tests --
// deliberately re-implemented here rather than delegating to the resolver
// under test.
function listMarkdownFiles(dir: string, base: string = dir): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listMarkdownFiles(full, base));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(relative(base, full));
    }
  }
  return files.sort();
}

function writeDestination(root: string, asset: string, content: string | Buffer): void {
  const destination = join(root, '.claude', asset);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pitway-claude-assets-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

// T002: focused unit tests for classifyClaudeAssets against a real temp
// directory tree -- not a full pitway init -- covering absent/identical/
// conflict for a representative asset, plus a mixed case proving each
// asset is classified independently.
describe('classifyClaudeAssets', () => {
  it('classifies every asset absent when .claude/ does not exist at all', () => {
    const result = classifyClaudeAssets(root);
    expect(result.length).toBe(listClaudeAssets().length);
    expect(result.every((c) => c.status === 'absent')).toBe(true);
  });

  it('classifies a byte-identical installed asset as identical', () => {
    const [asset] = listClaudeAssets();
    writeDestination(root, asset!, shippedContent(asset!));
    const result = classifyClaudeAssets(root);
    expect(result.find((c) => c.asset === asset)?.status).toBe('identical');
  });

  it('classifies a byte-different installed asset as conflict', () => {
    const [asset] = listClaudeAssets();
    writeDestination(root, asset!, 'not the real shipped content\n');
    const result = classifyClaudeAssets(root);
    expect(result.find((c) => c.asset === asset)?.status).toBe('conflict');
  });

  it('classifies each asset independently in a mixed installed state', () => {
    const assets = listClaudeAssets();
    expect(assets.length).toBeGreaterThan(2);
    const [identicalAsset, conflictAsset] = assets;
    writeDestination(root, identicalAsset!, shippedContent(identicalAsset!));
    writeDestination(root, conflictAsset!, 'different content\n');

    const result = classifyClaudeAssets(root);
    expect(result.find((c) => c.asset === identicalAsset)?.status).toBe('identical');
    expect(result.find((c) => c.asset === conflictAsset)?.status).toBe('conflict');
    const rest = result.filter((c) => c.asset !== identicalAsset && c.asset !== conflictAsset);
    expect(rest.every((c) => c.status === 'absent')).toBe(true);
  });

  it('is a real content comparison, not a size/mtime heuristic', () => {
    const [asset] = listClaudeAssets();
    const shipped = shippedContent(asset!);
    // Same length as the shipped content, different bytes -- a size-only
    // heuristic would wrongly call this identical.
    const sameLength = Buffer.alloc(shipped.length, 'x');
    writeDestination(root, asset!, sameLength);
    const result = classifyClaudeAssets(root);
    expect(result.find((c) => c.asset === asset)?.status).toBe('conflict');
  });
});

// T003: focused unit tests for listInstalledSkillNames against a real temp
// directory tree, not routed through a full pitway init.
describe('listInstalledSkillNames', () => {
  it('returns an empty array when .claude/skills/ does not exist at all', () => {
    expect(listInstalledSkillNames(root)).toEqual([]);
  });

  it('returns an empty array when .claude/skills/ exists but is empty', () => {
    mkdirSync(join(root, '.claude', 'skills'), { recursive: true });
    expect(listInstalledSkillNames(root)).toEqual([]);
  });

  it('lists a skill directory that contains its own SKILL.md', () => {
    mkdirSync(join(root, '.claude', 'skills', 'debugging'), { recursive: true });
    writeFileSync(join(root, '.claude', 'skills', 'debugging', 'SKILL.md'), '---\nname: debugging\n---\n');
    expect(listInstalledSkillNames(root)).toEqual(['debugging']);
  });

  it('never lists a directory present without its own SKILL.md', () => {
    mkdirSync(join(root, '.claude', 'skills', 'debugging'), { recursive: true });
    writeFileSync(join(root, '.claude', 'skills', 'debugging', 'SKILL.md'), 'x');
    // A stray directory with no SKILL.md of its own.
    mkdirSync(join(root, '.claude', 'skills', 'incomplete'), { recursive: true });
    expect(listInstalledSkillNames(root)).toEqual(['debugging']);
  });

  it('sorts multiple installed skill names', () => {
    for (const name of ['testing', 'bug-fix', 'debugging']) {
      mkdirSync(join(root, '.claude', 'skills', name), { recursive: true });
      writeFileSync(join(root, '.claude', 'skills', name, 'SKILL.md'), 'x');
    }
    expect(listInstalledSkillNames(root)).toEqual(['bug-fix', 'debugging', 'testing']);
  });
});

// M025/T006 (B009): multi-driver aware gate -- union of .claude/skills
// and .opencode/skills, each filtered by SKILL.md, sorted deduped.
describe('listInstalledSkillNames multi-driver (M025/T006)', () => {
  it('lists a skill installed under .opencode/skills/ when .claude/skills/ is absent', () => {
    mkdirSync(join(root, '.opencode', 'skills', 'debugging'), { recursive: true });
    writeFileSync(join(root, '.opencode', 'skills', 'debugging', 'SKILL.md'), '---\nname: debugging\n---\n');
    expect(listInstalledSkillNames(root)).toEqual(['debugging']);
  });

  it('unions skills from both drivers, deduplicated and sorted', () => {
    mkdirSync(join(root, '.claude', 'skills', 'testing'), { recursive: true });
    writeFileSync(join(root, '.claude', 'skills', 'testing', 'SKILL.md'), 'x');
    mkdirSync(join(root, '.claude', 'skills', 'debugging'), { recursive: true });
    writeFileSync(join(root, '.claude', 'skills', 'debugging', 'SKILL.md'), 'x');
    mkdirSync(join(root, '.opencode', 'skills', 'debugging'), { recursive: true });
    writeFileSync(join(root, '.opencode', 'skills', 'debugging', 'SKILL.md'), 'x');
    mkdirSync(join(root, '.opencode', 'skills', 'bug-fix'), { recursive: true });
    writeFileSync(join(root, '.opencode', 'skills', 'bug-fix', 'SKILL.md'), 'x');
    expect(listInstalledSkillNames(root)).toEqual(['bug-fix', 'debugging', 'testing']);
  });

  it('never lists a .opencode directory present without its own SKILL.md', () => {
    mkdirSync(join(root, '.opencode', 'skills', 'incomplete'), { recursive: true });
    mkdirSync(join(root, '.opencode', 'skills', 'debugging'), { recursive: true });
    writeFileSync(join(root, '.opencode', 'skills', 'debugging', 'SKILL.md'), 'x');
    expect(listInstalledSkillNames(root)).toEqual(['debugging']);
  });

  it('ignores an incomplete entry in one driver while still listing the complete one from the other driver', () => {
    mkdirSync(join(root, '.claude', 'skills', 'debugging'), { recursive: true });
    // no SKILL.md in .claude/debugging
    mkdirSync(join(root, '.opencode', 'skills', 'debugging'), { recursive: true });
    writeFileSync(join(root, '.opencode', 'skills', 'debugging', 'SKILL.md'), 'x');
    expect(listInstalledSkillNames(root)).toEqual(['debugging']);
  });

  it('returns [] when neither driver skills directory exists', () => {
    expect(listInstalledSkillNames(root)).toEqual([]);
  });

  it('returns .claude skills when .opencode/skills is absent (backward compat)', () => {
    mkdirSync(join(root, '.claude', 'skills', 'testing'), { recursive: true });
    writeFileSync(join(root, '.claude', 'skills', 'testing', 'SKILL.md'), 'x');
    expect(listInstalledSkillNames(root)).toEqual(['testing']);
  });
});

// AC010/T010 (M014): asset discovery is dynamic (listClaudeAssets readdirs
// the integration directory) -- these assertions pin that the three new
// parallel-mode command docs actually ship, rather than maintaining any
// hardcoded manifest.
describe('M014 parallel-mode command docs ship', () => {
  it('lists the three new command docs among shipped assets', () => {
    const assets = listClaudeAssets();
    expect(assets).toContain('commands/task-dispatch.md');
    expect(assets).toContain('commands/task-integrate.md');
    expect(assets).toContain('commands/task-discard.md');
  });
});

// AC011/T010 (M015): asset discovery is dynamic -- this assertion pins
// that the new milestone-review command doc actually ships, rather than
// maintaining any hardcoded manifest.
describe('M015 milestone-review command doc ships', () => {
  it('lists the new command doc among shipped assets', () => {
    expect(listClaudeAssets()).toContain('commands/milestone-review.md');
  });
});

// AC002/T002 (M017): asset discovery is dynamic -- this assertion pins
// that the new task-add command doc actually ships, rather than
// maintaining any hardcoded manifest.
describe('M017 task-add command doc ships', () => {
  it('lists the new command doc among shipped assets', () => {
    expect(listClaudeAssets()).toContain('commands/task-add.md');
  });
});

// AC008/T005 (M018): asset discovery is dynamic -- this assertion pins
// that the new backlog command doc actually ships, rather than
// maintaining any hardcoded manifest.
describe('M018 backlog command doc ships', () => {
  it('lists the new command doc among shipped assets', () => {
    expect(listClaudeAssets()).toContain('commands/backlog.md');
  });
});

// AC004/T002 (M019): asset discovery is dynamic -- this assertion pins
// that the new milestone-merge command doc actually ships, rather than
// maintaining any hardcoded manifest.
describe('M019 milestone-merge command doc ships', () => {
  it('lists the new command doc among shipped assets', () => {
    expect(listClaudeAssets()).toContain('commands/milestone-merge.md');
  });
});

// M019/AC022/T007: a documentation-presence check for the driver-integration
// MUST-requirement itself -- PitWay cannot verify a driver actually follows
// its own protocol docs, but it CAN verify the instruction text is still
// present, so a future doc edit can't silently drop it. Narrow contains-
// checks only (not verbatim sentences), so a future wording tweak doesn't
// break this test.
describe('M019 driver usage-propagation MUST instruction is documented', () => {
  it('dispatch.md instructs the driver to pass --usage on a dispatched task completion', () => {
    const text = shippedContent('dispatch.md').toString('utf8');
    expect(text).toContain('--usage');
    expect(text).toMatch(/MUST/);
  });

  it('protocol-driver.md states the usage-propagation rule as a MUST', () => {
    const text = shippedContent('protocol-driver.md').toString('utf8');
    expect(text).toContain('--usage');
    expect(text).toMatch(/MUST/);
  });
});

// M019/T003 (AC009, AC010) + post-M019 quick-change qc-7e6fb2a4 (ms-merge):
// the 8 ms-* alias command docs ship, each byte-identical in body to its
// canonical milestone-* counterpart; every PitWay-owned command doc's
// description is 'PitWay: '-prefixed; the 6 vendored skills are explicitly
// unchanged.
describe('M019 ms-* alias command docs ship and stay in parity (AC009, AC010)', () => {
  const MS_ALIASES = [
    'ms-add',
    'ms-cancel',
    'ms-complete',
    'ms-confirm',
    'ms-list',
    'ms-merge',
    'ms-review',
    'ms-status',
  ];

  it('lists all 8 alias command docs among shipped assets', () => {
    const assets = listClaudeAssets();
    for (const alias of MS_ALIASES) {
      expect(assets).toContain(`commands/${alias}.md`);
    }
  });

  it.each(MS_ALIASES.map((alias) => [alias, alias.replace('ms-', 'milestone-')]))(
    'commands/%s.md is byte-identical to commands/%s.md',
    (alias, canonical) => {
      expect(shippedContent(`commands/${alias}.md`)).toEqual(shippedContent(`commands/${canonical}.md`));
    },
  );

  it("every command doc's description starts with 'PitWay: ', including the new milestone-merge.md and the 7 ms-*.md aliases", () => {
    const commandAssets = listClaudeAssets().filter((a) => a.startsWith('commands/'));
    expect(commandAssets.length).toBeGreaterThanOrEqual(31);
    for (const asset of commandAssets) {
      const text = shippedContent(asset).toString('utf8');
      const match = /^description:\s*"?(.*?)"?$/m.exec(text);
      expect(match?.[1]?.startsWith('PitWay: ')).toBe(true);
    }
  });

  it('leaves the 6 vendored skills entirely unaffected by the PitWay: prefix', () => {
    const skillAssets = listClaudeAssets().filter((a) => a.startsWith('skills/'));
    expect(skillAssets.length).toBeGreaterThan(0);
    for (const asset of skillAssets) {
      const text = shippedContent(asset).toString('utf8');
      expect(text).not.toMatch(/^description:\s*"?PitWay: /m);
    }
  });
});

// M023/T001/AC003(a): ONE-TIME MIGRATION CHECK. This inline sha256 manifest
// pins every asset path + content hash exactly as shipped BEFORE this
// milestone moved the driver-agnostic assets from src/integrations/claude/
// to src/integrations/common/. It exists to prove THIS milestone's move was
// lossless: the resolved claude-driver asset set (driver overrides union
// common fallbacks) is byte-identical to the pre-refactor set.
//
// Declared lifecycle (per the M023 contract): this is M023's migration
// proof, not a frozen-forever pin. A later milestone that legitimately
// edits a common/ (or claude/) asset regenerates the affected entries -- or
// retires this whole block -- as part of that same edit. The durable
// invariant lives in the resolution-equivalence suite below, which never
// pins historical content.
const PRE_M023_ASSET_MANIFEST: ReadonlyArray<readonly [string, string]> = [
  ['commands/auto-run.md', 'cf7a54bb3fb3e561d315f89c54d12d493d8efe09a6708ac63c724c3e975986d4'],
  ['commands/backlog.md', '05e9f376731946535ddd34dcb1c838a592fbdf421d8084bb1f2fde364f456516'],
  ['commands/milestone-add.md', '74ab3d6024217d792e4b83060f4a9510fa059a0b8d03f6ab607f87a6cc51d289'],
  ['commands/milestone-cancel.md', '57d8469883dbaa71eca1df813f5cc720312c5dc01000934ddf98a8f33999a1a4'],
  ['commands/milestone-complete.md', '9bd16abe4eee316f01b96f88fbc8da18db16de3e7a1bf63f663eea2a65bc08de'],
  ['commands/milestone-confirm.md', 'b4446e7290f386b433a98e1d8cacd13637fb3c865fdf7110fae74c58b2db5612'],
  ['commands/milestone-list.md', 'c5312bf74dffd1ef80f819b1c37b3e96f482afc9ee097233dd6220897563b4eb'],
  ['commands/milestone-merge.md', 'ae0b0bfadaf11cac281dd929e17584ad01ef8e92c88cf29bd64ad9fbcb1e1e51'],
  ['commands/milestone-review.md', 'a84b80577580be641d5af8b3f00d76d55f56529a965e19b8e21d40d8f811a44f'],
  ['commands/milestone-status.md', '916252ecf23efdd45f93264e7a729a9bbe0114775cf03374732b3fc651626197'],
  ['commands/ms-add.md', '74ab3d6024217d792e4b83060f4a9510fa059a0b8d03f6ab607f87a6cc51d289'],
  ['commands/ms-cancel.md', '57d8469883dbaa71eca1df813f5cc720312c5dc01000934ddf98a8f33999a1a4'],
  ['commands/ms-complete.md', '9bd16abe4eee316f01b96f88fbc8da18db16de3e7a1bf63f663eea2a65bc08de'],
  ['commands/ms-confirm.md', 'b4446e7290f386b433a98e1d8cacd13637fb3c865fdf7110fae74c58b2db5612'],
  ['commands/ms-list.md', 'c5312bf74dffd1ef80f819b1c37b3e96f482afc9ee097233dd6220897563b4eb'],
  ['commands/ms-merge.md', 'ae0b0bfadaf11cac281dd929e17584ad01ef8e92c88cf29bd64ad9fbcb1e1e51'],
  ['commands/ms-review.md', 'a84b80577580be641d5af8b3f00d76d55f56529a965e19b8e21d40d8f811a44f'],
  ['commands/ms-status.md', '916252ecf23efdd45f93264e7a729a9bbe0114775cf03374732b3fc651626197'],
  ['commands/quick-change.md', 'b94ddea4eceec509a3f7f1d384b86c110af1a57baca0a9700d3fa6b7d453e195'],
  ['commands/resume.md', '83e530ee885eafe22ea9c9ca3da43b36db6bb2705efe039947ef636e94f683b7'],
  ['commands/task-add.md', '1c645e69313678cd87263d593116dddb05accb9a45eb545bc8c996780fc0541b'],
  ['commands/task-amend.md', 'efa8f445e8f746fda6456da6364cd2cf7c592b26f68a1d2a58df8f88a765fb1a'],
  ['commands/task-discard.md', '5c5d6ea9c2dd3b59b2c830a14b3f0d0b4a0e4a237231d8fe1cf3f37c40f81f1a'],
  ['commands/task-dispatch.md', 'fc323baf04db4ce3fddee5db84c4a27c03cc48725af5a79c9d99644f3eda12ac'],
  ['commands/task-integrate.md', 'f2ce38803dfa04da476f25f6cf0651c64b73d4d70113b0d88680cf4ae6521d13'],
  ['commands/task-status.md', 'a94471218d26c0ee5801beba555c5f2f9c971683e137f4f8898272a6afe40eca'],
  ['commands/task-update.md', 'c64faad286679dcabef5df44d116ce2f2e3f73a73c622eac11e213eeb9a66eed'],
  ['commands/task-verify.md', '4006f8b341752195abba0c03b60e5ae5e5738fa03ed8c22a69f6f81896fc9a11'],
  ['commands/usage-add.md', '3592699d3b85ab02adadc9625f0037c53560ef407e0922c8123eff0b745eca19'],
  ['commands/verification-repair.md', '2138f0b8f7ceb52162803633e74ebd86ee9cb895f4f98588c2860adf1c58819a'],
  ['commands/verify.md', '8a32f630180ec65fe0a3b6260106665d75860e5fd068a9a675ae0fdc9612b734'],
  ['commands/write-ms-artifacts.md', 'ac3fbd18dff802744526a2431756a8373850575c12865f882c71bf1c7046000c'],
  ['coordination.md', 'b7af25661169ec0dc0caca9f7a395c23f71b97f22d9a9bca0cb9673968c0500f'],
  ['dispatch.md', '42d51189e54eb5fe44954e94b466cb3da39b3900c95566e1a0a75826b0247054'],
  ['interactive-ux.md', 'e8cc6c74b807247ff2f9b35abb5d85622f904b462b5ac4c2a0b20be4f2587aa1'],
  ['lsp-guidance.md', 'e2fc2650c5f53b1ff569db8a340a96d9e6975bc4e2eea5c0a36a745a1fe18b78'],
  ['protocol-driver.md', '9ace6b8f6ce05227cf54711da2ac341a3316004dae94ed4ea96fdde3abc2855c'],
  ['protocol-worker.md', 'eff8d70fbd92600da65c56ddc4d56eb5a0c4f6aa1861c3c93862ab63d0988cf6'],
  ['report-format.md', '1f78522fe1c9cfad3ff9afa1b3d915e00dd640d2433a52ce63544dde1d6e8dbf'],
  ['skills/NOTICE.md', '8d5dd0d6fb2753abf21aef4e98a3a2969dfac37dea91f059d117424da0dc5976'],
  ['skills/architecture-review/SKILL.md', 'd3c79781c122f8c60ad00fc35ad050dc260fa9b4d57c28217386fda1fd39a7cc'],
  ['skills/bug-fix/SKILL.md', 'd2c632a6353cbb686de9c6dfc8e4c4af6bfd39878c54514836910289cc3c3f96'],
  ['skills/code-quality-review/SKILL.md', '5ae5a7a037904090a6601ccb9c4a047468b30049b66ee869c2b88bf58724f50b'],
  ['skills/debugging/SKILL.md', '894b757d7bb718760f0b06131003f6d096d1c70723d7b0d9962fb09276f45d04'],
  ['skills/security-audit/SKILL.md', '15d9b20baf207949db3fadff2f0c4e0823da71258f22634a3321115894352b33'],
  ['skills/testing/SKILL.md', 'b71ae5e9bcf6f9075427e593a7064e08839f371cf79ba605eab1a4c7ee103239'],
];

describe('M023 one-time migration check: resolved claude asset set is byte-identical to pre-refactor', () => {
  it('resolves exactly the pre-M023 asset paths, no more, no fewer', () => {
    expect(listClaudeAssets()).toEqual(PRE_M023_ASSET_MANIFEST.map(([path]) => path));
  });

  it.each(PRE_M023_ASSET_MANIFEST.map(([path, hash]) => [path, hash] as const))(
    '%s resolves to content with pre-refactor sha256 %s',
    (path, hash) => {
      const digest = createHash('sha256').update(shippedContent(path)).digest('hex');
      expect(digest).toBe(hash);
    },
  );
});

// M023/T001/AC003(b): DURABLE INVARIANT -- resolution equivalence. The
// claude-driver overrides union common fallbacks (driver wins on any
// relative-path collision) exactly equals the shipped/installed set. This
// outlives the migration manifest above and never pins historical content.
describe('driver-then-common resolution equivalence (durable invariant)', () => {
  it('claude overrides union common fallbacks equals the installed asset set', () => {
    const claudeDir = fileURLToPath(new URL('../../src/integrations/claude/', import.meta.url));
    const commonDir = fileURLToPath(new URL('../../src/integrations/common/', import.meta.url));
    // Re-derive the union independently from disk, then compare with the
    // resolver's own answer AND byte-compare each resolved source.
    const union = [
      ...new Set([...listMarkdownFiles(claudeDir), ...listMarkdownFiles(commonDir)]),
    ].sort();
    expect(listClaudeAssets()).toEqual(union);
    expect(resolveDriverAssets('claude')).toEqual(union);
    for (const asset of union) {
      const expected = existsSync(join(claudeDir, asset))
        ? readFileSync(join(claudeDir, asset)) // driver wins on collision
        : readFileSync(join(commonDir, asset));
      expect(shippedContent(asset).equals(expected)).toBe(true);
    }
  });

  it('opencode overrides union common fallbacks equals the resolved opencode set', () => {
    // M023/T002 ripple (approved task-amend): T001 wrote this case as the
    // missing-driver-directory tolerance check, valid only while opencode/
    // did not exist. Now that T002 ships src/integrations/opencode/, the
    // assertion becomes the same union equivalence the claude test above
    // proves; missing-directory tolerance itself stays covered by the
    // fixture-based cases below.
    const opencodeDir = fileURLToPath(new URL('../../src/integrations/opencode/', import.meta.url));
    const commonDir = fileURLToPath(new URL('../../src/integrations/common/', import.meta.url));
    const union = [
      ...new Set([...listMarkdownFiles(opencodeDir), ...listMarkdownFiles(commonDir)]),
    ].sort();
    expect(resolveDriverAssets('opencode')).toEqual(union);
  });

  it('tolerates a missing driver directory as no-overrides (fixture proof)', () => {
    // AC002: the hardcoded driver list may name a driver whose directory
    // does not exist -- resolution must treat it as "no overrides", never
    // an error. Proven against fixtures now that the real opencode/
    // directory exists (T002).
    const commonDir = join(root, 'common');
    mkdirSync(commonDir, { recursive: true });
    writeFileSync(join(commonDir, 'protocol-demo.md'), 'common only\n');
    const missingDriverDir = join(root, 'no-such-driver');
    expect(resolveAssetsFromDirs(missingDriverDir, commonDir)).toEqual(['protocol-demo.md']);
  });

  it('driver wins on a relative-path collision (proven against fixture directories)', () => {
    const driverDir = join(root, 'driver');
    const commonDir = join(root, 'common');
    for (const [dir, content] of [
      [driverDir, 'driver override\n'],
      [commonDir, 'common fallback\n'],
    ] as const) {
      mkdirSync(join(dir, 'skills', 'demo'), { recursive: true });
      writeFileSync(join(dir, 'skills', 'demo', 'SKILL.md'), content);
    }
    writeFileSync(join(commonDir, 'protocol-demo.md'), 'common only\n');
    mkdirSync(join(driverDir, 'commands'), { recursive: true });
    writeFileSync(join(driverDir, 'commands', 'demo.md'), 'driver only\n');

    expect(resolveAssetsFromDirs(driverDir, commonDir)).toEqual([
      'commands/demo.md',
      'protocol-demo.md',
      'skills/demo/SKILL.md',
    ]);
    // The collision resolves to the driver's file; non-colliding assets
    // resolve to whichever tier ships them.
    expect(readFileSync(resolveAssetSourceFromDirs(driverDir, commonDir, 'skills/demo/SKILL.md'), 'utf8')).toBe(
      'driver override\n',
    );
    expect(readFileSync(resolveAssetSourceFromDirs(driverDir, commonDir, 'protocol-demo.md'), 'utf8')).toBe(
      'common only\n',
    );
    expect(() => resolveAssetSourceFromDirs(driverDir, commonDir, 'no-such-asset.md')).toThrow(
      /unknown asset/,
    );
  });
});
