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

// M025/T010 (AC012/B017 governance): automatic non-blocking issue capture rule in protocol-worker.md
describe('M025 T010 protocol-worker non-blocking issue capture rule (AC012)', () => {
  it('protocol-worker.md instructs agents to surface unrelated non-blocking findings immediately via the existing PitWay workflow/host mechanism', () => {
    const text = shippedContent('protocol-worker.md').toString('utf8');
    expect(text).toMatch(/unrelated, non-blocking/);
    expect(text).toMatch(/existing PitWay workflow\/host mechanism/);
    expect(text).toMatch(/pitway backlog add/);
    expect(text).toMatch(/surface/i);
    expect(text).toMatch(/naming the discovering task/);
  });

  it('protocol-worker.md separates reporting (agent) from capture (driver/host) and forbids direct .pitway edits / mandatory CLI invocation', () => {
    const text = shippedContent('protocol-worker.md').toString('utf8');
    expect(text).toMatch(/reporting is the agent.*capture belongs to the driver\/host/i);
    expect(text).toMatch(/never edit.*\.pitway\//i);
    expect(text).toMatch(/never.*required to invoke.*pitway/i);
  });

  it('protocol-worker.md keeps blocking/task-related issues on the normal escalation/scope rules', () => {
    const text = shippedContent('protocol-worker.md').toString('utf8');
    expect(text).toMatch(/Blocking or task-related issues keep following the normal escalation\/scope rules/);
    expect(text).toMatch(/task-amend/);
    expect(text).toMatch(/contract amendment/);
    expect(text).toMatch(/developer approval/);
  });
});

// M025/T003 (B014): every covered command doc carries a usage block (```sh + pitway), backlog documents --milestone/--task
describe('M025 T003 command docs carry usage blocks (B014)', () => {
  const COVERED_COMMAND_DOCS = [
    'commands/auto-run.md',
    'commands/backlog.md',
    'commands/milestone-add.md',
    'commands/milestone-cancel.md',
    'commands/milestone-complete.md',
    'commands/milestone-confirm.md',
    'commands/milestone-list.md',
    'commands/milestone-merge.md',
    'commands/milestone-review.md',
    'commands/ms-add.md',
    'commands/ms-cancel.md',
    'commands/ms-complete.md',
    'commands/ms-confirm.md',
    'commands/ms-list.md',
    'commands/ms-merge.md',
    'commands/ms-review.md',
    'commands/quick-change.md',
    'commands/resume.md',
    'commands/task-add.md',
    'commands/task-amend.md',
    'commands/task-discard.md',
    'commands/task-dispatch.md',
    'commands/task-integrate.md',
    'commands/task-status.md',
    'commands/task-update.md',
    'commands/task-verify.md',
    'commands/usage-add.md',
    'commands/verification-repair.md',
    'commands/verify.md',
    'commands/write-ms-artifacts.md',
  ];

  it('lists exactly the 30 covered docs among shipped assets', () => {
    const assets = listClaudeAssets();
    for (const doc of COVERED_COMMAND_DOCS) {
      expect(assets).toContain(doc);
    }
  });

  it.each(COVERED_COMMAND_DOCS.map((doc) => [doc]))(
    '%s contains a usage block with ```sh and pitway',
    (doc) => {
      const text = shippedContent(doc).toString('utf8');
      expect(text).toMatch(/```sh/);
      expect(text).toMatch(/pitway/);
    },
  );

  it('backlog.md usage block documents --milestone and --task filters', () => {
    const text = shippedContent('commands/backlog.md').toString('utf8');
    expect(text).toMatch(/--milestone/);
    expect(text).toMatch(/--task/);
    // Ensure the list subcommand documents both filters together
    expect(text).toMatch(/backlog list.*--milestone.*--task/s);
  });
});

// M025/T004 (AC004/B011): verbatim relay + footer habit rule in protocol-driver and claude milestone-status/ms-status
describe('M025 T004 driver report style verbatim relay + footer habit (AC004/B011)', () => {
  it('protocol-driver.md mandates verbatim table+footer relay and the routine-update footer closing line', () => {
    const text = shippedContent('protocol-driver.md').toString('utf8');
    expect(text).toContain('reproduce the rendered table and racing footer as-is');
    expect(text).toContain('annotations may surround');
    expect(text).toContain('never prose summaries');
    expect(text).toContain('end routine progress updates with the footer');
  });

  it('claude milestone-status.md carries the relay rule and a usage block', () => {
    const text = shippedContent('commands/milestone-status.md').toString('utf8');
    expect(text).toContain('reproduce the rendered table and racing footer as-is');
    expect(text).toContain('annotations may surround');
    expect(text).toContain('never prose summaries');
    expect(text).toContain('end routine progress updates with the footer');
    expect(text).toMatch(/```sh/);
    expect(text).toMatch(/pitway milestone-status/);
    expect(text).toMatch(/--report/);
    expect(text).toMatch(/--json/);
  });

  it('claude ms-status.md carries the relay rule and a usage block and stays byte-identical to milestone-status.md', () => {
    const text = shippedContent('commands/ms-status.md').toString('utf8');
    expect(text).toContain('reproduce the rendered table and racing footer as-is');
    expect(text).toContain('annotations may surround');
    expect(text).toContain('never prose summaries');
    expect(text).toContain('end routine progress updates with the footer');
    expect(text).toMatch(/```sh/);
    expect(text).toMatch(/pitway milestone-status/);
    expect(text).toMatch(/--report/);
    expect(text).toMatch(/--json/);
    expect(shippedContent('commands/ms-status.md')).toEqual(shippedContent('commands/milestone-status.md'));
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
  ['commands/auto-run.md', '09ed02f780f35e35066dacf323d16fea9e2c4c9ddd5b5ed63e1b07afdfef3f11'],
  ['commands/backlog.md', 'c0f92b16177c71dbb72e6b89f6544703fffb66db27d139a906e9396060e50baa'],
  ['commands/milestone-add.md', 'bc0653d519cda796ebf9a3e6e2046ab6b5461f895717d6814089133c2ebfc8b6'],
  ['commands/milestone-cancel.md', '097d46f142860f6215ed0808ecaa1a61f4947d23d12425b32bbe287e6b8d09ed'],
  ['commands/milestone-complete.md', '00bb60d02e2a9cd6f7f052ed83e273b0a2f513902f582927309cb82d1bec7c9b'],
  ['commands/milestone-confirm.md', '88329984e453f7b9adc87d9d0b2d760794eba73bd1d89f46038090be61d117f0'],
  ['commands/milestone-list.md', '085229a691673a20a5d69820534e2a6dbffdb842f47863f0c86ca9d2b63f1790'],
  ['commands/milestone-merge.md', '0c38d2e3f6fde90000fa2461f2d77fd522cdc558cf9608c039639791c4e8a981'],
  ['commands/milestone-review.md', '6fea5970c3dacf4f9bf96cf6c4ca3f495ad993606b07b15aa35278bd65e7920b'],
  ['commands/milestone-status.md', 'fd591acc69047eb4dceb43d14cc8d8a040acbd893b21f39a8c82299567eebb0c'],
  ['commands/ms-add.md', 'bc0653d519cda796ebf9a3e6e2046ab6b5461f895717d6814089133c2ebfc8b6'],
  ['commands/ms-cancel.md', '097d46f142860f6215ed0808ecaa1a61f4947d23d12425b32bbe287e6b8d09ed'],
  ['commands/ms-complete.md', '00bb60d02e2a9cd6f7f052ed83e273b0a2f513902f582927309cb82d1bec7c9b'],
  ['commands/ms-confirm.md', '88329984e453f7b9adc87d9d0b2d760794eba73bd1d89f46038090be61d117f0'],
  ['commands/ms-list.md', '085229a691673a20a5d69820534e2a6dbffdb842f47863f0c86ca9d2b63f1790'],
  ['commands/ms-merge.md', '0c38d2e3f6fde90000fa2461f2d77fd522cdc558cf9608c039639791c4e8a981'],
  ['commands/ms-review.md', '6fea5970c3dacf4f9bf96cf6c4ca3f495ad993606b07b15aa35278bd65e7920b'],
  ['commands/ms-status.md', 'fd591acc69047eb4dceb43d14cc8d8a040acbd893b21f39a8c82299567eebb0c'],
  ['commands/quick-change.md', '949e37404e672b0856aebae7f2c426b1f54aed64645f3767dc28abd3c54a37c3'],
  ['commands/resume.md', 'df2e0da7669c478b29ec7aa5b430562240948f7802c03d4830ca2ab72f84709d'],
  ['commands/task-add.md', 'aa281cc1715d7f07ddd6e54685ba51e8691aed87ac4895e6823a33b079da48c4'],
  ['commands/task-amend.md', '5d4761714ba535c9d2508cdef5ca8ac0e12ec24a5331acf1088915bdcfe45d26'],
  ['commands/task-discard.md', '5ff651a972b3e0b64efa4a1d0a9eda4249c70045cca10c61a86c0d6ac5c485cc'],
  ['commands/task-dispatch.md', '10f2b30ff686124d0987aa6bf5e67688814c446cec376178327b571d206f37b6'],
  ['commands/task-integrate.md', 'e75b0b6e9b81b5cdf49e52914b11834c3e0d854e3c60adcd664dad9939904c21'],
  ['commands/task-status.md', 'ba2970670d5bcd8d4319bb35c375058b296b09acb1640c0726c024a6d5aed2ca'],
  ['commands/task-update.md', '8bf8914bfbf719b40fd2eeb975988e310d717c2eca3f5d7ccd8bc19a19f052bd'],
  ['commands/task-verify.md', '83c4a0a3561baadf8ee29a64c1ed90a034c6ad5bb7ee3bc82fa8ce80cd036575'],
  ['commands/usage-add.md', '812942afae8daefd23431f7db10eda28cbacd5b2819adde1005f23162b541306'],
  ['commands/verification-repair.md', 'faec5c2f3dc2e43b2cc56dd842891a6088201e19034ea2f95cace4bdca01d809'],
  ['commands/verify.md', '52b73c2b87cf76d8511ee5d0681ecba3066f9bb65a67cf8405b13c73c1313e28'],
  ['commands/write-ms-artifacts.md', 'e96381e954dd1eed5424e8ed077a8f2081400473a3d06e1f267b70d46f289ca1'],
  ['coordination.md', 'b7af25661169ec0dc0caca9f7a395c23f71b97f22d9a9bca0cb9673968c0500f'],
  ['dispatch.md', '42d51189e54eb5fe44954e94b466cb3da39b3900c95566e1a0a75826b0247054'],
  ['interactive-ux.md', 'e8cc6c74b807247ff2f9b35abb5d85622f904b462b5ac4c2a0b20be4f2587aa1'],
  ['lsp-guidance.md', 'e2fc2650c5f53b1ff569db8a340a96d9e6975bc4e2eea5c0a36a745a1fe18b78'],
  ['protocol-driver.md', 'b38cd14ede27c9d52cada87eb4641dcbe1a33324a379571fd31bc37616aae35c'],
  ['protocol-worker.md', '44fc562967c7a7563010a421af311cc3699157af2d5b0f174d34d7afb1681a60'],
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
