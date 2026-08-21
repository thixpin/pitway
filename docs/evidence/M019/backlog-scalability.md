# Backlog storage scalability (B003 / AC017)

## Question

`.pitway/backlog.yaml` is a single file, loaded and saved in full on every
mutation (`loadBacklog`/`saveBacklog`, `src/state/store.ts:240-250`). Does
that design hold up against realistic PitWay usage, or does it need
archival/partitioning/another storage strategy, as B003 (`.pitway/backlog.yaml`)
speculates?

## Current implementation (confirmed by inspection)

- `loadBacklog(root)` (`src/state/store.ts:240-246`) reads
  `.pitway/backlog.yaml` and parses it whole through `loadYaml`/`backlogFileSchema`;
  absent-file tolerance returns `{ schema_version: 1, items: [] }` (never
  scaffolded by `pitway init`, lazily created on first `backlog add`).
- `saveBacklog(root, backlog)` (`src/state/store.ts:248-250`) serializes the
  **entire** `items` array back to disk via `saveYaml` — `yaml`'s
  `stringify` plus one `writeFileSync`, no partial/append write.
- Every mutating operation follows the identical load-whole → mutate
  in-memory → save-whole round trip, with no locking or diffing:
  - `addBacklogItem` (`src/core/backlog/add.ts:87-113`): load, append one
    item, save.
  - `promoteBacklogItem` (`src/core/backlog/promote.ts:30-64`): load, map
    one item to an updated copy, save.
  - `archiveBacklogItem` (`src/core/backlog/archive.ts`): same shape.
  - `listBacklogItems`/`showBacklogItem` (`src/core/backlog/list.ts`,
    `show.ts`): load-only, filter in memory.
- This is not a special case: `saveYaml`/`loadYaml` (`src/state/store.ts:118-140`)
  is the single mechanism backing every other `.pitway/` state file
  (`state.yaml`, `config.yaml`, per-milestone `tasks.yaml`,
  `verification-results.yaml`, `usage.yaml`, `reviews.yaml`). Backlog's
  design is PitWay's one and only state-persistence convention, not a
  shortcut taken for this file specifically. None of these files use
  atomic temp-file-plus-rename writes either — `saveYaml` writes directly
  via `writeFileSync`, matching backlog's own risk profile to every
  sibling state file already trusted in production.
- The backlog schema (`src/state/schemas.ts:416-473`) bounds each item to a
  handful of short fields: `id` (`B###`), `title` (≤80 chars), free-text
  `reason`, an enum `status`, two small reference objects, three
  timestamps. There is no unbounded sub-collection per item (no comments,
  no history log inside an item) — the array only grows by whole items,
  each cheap.

## Concurrency and write frequency

- PitWay's own operating model is explicitly single-developer,
  human-paced: milestone execution is sequential (no parallel git
  mutation; `CLAUDE.md` — "No branches/worktrees/stashes/merges" at the
  historical layer, and worktree-dispatched task workers are contractually
  forbidden from touching `.pitway/` at all — `protocol-worker.md`: "never
  read or write anything under `.pitway/`"). Every `backlog.yaml` write
  therefore happens from the main checkout, one command invocation at a
  time, driven by a human or their single driver session. There is no
  multi-writer scenario to protect against, so the absence of file locking
  is not a gap relative to actual usage — it matches every other
  `.pitway/` file's concurrency assumption.
- Backlog items are created at the rate of "things a human/agent noticed
  were out of scope mid-task" — inherently bursty and low-volume. The live
  `.pitway/backlog.yaml` in this repository (as of this milestone, M019)
  holds 4 items across 66 lines after 18 milestones of real dogfooding
  (`B001`-`B004`, one already the direct source of this investigation).
  Extrapolating generously — even at 50x that rate (200 items) — the file
  is still on the order of tens of KB.

## Scale analysis

- Read/write cost is O(n) in item count for both `loadYaml`'s `parse` and
  `saveYaml`'s `stringify`, with a full-file rewrite per mutation. For
  small-to-mid text files (KBs, plausibly low hundreds of KB even at
  optimistic multi-year growth) this is sub-millisecond-to-low-millisecond
  work with the `yaml` package — not a scale where whole-file round trips
  are observable to a human running one CLI command at a time.
- The realistic failure mode for a whole-file design is not read/write
  *latency* but a single corrupt/oversized file becoming unwieldy to
  review or diff in git. Backlog items are terminal-state append/update
  only (`pending → promoted|archived`, `src/core/backlog/state-machine.ts`)
  and are never deleted, so git history of `backlog.yaml` stays a clean,
  append-mostly diff — the same property `tasks.yaml` already relies on.
- A partitioning/archival scheme (e.g. splitting resolved items into a
  separate file, or one-file-per-item like milestone directories) would
  add real complexity — a second load path, a migration step for existing
  files, more surface for the schema/state-store layer to keep consistent
  — for a problem (large-file parse/write cost, lock contention) that does
  not exist at this tool's realistic scale or concurrency model.

## Conclusion

**No redesign is warranted at current or realistically foreseeable scale.**
The single-file, whole-load/whole-save design is consistent with every
other `.pitway/` state file, correctly matches PitWay's single-developer,
sequential-write usage model (no concurrent writers to serialize between),
and the item schema keeps per-item cost small and bounded. Observed real
growth (4 items after 18 milestones) is orders of magnitude below any
point where O(n) whole-file YAML parse/stringify would be perceptible in a
human-paced CLI workflow. Per AC017/M019's contract, no production code
change is made on the basis of this investigation. If backlog volume ever
did grow unusually large in some future long-lived deployment, the
concrete trigger to revisit this would be a `backlog.yaml` reaching a size
where `git diff`/review of the file itself becomes unwieldy (a
multi-hundred-item file) — not a performance concern; that would be a new,
separately-scoped backlog item at the time it is observed, not something
to pre-solve here.
