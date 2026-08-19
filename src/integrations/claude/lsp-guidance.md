# LSP Guidance

If a compatible language-server capability is already available to you —
already running, already wired into your tooling — use it for navigation
and symbol lookup where it's a better fit than filesystem search. If one
isn't available, proceed with standard filesystem/search tools; that's a
complete, expected way to work, not a degraded one.

Rules, in order:

- **Never install or reconfigure anything** to get LSP support. If it's not
  already there, it's not there — don't add a language server, don't edit
  editor/tooling config to enable one, don't ask the developer to set one
  up on PitWay's behalf.
- **Treat any LSP diagnostic as advisory only**, never authoritative.
  Whether a change is correct is decided by the task's actual tests, lint,
  and typecheck — the verification instructions in the task-context bundle
  — not by what a language server's inline diagnostics say. An LSP that's
  stale, misconfigured, or simply wrong about a false positive/negative
  never overrides what the real verification command reports.

PitWay itself has no LSP detection or integration code, and does not
inventory, manage, or make claims about whatever tool availability a
driver or worker happens to have. This guidance describes how to use an
LSP if one is already sitting there — it is not a feature PitWay provides
or depends on.
