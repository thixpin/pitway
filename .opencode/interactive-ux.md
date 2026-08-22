# Interactive Decision UX

The arrow-key decision prompts a driver session shows the developer, and
how they connect to `pitway auto-run`. Owned entirely by the Claude
integration layer — Core and the CLI stay non-interactive; nothing here is
a PitWay-built TUI. Render these prompts through your own harness's
interactive capability.

## The two prompts

**Milestone approval** (after the contract has been presented in full):
**Yes (confirm)** / **No (default)** / **Write-artifacts-only**. Yes runs
`pitway milestone-confirm` per `protocol-driver.md`'s decision gate; No
leaves the milestone `draft`; Write-artifacts-only runs `pitway
write-ms-artifacts` without confirming anything.

**Task continuation** (after a task completes, before the next starts):
**Yes, run one (default)** / **Auto-run** / **No, pause**. Yes-run-one
dispatches exactly the next task and returns to this prompt. No-pause
stops here. Auto-run calls `pitway auto-run enable` for the active
milestone, then continues dispatching without re-prompting until an
invalidation gate below is hit.

## What auto-continue checks on every step

Auto-run authorization is necessary, never sufficient. Before each task
while auto-run is active:

1. `pitway auto-run status` — the two gates PitWay computes purely from
   the journal's own log order: **hash change** (the milestone's
   `verification_approved_hash` no longer matches the hash recorded at
   `enable`) and **amendment recorded since** (a `contract_amendment` or
   `task_amendment` journal entry for the milestone after the `enable`
   record).
2. The live checks Core cannot precompute: unexpected dirty files in the
   working tree; a verification failure that needs a decision, including
   a flaky pass-after-timeout; missing manual/review evidence; genuine
   ambiguity about what to do next; a step requiring a permission the
   session lacks; a merge conflict; a destructive action about to be
   taken.

Hitting *any* gate — computed or live — calls `pitway auto-run disable`
and falls back to per-task confirmation (the task-continuation prompt,
for every subsequent task) rather than continuing unattended.

## Bootstrap disclosure

M006 used M005's journal/checkpoint model normally for its own real
lifecycle (confirm, every task commit, completion). The one gap: this
confirmation UX did not exist yet at M006's baseline confirm, so it could
not have been used to confirm M006 itself.
