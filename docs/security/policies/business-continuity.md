# Business continuity, backups and disaster recovery

Last reviewed: 2026-11-09 · Owner: security officer · Review: yearly

## Objectives

| Service | RTO (time to restore) | RPO (data loss tolerated) |
| --- | --- | --- |
| Web app and API (Vercel) | 1 hour (redeploy or promote previous deployment) | None (stateless) |
| Database (Turso) | 4 hours | Turso point-in-time recovery window (target: minutes) |
| Files (Vercel Blob) | 24 hours | Provider durability; no second copy today (see risks) |
| WhatsApp gateway (Railway) | 24 hours | Numbers may need to be paired again |

## Backups

- **Database:** Turso keeps point-in-time recovery for the plan's retention window. The owner
  confirms the window on the current plan and records it here: ___ days.
- **Weekly logical export** (owner action, recommended): `turso db shell <db> .dump` into an
  encrypted bucket in a different provider/region, kept 35 days. This protects against losing
  the Turso account itself.
- **Files:** Vercel Blob is durable storage but has no versioning; a copy job is a known gap in
  the risk register.
- **Code and configuration:** GitHub (repository) plus `vercel.json`; environment variables
  are exported (names only, values in the password manager) after every change.

Backups follow the same deletion rules as production: erased data disappears from backups when
their retention window passes (at most 35 days for exports; Turso's window for PITR). This is
stated in the privacy policy.

## Restore test (twice a year)

1. Create a branch database from a point in time: `turso db create restore-test --from-db <db> --timestamp <ISO time>`.
2. Point a local build at it (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` of the branch) and check:
   sign-in works, counts of users, workspaces and a sample of app tables match the time chosen.
3. Record date, timestamp restored, duration, checks and problems in the internal repository.
4. Destroy the test database.

## Disaster scenarios

| Scenario | Plan |
| --- | --- |
| Vercel region outage | Wait or redeploy to another region (Project › Functions region) |
| Bad deployment | Promote the previous deployment in Vercel |
| Database corruption or destructive bug | Point-in-time restore to before the event, then replay if possible |
| Loss of a provider account | Restore from the weekly export into a new account; DNS change |
| Founder unavailable | Sealed break-glass credentials with a trusted second person (owner action) |

## Dependencies

Critical providers and their status pages are listed in [vendor-management.md](vendor-management.md).
