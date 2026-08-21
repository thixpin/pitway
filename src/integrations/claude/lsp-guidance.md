# LSP Guidance

If a compatible language-server capability is already available — running
and wired into your tooling — use it for navigation and symbol lookup
where it beats filesystem search. If not, standard filesystem/search tools
are a complete, expected way to work, not a degraded one.

- **Never install or reconfigure anything** to get LSP support: no adding
  a language server, no editing editor/tooling config to enable one, no
  asking the developer to set one up on PitWay's behalf.
- **Treat any LSP diagnostic as advisory only**, never authoritative.
  Correctness is decided by the task's actual tests, lint, and typecheck —
  the bundle's verification instructions — never by inline diagnostics,
  which may be stale, misconfigured, or simply wrong.

PitWay has no LSP detection or integration code and makes no claims about
a driver's or worker's tool availability; this describes using an LSP if
one is already there, not a feature PitWay provides or depends on.
