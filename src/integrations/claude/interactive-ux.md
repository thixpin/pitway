# Interactive Decision UX

The arrow-key decision prompts a driver session shows the developer, and how
they connect to `pitway auto-run`. This UX is owned entirely by the Claude
integration layer — Core and the CLI stay non-interactive; nothing here is
a PitWay-built TUI. Render these prompts through your own harness's
interactive capability.

## The two prompts

**Milestone approval prompt** (shown once the contract has been presented in
full): **Yes (confirm)** / **No (default)** / **Write-artifacts-only**.
Selecting Yes runs `pitway milestone-confirm` per `protocol-driver.md`'s
decision-gate rule; No leaves the milestone in `draft`; Write-artifacts-only
runs `pitway write-ms-artifacts` without confirming anything.

**Task continuation prompt** (shown after a task completes, before the
next one starts): **Yes, run one (default)** / **Auto-run** / **No, pause**.
Yes-run-one dispatches exactly the next task and returns to this prompt.
No-pause stops here. Selecting **Auto-run** calls `pitway auto-run enable`
for the active milestone, then continues dispatching tasks without
re-prompting — until an invalidation gate below is hit.

## What auto-continue checks on every step

Auto-run authorization is necessary but never sufficient by itself. Before
dispatching each task while auto-run is active:

1. Call `pitway auto-run status` first. This reports the two gates PitWay
   can compute purely from the journal's own log order — it never needs a
   live check of its own:
   - **hash change** — the milestone's `verification_approved_hash` no
     longer matches the hash recorded at `enable` time.
   - **amendment recorded since** — a `contract_amendment` or
     `task_amendment` journal entry for the milestone was recorded after
     the `enable` record.
2. Then run the live checks Core cannot precompute — each requires
   inspecting the actual state of the run, not just the journal:
   - unexpected dirty files in the working tree
   - a verification failure that needs a decision, including a flaky
     pass-after-timeout
   - missing manual/review evidence
   - genuine ambiguity in what to do next
   - a step that requires a permission the current session doesn't have
   - a merge conflict
   - a destructive action about to be taken

Hitting *any* of these gates — computed or live-checked — calls
`pitway auto-run disable` and then falls back to per-task confirmation
(the Yes-run-one/Auto-run/No-pause prompt above, for every subsequent task)
rather than continuing unattended.

## Bootstrap disclosure

M006's own lifecycle uses the M005 journal/checkpoint model normally except
for this task's own confirmation UX, which could not have confirmed M006
itself.

M006 uses M005's journal/checkpoint model normally for its own real
lifecycle — confirm, every task commit, eventual completion. The only gap
is the one sentence above: this task's own confirmation UX didn't exist yet
at M006's baseline confirm, so it couldn't have been used to confirm M006.
