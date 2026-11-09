# Secure development lifecycle

Last reviewed: 2026-11-09 · Owner: security officer · Review: yearly

## Design

- New features that touch authentication, permissions, file handling, outbound requests,
  AI with customer content or personal data get a short threat check in the PR description:
  who can call it, what it can read or write, what an attacker would try.
- Personal data: collect the minimum, decide retention up front, make it exportable and
  erasable (account and workspace deletion must reach it).

## Build

- Authorization through the shared helpers (`lib/roles.ts`, `lib/permissions.ts`,
  `getCurrentUser` / `requireUser`); never trust ids from the client without checking the
  workspace.
- Outbound requests to user-supplied URLs only through `lib/safe-fetch.ts` (blocks private
  networks).
- HTML from users sanitized (`lib/docs-sanitize.ts`, sanitize-html); uploads that browsers
  would execute are rejected or served with a sandboxing CSP.
- Secrets encrypted with `lib/secret-box.ts`; API keys and codes hashed; comparisons in
  constant time.
- Rate limits on every public or credential-checking endpoint (`lib/rate-limit.ts`).
- Logs without secrets or message bodies.

## Verify

- CI on every PR: types, lint, unit and end-to-end tests, build, CodeQL (security-extended),
  gitleaks, `npm audit` (blocks critical).
- Dependabot weekly updates plus security updates; critical findings fixed within 7 days, high
  within 30, moderate within 90 or accepted in the risk register.
- Independent security review of security-relevant PRs before merge.
- Yearly external penetration test (owner action; first one before the SOC 2 Type I).

## Release

Per [change-management.md](change-management.md). Vulnerability details never go in public
commits, PRs or changelogs; fixes ship with neutral descriptions and are credited after
disclosure.

## Vulnerability disclosure

`SECURITY.md` and /security: security@zerosoft.ai, acknowledgement within 72 hours, safe harbor
for good-faith research.
