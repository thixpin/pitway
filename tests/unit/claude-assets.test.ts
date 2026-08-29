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
  listClaudeAssetDestinations,
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

  // M033/T004: extend the multi-driver gate to .codex/skills -- resolution
  // is already driver-symmetric (claude-assets.ts unions all three driver
  // skills directories); these cases pin the .codex coverage that was
  // missing.
  it('lists a skill installed under .codex/skills/ when .claude/skills/ is absent', () => {
    mkdirSync(join(root, '.codex', 'skills', 'debugging'), { recursive: true });
    writeFileSync(join(root, '.codex', 'skills', 'debugging', 'SKILL.md'), '---\nname: debugging\n---\n');
    expect(listInstalledSkillNames(root)).toEqual(['debugging']);
  });

  it('unions skills across all three drivers, including .codex, deduplicated and sorted', () => {
    mkdirSync(join(root, '.claude', 'skills', 'testing'), { recursive: true });
    writeFileSync(join(root, '.claude', 'skills', 'testing', 'SKILL.md'), 'x');
    mkdirSync(join(root, '.opencode', 'skills', 'debugging'), { recursive: true });
    writeFileSync(join(root, '.opencode', 'skills', 'debugging', 'SKILL.md'), 'x');
    mkdirSync(join(root, '.codex', 'skills', 'debugging'), { recursive: true });
    writeFileSync(join(root, '.codex', 'skills', 'debugging', 'SKILL.md'), 'x');
    mkdirSync(join(root, '.codex', 'skills', 'bug-fix'), { recursive: true });
    writeFileSync(join(root, '.codex', 'skills', 'bug-fix', 'SKILL.md'), 'x');
    expect(listInstalledSkillNames(root)).toEqual(['bug-fix', 'debugging', 'testing']);
  });

  it('never lists a .codex directory present without its own SKILL.md', () => {
    mkdirSync(join(root, '.codex', 'skills', 'incomplete'), { recursive: true });
    mkdirSync(join(root, '.codex', 'skills', 'debugging'), { recursive: true });
    writeFileSync(join(root, '.codex', 'skills', 'debugging', 'SKILL.md'), 'x');
    expect(listInstalledSkillNames(root)).toEqual(['debugging']);
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

  // Milestone-current-command quick-change (ms-status cleanup): the
  // per-command doc no longer duplicates the relay-rule prose verbatim --
  // that rule lives solely in protocol-driver.md now (tested above). This
  // doc stays terse: identity, read-only guarantee, and a pointer to relay
  // output as-is, without restating the exact sentences.
  it('claude milestone-status.md carries a usage block and the read-only/relay pointer', () => {
    const text = shippedContent('commands/milestone-status.md').toString('utf8');
    expect(text).toContain('Read-only');
    expect(text).toContain('preserve the rendered table and racing footer as-is');
    expect(text).toMatch(/```sh/);
    expect(text).toMatch(/pitway milestone-status/);
  });

  it('claude ms-status.md carries the same content and stays byte-identical to milestone-status.md', () => {
    const text = shippedContent('commands/ms-status.md').toString('utf8');
    expect(text).toContain('Read-only');
    expect(text).toContain('preserve the rendered table and racing footer as-is');
    expect(text).toMatch(/```sh/);
    expect(text).toMatch(/pitway milestone-status/);
    expect(shippedContent('commands/ms-status.md')).toEqual(shippedContent('commands/milestone-status.md'));
  });
});

