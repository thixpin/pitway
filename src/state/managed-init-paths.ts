import { DRIVERS, classifyDriverAssets, driverDestinationDir } from './driver-assets.js';
import { classifyRootInstructionFiles } from './root-instructions.js';

// AC005/T005: the single shared mechanism that closes two real,
// init-to-git integration gaps -- quick-change create/commit's clean-tree
// checks, and milestone-confirm's own baseline staging for .claude/
// assets -- never a duplicated hardcoded path list.
//
// Composes classifyDriverAssets (M023/T002: over the whole hardcoded driver
// list, so a freshly `pitway init --opencode`'d repo's byte-identical
// .opencode/ assets are recognized exactly like .claude/'s -- an entirely
// absent driver contributes only harmless 'absent' entries) and
// classifyRootInstructionFiles, filters
// OUT every entry classified 'conflict' from both (an 'absent' entry is
// harmless to include -- it is never actually dirty), and unconditionally
// unions in the two literal paths '.pitway/config.yaml' and
// '.pitway/state.yaml' -- no content check of their own, mirroring
// src/git/baseline.ts's own hardcoded treatment of these identical two
// paths. These two files are PitWay's own state, written only by PitWay's
// own commands; the only window in which either is genuinely dirty is
// between a fresh `pitway init` and that repository's first-ever commit --
// once any baseline or quick-change commit lands, both become tracked and
// clean, so neither can reappear here as leftover dirt from a later,
// legitimate edit.
export function listSafeManagedDirtyPaths(root: string): string[] {
  const driverAssetPaths = DRIVERS.flatMap((driver) =>
    classifyDriverAssets(root, driver)
      .filter((c) => c.status !== 'conflict')
      .map((c) => `${driverDestinationDir(driver)}/${c.asset}`),
  );
  const rootInstructionPaths = classifyRootInstructionFiles(root)
    .filter((c) => c.status !== 'conflict')
    .map((c) => c.file);
  return ['.pitway/config.yaml', '.pitway/state.yaml', ...driverAssetPaths, ...rootInstructionPaths];
}
