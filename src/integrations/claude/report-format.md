# Report Format

A dispatched worker's report becomes the `--result` file for `pitway
task-update <id> completed --result <file>`: a small YAML or JSON document
with exactly two fields.

- **`summary`** — what was built and why, in a sentence or two: the
  outcome, not a restatement of the objective.
- **`evidence`** — what shows it actually works: the passing test command
  and its pass count, the verification instruction's output, a concrete
  observation. Not a transcript.

## Both fields are capped

`task-update` truncates `summary` and `evidence` to a fixed character
length on write, using the shared `trimTail` helper
(`src/core/verification/text-trim.ts`) that verification evidence already
uses — the same scheme, not a second one. An oversized report is never
silently dropped: the front is cut, the tail kept, and a visible
truncation marker prefixed so a reader can tell the field was cut. The cap
applies only to a fresh write — once a task is `completed`, resupplying
`--result` never re-truncates or rewrites the persisted result (see
`task-update`'s re-entry behavior). Write dense reports the first time.

## Testing discipline: guidance, not enforcement

Run targeted tests while implementing — the specific file or case you're
working on, never the whole suite on every intermediate step — and the
**full** suite once, at the end, as the final gate before reporting done.
PitWay does not enforce this in code; it is a protocol convention that
keeps iteration fast and the final signal trustworthy, not a rule PitWay
can check or block on.
