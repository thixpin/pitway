---
name: security-audit
description: Security review and hardening workflow — root-cause analysis of vulnerabilities, authentication and authorization checks, least privilege, input handling, secret hygiene, and security regression tests. Use when reviewing code for security, fixing a vulnerability, hardening a feature, or handling auth, permissions, secrets, or untrusted input. For a quick automated pass on pending changes, the built-in /security-review also exists; this skill defines the standards to apply.
---

# Security Audit

Fix causes, not symptoms; verify every trust boundary; leave a regression test behind.

## Scope

**Use for** anything touching a trust boundary: security review, fixing a vulnerability, hardening a feature, or writing code that handles auth, permissions, secrets, or untrusted input.

**Do not use for:**
- General code quality with no security dimension — use `code-quality-review`.
- A quick automated pass over pending changes — the built-in `/security-review` does that. This skill defines the standards to apply.

## Root cause discipline

- For any vulnerability, identify the trust failure behind it (unvalidated input, missing authorization, confused deputy, secret in the wrong place) — then fix that, not just the reported instance.
- Search for the same pattern elsewhere in the codebase; vulnerabilities ship in families.
- Never "fix" a security finding by hiding the symptom (suppressing the error, filtering the payload string, disabling the scanner rule).

## Authentication

- Every non-public endpoint/entry point verifies identity server-side; client-side checks are UX, never enforcement.
- Credentials: hashed with a modern KDF (bcrypt/argon2), never logged, never in URLs; sessions/tokens expire, rotate on privilege change, and invalidate on logout.
- Auth failures are uniform (no user-enumeration via differing errors/timing) and rate-limited.

## Authorization

- Authorization is checked on every request at the resource level — object ownership, not just role ("can this user access *this* record", not "is this user logged in"). Missing object-level checks (IDOR) are the most common real-world hole.
- Deny by default; new endpoints and routes require an explicit permission decision.
- Enforcement lives server-side in one place (middleware/policy layer), not copy-pasted per handler.

## Least privilege

- Code, services, tokens, and DB accounts get the minimum scope that works: read-only where read-only suffices, scoped tokens over master keys, short-lived over long-lived.
- New dependencies and integrations reviewed for what access they actually require.

## Input & data handling

- All input from outside the trust boundary (users, other services, files, headers, webhooks) is validated at entry, then handled with safe primitives: parameterized queries, context-aware output encoding, safe deserializers, path canonicalization before filesystem access.
- Sensitive data (credentials, tokens, PII) excluded from logs, error messages, and stack traces shown to clients.

## Secrets

- No secrets in source, config committed to VCS, or client-delivered code; use the project's secret store or environment mechanism.
- A secret that was ever committed is compromised: rotation is the fix, deletion from history is cleanup.

## Security regression tests

- Every fixed vulnerability gets a test proving the exploit path is closed (e.g., the unauthorized request now returns 403, the injection payload is inert).
- Authorization rules get negative tests: the wrong user/role is denied, not merely the right one allowed.

## Reporting

- Report findings with severity based on impact and exploitability, and note explicitly which classes of vulnerability were checked and which were out of scope.
