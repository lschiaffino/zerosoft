# Change management policy

Last reviewed: 2026-11-09 · Owner: security officer · Review: yearly

## How a change reaches production

1. **Branch.** All work happens on a branch (people and coding agents alike). Nobody commits
   directly to `main` except the merge itself.
2. **Pull request.** Every change goes through a PR on GitHub with a description of what
   changed and how it was tested. Database changes are migrations appended to
   `lib/schema/migrations.ts`; they are forward-only and idempotent.
3. **Automated checks (CI, `.github/workflows/`):** type check, lint, unit tests, production
   build, end-to-end tests in four shards plus the real-integration suite, Docker self-host
   smoke test, CodeQL static analysis, secret scanning (gitleaks) and a dependency audit. The
   single required status is "CI result".
4. **Review.** Changes to sensitive paths (auth, sessions, access control, schema, CI,
   licensing) need the owner's review (`.github/CODEOWNERS`). Security-relevant changes also
   get an independent security review (a second reviewer or a dedicated review agent) before
   merge, recorded in the PR.
5. **Merge and deploy.** Only the owner (or the automation acting for the owner) merges to
   `main` when CI is green. Vercel deploys `main` automatically; every deployment is immutable
   and linked to its commit, so rollback is promoting the previous deployment.
6. **Verify.** After deploy, the changed flow is checked in production; problems are rolled
   back first and fixed after.

## Emergency changes

A security fix or outage fix may be merged with a shortened review, but never without CI.
It is reviewed after the fact within two business days and noted in the incident record.

## Separation of environments

Production data never goes to development or test. Tests use generated data (`tests/`) and
fakes for third-party services. Preview deployments are disabled except for `main`
(`vercel.json`).

## Evidence for auditors

GitHub PR history (author, reviewers, checks, merge time), Actions run logs, Vercel deployment
history, and Dependabot / code scanning alerts. These are kept by the providers; the owner
exports a sample each audit period.

## Owner action

Enable branch protection (or a ruleset) on `main`: require a pull request, require the
"CI result" status, block force-pushes and deletions. With a single maintainer, approvals
cannot be required of oneself; add a second reviewer as soon as there is one (SOC 2 auditors
look for segregation between author and approver).
