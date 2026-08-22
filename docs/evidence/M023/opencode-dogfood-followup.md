# OpenCode Dogfood — Manual Follow-Up (M023/T003, AC008)

## What was NOT done

Real, end-to-end OpenCode-driven dogfood — an actual OpenCode session
executing a real PitWay milestone through the installed `.opencode/`
assets — was **not performed by this milestone**. No OpenCode CLI is
available in the execution environment, so there was nothing to invoke.
Nothing in M023's completion evidence claims otherwise: this milestone
verified the OpenCode integration **structurally only**.

## Manual follow-up for the developer

1. In a real repository, run `pitway init --opencode`.
2. Open OpenCode in that repository.
3. Verify the surface: the PitWay `/commands` appear (from
   `.opencode/commands/*.md`) and the vendored skills are discoverable
   (from `.opencode/skills/<name>/SKILL.md`).
4. Drive **one real milestone end-to-end** from that OpenCode session —
   requirement through contract confirmation, task execution, verification,
   and completion — using the installed OpenCode assets as the driver
   protocol.
5. Record findings (anything that only surfaces under a live OpenCode
   session — frontmatter rendering, command argument handling, skill
   loading) as evidence and, where fixes are needed, as backlog items.

Note: OpenCode also natively falls back to `.claude/skills/` (see
`docs/evidence/M022/opencode.md`), so a repo initialized with both drivers
may mask `.opencode/`-specific issues — the follow-up should confirm the
`--opencode --no-claude` shape works on its own too.

## What WAS structurally verified instead

`tests/integration/multi-driver-assets.test.ts` (this task) proves, against
the real shipped source tree and a real temp-repo `pitway init --opencode`:

- Every logical asset resolves to the correct **source** tier for both
  drivers — Claude command docs from `src/integrations/claude/`, OpenCode
  command docs from `src/integrations/opencode/`, skills and protocol docs
  from `src/integrations/common/` for both — with expectations re-derived
  from glob discovery of the actual directories, never hardcoded counts.
- Both drivers ship the same command-doc set (including the `ms-*.md`
  aliases), derived by glob.
- Every logical asset maps to the correct **destination** per driver
  (`.claude/<rel>` vs `.opencode/<rel>`), and installing both drivers into
  one real repo produces zero destination-path collisions with both
  installed trees byte-identical to their resolved sources.
- The **stray-override guard**: every file in a driver directory either
  shadows an existing `common/` relative path or belongs to that driver's
  declared driver-specific class (`commands/*.md`); anything else fails the
  test naming the offending file, proven to bite via a fixture with a
  typo'd `protcol-driver.md`.

Structural verification demonstrates installation correctness; it does not
demonstrate that OpenCode behaves well when actually driving a milestone.
That claim stays open until the manual follow-up above is done.
