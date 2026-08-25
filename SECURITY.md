# Security Policy

## Supported Versions

Security fixes target the latest published version only.

| Version | Supported |
| --- | --- |
| latest 1.x | :white_check_mark: |
| older releases | :x: |

## Reporting a Vulnerability

Please do not report security vulnerabilities through public GitHub issues.

Use GitHub's private vulnerability reporting instead: open this
repository's **Security** tab and select **Report a vulnerability**. That
creates a private advisory visible only to maintainers until it's resolved
and ready for disclosure.

If private reporting isn't available to you, open a regular issue asking
for a secure contact channel — without describing the vulnerability itself
in the issue.

## Scope

In scope:

- The `pitway` CLI and its Core workflow-state logic (`src/`)
- The driver integration assets `pitway init` installs
  (`src/integrations/` — Claude Code, OpenCode, Codex, and their shared
  common assets)

Out of scope:

- Vulnerabilities in the AI coding agent/driver itself (e.g. Claude Code) —
  report those to the relevant vendor
- Vulnerabilities in a project's own code that PitWay happens to be
  managing

## Response

This is a small, actively maintained open-source project without a formal
SLA. Reports are reviewed as soon as reasonably possible; expect an initial
acknowledgment within a few business days.
