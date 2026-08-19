# milestone-cancel

Use to permanently abandon a draft milestone — genuine abandonment, not a
routine correction. Only works while the milestone is still `draft`; the
directory and `contract.md` are preserved (status becomes `cancelled`) and
the id is never reused. No git operation occurs.

If the draft just has a mistake in it, use `milestone-add --replace <id>`
instead — that corrects it in place under the same id without burning it.

See `../protocol-driver.md`. Run `pitway milestone-cancel --help` for flags.