// M031/T001 (AC001, AC005): documentation-presence regression test for the
// new Sequential subagent dispatch section -- narrow contains/regex checks
// against key phrases, never verbatim sentences, mirroring the M019
// usage-propagation pattern above, so a future wording tweak doesn't break
// this test. Written first and failing before the content exists (RED).
describe('Sequential subagent dispatch (AC001, AC005)', () => {
  it('dispatch.md documents the new Sequential subagent dispatch section', () => {
    const text = shippedContent('dispatch.md').toString('utf8');
    expect(text).toMatch(/[Ss]equential subagent dispatch/);
  });

  it('dispatch.md states the driver-agnostic resume-or-fresh-dispatch fallback', () => {
    const text = shippedContent('dispatch.md').toString('utf8');
    expect(text).toMatch(/resume[\s\S]{0,400}fresh/);
  });

  it('dispatch.md restates the usage-attribution MUST rule per dispatch/resume call', () => {
    const text = shippedContent('dispatch.md').toString('utf8');
    expect(text).toContain('--usage');
    expect(text).toMatch(/per (dispatch|resume)/i);
  });

  it('dispatch.md states the AC005 context-isolation trade-off as its own distinct disclosure', () => {
    const text = shippedContent('dispatch.md').toString('utf8');
    expect(text).toMatch(/write_scope|enforced/);
    expect(text).toMatch(/cannot enforce|cannot prevent/);
  });

  it('protocol-worker.md addendum keeps every Hard Rule unchanged for a resumed worker, including never calling pitway, with task authorization staying task-specific', () => {
    const text = shippedContent('protocol-worker.md').toString('utf8');
    expect(text).toMatch(/resumed/i);
    expect(text).toMatch(/never call `?pitway`?/i);
    expect(text).toMatch(/task-specific/);
  });

  it('protocol-driver.md points to the new dispatch.md subsection from Dispatch discipline', () => {
    const text = shippedContent('protocol-driver.md').toString('utf8');
    expect(text).toMatch(/[Ss]equential subagent dispatch/);
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
  ['commands/auto-run.md', '611a07fb5027f1224d531651a6854f2cd2805d4119e51ff1548575c9f3103eb8'],
  ['commands/backlog.md', 'cbca88994edf5fe336e3a2aaf1ff032d6868936227bf5f644cdde4862aac4835'],
  ['commands/milestone-add.md', '2ac11b723964b3252c9714db624ad1ea32446a08a59ded1148f2e0a0ea33064e'],
  ['commands/milestone-cancel.md', 'c317f888574d93011cbc76e1806a20f73cb663421452b8980f444856aa9f5448'],
  ['commands/milestone-complete.md', '2e983056267a8599c9ac5daefac430269136860709cf6a0d2d14054f936e3327'],
  ['commands/milestone-confirm.md', '9175defbdc11aa128ce39dab01ea12ecca420895e205adc62c8cfc9cf895e7dc'],
  ['commands/milestone-list.md', '5b54d1b6e66cdbcc3f95fb09f47a72d4bb3c5db685fe6e119a3de3f99eea0a67'],
  ['commands/milestone-merge.md', 'c212e93eba0e39844d32d7fba930e451073ce800932f2af6f388e3f9efeeca8b'],
  ['commands/milestone-review.md', '6e5bfaba0186a787d1fe21877000c2faa77887306a0716cf196ffc40de8c0a60'],
  ['commands/milestone-status.md', '1b14f082221cf895e8e69d956713fa8f867fe6651a938f06ac5fc9c0351e49c9'],
  ['commands/ms-add.md', '2ac11b723964b3252c9714db624ad1ea32446a08a59ded1148f2e0a0ea33064e'],
  ['commands/ms-cancel.md', 'c317f888574d93011cbc76e1806a20f73cb663421452b8980f444856aa9f5448'],
  ['commands/ms-complete.md', '2e983056267a8599c9ac5daefac430269136860709cf6a0d2d14054f936e3327'],
  ['commands/ms-confirm.md', '9175defbdc11aa128ce39dab01ea12ecca420895e205adc62c8cfc9cf895e7dc'],
  ['commands/ms-list.md', '5b54d1b6e66cdbcc3f95fb09f47a72d4bb3c5db685fe6e119a3de3f99eea0a67'],
  ['commands/ms-merge.md', 'c212e93eba0e39844d32d7fba930e451073ce800932f2af6f388e3f9efeeca8b'],
  ['commands/ms-review.md', '6e5bfaba0186a787d1fe21877000c2faa77887306a0716cf196ffc40de8c0a60'],
  ['commands/ms-status.md', '1b14f082221cf895e8e69d956713fa8f867fe6651a938f06ac5fc9c0351e49c9'],
  ['commands/quick-change.md', '6fa7a53cde427612a06943e2754f4e681f724063245384e32889c2dbf973dfdf'],
  ['commands/resume.md', 'e7993819035889baf7b89bd21cb5cf9f8da12749beb53e8f956dc67559a0d1da'],
  ['commands/task-add.md', 'ddac31adf51405074b2aaada3e7e464332e30c72d0c138f1b5b77b2cb808b72c'],
  ['commands/task-amend.md', 'c2cac5abc29246268b2c843cbf8cdeb7e0e4fda31fa0f2539fc5d23a3dd931da'],
  ['commands/task-discard.md', '79da77dbeb8dd5cde8d7f3daf8831e683e5fb65dbfc03c7942701a82ff028c04'],
  ['commands/task-dispatch.md', '2cb938cabc90a35e214dcdf8a6b5ff08d2ca57a107adc70879db3a65c7140e45'],
  ['commands/task-integrate.md', 'b3bcbcc646797c86b4b33a71e932ba03406334257aaf516e944d0b6aa10ad80f'],
  ['commands/task-status.md', 'fa9c320b0c0a3a1a26a78a64060914e265c4cdf17484c85615fc8187063bbf09'],
  ['commands/task-update.md', 'f0726b87724c4a6e36f575c253b5b3a730b049a910df97a28c9c12bb5b40134e'],
  ['commands/task-verify.md', '6ed794181e4013d72485d27bec7e426cabb632277bd305c99458b968972da2e9'],
  ['commands/usage-add.md', '9a6b60b781dc30c32e34a3bc99d2c4257af172242923807cb802dc0499184bf6'],
  ['commands/verification-repair.md', 'fcbcc2378ea42262cf177bca1ca9fc259296da659c9cbc8c32798836c80334a4'],
  ['commands/verify.md', 'f25a28e38b630ab7794fbc5c4bbc0c145e56e0f9e1512e6076c1c886514c653b'],
  ['commands/write-ms-artifacts.md', 'b3d4ee5da3d8b34d5b5af65fff86279399f03bfaec98b61f488a136f46d6f36f'],
  ['coordination.md', '4fb348cdad94477a87be450516f9fe195a04246a29e1aea7898ae0473a836575'],
  ['dispatch.md', 'db95b2c561d9a55d1daa1bb575df792930e42ad5cac6dc54cb2e24843ff33857'],
['draft-formats.md', '2b34ff089f0cdf7a69a685dbb25d9ef35bcfaae18b0f895f546669df6fedeaa7'],
  ['interactive-ux.md', 'e8cc6c74b807247ff2f9b35abb5d85622f904b462b5ac4c2a0b20be4f2587aa1'],
  ['lsp-guidance.md', 'e2fc2650c5f53b1ff569db8a340a96d9e6975bc4e2eea5c0a36a745a1fe18b78'],
  ['protocol-driver.md', '218e0afff56dcc6fa31988d4c019a6394c4fc8f649a5cfa52cca3e9d8e2431c6'],
  // M040/T003: the Orchestrator role's protocol doc, added as a common asset.
  ['protocol-orchestrator.md', 'dcb2b3f14ab9eec00ee3a745c05dd69f1afb17d11e9a01334965f7b08fc48215'],
  ['protocol-worker.md', '8aa76eac4952afc447cd090356680aa372eed15edcbe16e6728a64ff330b3393'],
  ['report-format.md', '1480a8fe8dddd8045e24c67cb043786dba58c1194ff959a319e0bdc66a9408c4'],
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

// M038/T001 (AC001, AC003): the canonical shared body of every command doc
// lives once under common/commands/; Claude Code keeps a whole-file override
// per command only because its frontmatter (argument-hint) genuinely
// differs. Each override's body must stay byte-identical to its common/
// counterpart, and its description must match -- the parity invariant that
// replaced the old per-driver triplication.
describe('M038 claude command overrides stay in parity with common/commands (AC001, AC003)', () => {
  const claudeCommandsDir = fileURLToPath(new URL('../../src/integrations/claude/commands/', import.meta.url));
  const commonCommandsDir = fileURLToPath(new URL('../../src/integrations/common/commands/', import.meta.url));
  const commonCommandDocs = listMarkdownFiles(commonCommandsDir);

  function split(text: string): { description: string; body: string } {
    const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
    expect(match).not.toBeNull();
    const description = /^description:\s*"?(.*?)"?$/m.exec(match![1]!);
    expect(description).not.toBeNull();
    return { description: description![1]!, body: match![2]! };
  }

  it('common/commands/ ships a command doc set, and claude/commands/ overrides exactly that set', () => {
    expect(commonCommandDocs.length).toBeGreaterThan(0);
    expect(listMarkdownFiles(claudeCommandsDir)).toEqual(commonCommandDocs);
  });

  it.each(commonCommandDocs.map((doc) => [doc]))(
    'claude/commands/%s: body byte-identical to common/, description matching, frontmatter genuinely driver-specific',
    (doc) => {
      const claudeText = readFileSync(join(claudeCommandsDir, doc), 'utf8');
      const commonText = readFileSync(join(commonCommandsDir, doc), 'utf8');
      const claude = split(claudeText);
      const common = split(commonText);
      expect(claude.body).toBe(common.body);
      expect(claude.description).toBe(common.description);
      // The override earns its existence only by differing in frontmatter:
      // Claude Code's own lenient unquoted-description convention, plus
      // argument-hint on every command that takes arguments. A byte-identical
      // override would be pure duplication and must fall back to common/.
      expect(claudeText).not.toBe(commonText);
    },
  );
});

// M040/T003 (AC005, AC006): the Orchestrator role's protocol doc ships as a
// common asset beside protocol-driver.md / protocol-worker.md, resolves to
// common/ for every driver, and states the partition and the one rule.
describe('M040 protocol-orchestrator.md ships and states the role rules', () => {
  it('is in the resolved set, resolves to common/, and lands at .claude/protocol-orchestrator.md', () => {
    expect(listClaudeAssets()).toContain('protocol-orchestrator.md');
    expect(resolveDriverAssetSource('claude', 'protocol-orchestrator.md')).toBe(
      fileURLToPath(new URL('../../src/integrations/common/protocol-orchestrator.md', import.meta.url)),
    );
    expect(listClaudeAssetDestinations()).toContain('.claude/protocol-orchestrator.md');
  });

  it('states never-.pitway-directly and puts task-update and milestone-confirm on the correct sides', () => {
    const text = shippedContent('protocol-orchestrator.md').toString('utf8');
    expect(text).toMatch(/never touch `\.pitway\/` directly/i);
    expect(text).toMatch(/You run `task-update`/);
    expect(text).toMatch(/never run a gate or scope command[^.]*`milestone-confirm`/s);
    expect(text).toMatch(/protocol-enforced/);
  });

  it('protocol-driver.md cross-references the role split and protocol-orchestrator.md', () => {
    const text = shippedContent('protocol-driver.md').toString('utf8');
    expect(text).toMatch(/Role split \(M040\)/);
    expect(text).toContain('protocol-orchestrator.md');
    expect(text).toContain('docs/architecture/orchestrator-role.md');
  });
});

// M041/T002 (AC001, AC002): the Main Agent / Orchestrator command partition
// has exactly one source of truth -- the Decision 1 table in
// docs/architecture/orchestrator-role.md. Every shipped command doc's
// `**Role:**` line (M041/T001) and both protocol docs' command lists are
// checked against a parse of that table, never against a second list kept
// here: adding or moving a command in the record is the only way to change
// what this suite expects.
describe('M041 command-doc role annotations and protocol docs agree with the Decision 1 table', () => {
  type Role = 'Main Agent' | 'Orchestrator' | 'either';
  interface Assignment {
    role: Role;
    qualifier: string;
  }

  const commonCommandsDir = fileURLToPath(new URL('../../src/integrations/common/commands/', import.meta.url));
  const commandDocNames = listMarkdownFiles(commonCommandsDir).map((doc) => doc.replace(/\.md$/, ''));
  const decisionRecord = readFileSync(
    fileURLToPath(new URL('../../docs/architecture/orchestrator-role.md', import.meta.url)),
    'utf8',
  );

  // Parse the Decision 1 table into command -> assignments. Within a row's
  // command cell, a backticked span is a new command when its first word is
  // a shipped command doc or the span is neither a flag nor a
  // `/ `-continuation; otherwise it qualifies (subcommand/flag) the command
  // before it. So "`quick-change create` / `approve`" yields two Main Agent
  // assignments for quick-change, and "`verify` (runs, `--check …` records)"
  // one Orchestrator assignment qualified by --check.
  function parseDecisionTable(): Map<string, Assignment[]> {
    const section = /## Decision 1[\s\S]*?(?=\n## Decision 2)/.exec(decisionRecord);
    expect(section).not.toBeNull();
    const table = new Map<string, Assignment[]>();
    for (const line of section![0].split('\n')) {
      const cells = line.split('|').map((c) => c.trim());
      if (cells.length < 4 || !cells[1]!.startsWith('`')) continue;
      const roleCell = cells[2]!;
      const role: Role | undefined = (['Main Agent', 'Orchestrator', 'either'] as const).find((r) => roleCell === r);
      if (role === undefined) continue; // the Worker "never" row
      let current: string | undefined;
      const spanRe = /`([^`]+)`/g;
      let match: RegExpExecArray | null;
      while ((match = spanRe.exec(cells[1]!)) !== null) {
        const span = match[1]!;
        const [head = '', ...rest] = span.split(/\s+/);
        const preceded = cells[1]!.slice(0, match.index).trimEnd();
        const continuation = head.startsWith('-') || preceded.endsWith('/');
        if (commandDocNames.includes(head) || (!continuation && current === undefined) || !continuation) {
          current = head;
          table.set(current, [...(table.get(current) ?? []), { role, qualifier: rest.join(' ') }]);
        } else {
          expect(current).toBeDefined();
          table.set(current!, [...(table.get(current!) ?? []), { role, qualifier: span }]);
        }
      }
    }
    return table;
  }

  function parseRoleLine(doc: string): Assignment[] {
    const text = shippedContent(`commands/${doc}.md`).toString('utf8');
    const lines = text.split('\n');
    const h1 = lines.findIndex((l) => l.startsWith('# '));
    const roleLines = lines.filter((l) => l.startsWith('**Role:**'));
    expect(roleLines, `${doc}: exactly one Role line`).toHaveLength(1);
    expect(lines[h1 + 2], `${doc}: Role line directly under the H1`).toBe(roleLines[0]);
    const body = roleLines[0]!.replace(/^\*\*Role:\*\*\s*/, '');
    return body.split(' · ').map((segment) => {
      const m = /^(Main Agent|Orchestrator|either)(?: \((.*)\))?$/.exec(segment);
      expect(m, `${doc}: unparseable Role segment "${segment}"`).not.toBeNull();
      return { role: m![1] as Role, qualifier: m![2] ?? '' };
    });
  }

  const table = parseDecisionTable();

  it('parses every shipped command doc out of the table (no doc is missing from the record)', () => {
    expect(table.size).toBeGreaterThan(0);
    for (const doc of commandDocNames) expect([...table.keys()], `${doc} absent from Decision 1`).toContain(doc);
  });

  // An ms-* alias doc is byte-identical to its milestone-* canonical (M019),
  // so its expected roles are the canonical's; the table's own alias entries
  // (where a row spells out `ms-…`) must only ever agree with that.
  function expectedFor(doc: string): Assignment[] {
    const canonical = doc.replace(/^ms-/, 'milestone-');
    const expected = table.get(canonical)!;
    if (canonical !== doc) {
      for (const own of table.get(doc) ?? []) {
        expect(expected.map((a) => a.role), `${doc}: alias row contradicts ${canonical}`).toContain(own.role);
      }
    }
    return expected;
  }

  it.each(commandDocNames.map((doc) => [doc]))('commands/%s.md Role line matches the Decision 1 table', (doc) => {
    const expected = expectedFor(doc);
    const actual = parseRoleLine(doc);
    const expectedRoles = new Set(expected.map((a) => a.role));
    expect(new Set(actual.map((a) => a.role))).toEqual(expectedRoles);
    if (expectedRoles.size === 1) {
      const [only] = expected;
      expect(actual).toEqual([{ role: only!.role, qualifier: only!.role === 'either' ? 'read-only' : '' }]);
      return;
    }
    const docTokens = actual.flatMap((a) => a.qualifier.split(', ').map((t) => [a.role, t.split(' ')[0]!] as const));
    for (const [, token] of docTokens) {
      expect(docTokens.filter(([, t]) => t === token), `${doc}: "${token}" listed under two roles`).toHaveLength(1);
    }
    for (const { role, qualifier } of expected) {
      if (qualifier === '') continue;
      const token = qualifier.split(/\s+/)[0]!;
      expect(docTokens, `${doc}: "${token}" should be under ${role}`).toContainEqual([role, token]);
    }
  });

  function commandsIn(text: string): string[] {
    return [...text.matchAll(/`([a-z-]+)(?:\s[^`]*)?`/g)].map((m) => m[1]!).filter((c) => table.has(c));
  }

  it('protocol-orchestrator.md lists only Orchestrator/either commands as "You run" and only Main Agent ones as "never run"', () => {
    const text = shippedContent('protocol-orchestrator.md').toString('utf8');
    const runs = /\*\*Run only execution commands\.\*\* You run([\s\S]*?)plus any read-only/.exec(text);
    const never = /\*\*You never run a gate or scope command\*\*:([\s\S]*?)belong to the Main Agent/.exec(text);
    expect(runs).not.toBeNull();
    expect(never).not.toBeNull();
    const runCommands = commandsIn(runs![1]!);
    const neverCommands = commandsIn(never![1]!);
    expect(runCommands.length).toBeGreaterThan(0);
    expect(neverCommands.length).toBeGreaterThan(0);
    for (const cmd of runCommands) {
      expect(table.get(cmd)!.some((a) => a.role !== 'Main Agent'), `${cmd} is Main Agent-only`).toBe(true);
    }
    for (const cmd of neverCommands) {
      expect(table.get(cmd)!.some((a) => a.role === 'Main Agent'), `${cmd} has no Main Agent side`).toBe(true);
    }
    // Every Orchestrator-owned command in the table is named on the "You run" side.
    for (const [cmd, assignments] of table) {
      if (assignments.some((a) => a.role === 'Orchestrator')) expect(runCommands, `${cmd} missing`).toContain(cmd);
    }
  });

  it('protocol-driver.md role-split paragraph defers to the record and names no command on the wrong side', () => {
    const text = shippedContent('protocol-driver.md').toString('utf8');
    const paragraph = /\*\*Role split \(M040\)\.\*\*([\s\S]*?)\n\n/.exec(text);
    expect(paragraph).not.toBeNull();
    expect(paragraph![1]).toMatch(/Orchestrator runs the execution\s+commands/);
    expect(paragraph![1]).toMatch(/only\s+the Main Agent runs gate and scope commands/);
    expect(paragraph![1]).toContain('docs/architecture/orchestrator-role.md');
    // The paragraph assigns roles by class, not by name; any command it does
    // name must still sit on the side the table gives it.
    const main = /only\s+the Main Agent runs([^.]*)\./.exec(paragraph![1]!);
    for (const cmd of commandsIn(main?.[1] ?? '')) {
      expect(table.get(cmd)!.every((a) => a.role === 'Main Agent'), `${cmd} is not Main Agent's`).toBe(true);
    }
  });
});
