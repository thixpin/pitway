# Report Format

A dispatched worker's report becomes the `--result` file for
`pitway task-update <id> completed --result <file>`: a small YAML or JSON
document with exactly two fields, `summary` and `evidence`.

- **`summary`**: what was built and why, in a sentence or two. Not a
  restatement of the task objective — the outcome.
- **`evidence`**: what shows it actually works — the test command that
  passed and its pass count, the verification instruction's output, a
  concrete observation. Not a transcript.

## Both fields are capped, and the cap is real

`task-update` truncates `summary` and `evidence` to a fixed character
length before they're written, using the shared tail-truncation helper
(`trimTail`, `src/core/verification/text-trim.ts`) that verification
evidence already uses — the same scheme, not a second one. An oversized
report is never silently dropped: exceeding the cap truncates from the
front, keeping the tail, and prefixes a visible truncation marker so a
reader can tell the field was cut rather than mistake it for the whole
story.

This only ever applies to a fresh write. Once a task is `completed`, its
recorded result is historical — resupplying `--result` on that same task
never re-truncates or rewrites what's already persisted (see
`pitway task-update`'s re-entry behavior). Write dense reports the first
time; there is no second pass that fixes an over-long one after the fact.

## Testing discipline: guidance, not enforcement

Run targeted tests while you implement — the specific test file or case
you're working on, not the whole suite, on every intermediate step. Run the
**full** suite once, at the end, as the final gate before reporting done.

PitWay does not enforce this in code. Nothing stops a worker from running
the full suite ten times, or from skipping targeted tests and only running
the full suite once at the end anyway. This is a protocol convention worth
following because it keeps iteration fast and the final signal trustworthy
— not a rule PitWay can check or block on.
