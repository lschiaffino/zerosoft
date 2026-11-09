# Retention schedule

Last reviewed: 2026-11-09 · Owner: security officer

What we keep, for how long, and what deletes it. Automated jobs run in `/api/cron/tick`
(hourly) and `/api/cron/minute`; every job claims its rows with compare-and-set or deletes
idempotently, so overlapping runs never double-process.

## Account and platform

| Data | Kept | Deleted by |
| --- | --- | --- |
| Account, workspace and all app content | While the account is active | The customer (each app), or account/workspace deletion |
| Account or workspace after deletion is requested | 30 days (cancellable, exportable) | `runDueErasures` in `lib/privacy.ts` (tick): rows, child rows, uploaded and private files, WhatsApp instances |
| Copies of deleted data in database backups | The provider's point-in-time window (and 35 days for off-provider exports, when set up) | Backup expiry |
| Server-side sessions (IP, user agent) | 30 days max while active; 90 days after they end | `purgeSecurityRecords` (tick) |
| Security audit log (`security_events`) | 365 days | `purgeSecurityRecords` (tick) |
| Docs audit log | 365 days | `pruneDocsAudit` (tick) |
| Rate-limit keys (hashed IP) | Minutes (the window) | Expire with the window |
| Sign-in codes by email (hashed) | Minutes; used codes are cleaned | `lib/email-login.ts` |
| Desktop sign-in codes (hashed) | 2 minutes; cleaned after 1 hour | `lib/desktop-auth.ts` |
| Offline replay keys | Short-lived | `pruneOfflineRequests` (tick) |
| Hosting request logs (Vercel) | Provider retention for the plan | Provider |

## Apps

| Data | Kept | Deleted by |
| --- | --- | --- |
| CRM trash | 90 days | `purgeExpiredTrash` (tick) |
| Board trash | 30 days | `purgeBoardTrash` (tick) |
| Flow run history | Per workspace setting (default in `lib/flow.ts`) | `pruneFlowRuns` (tick) |
| Talk messages | Per workspace retention setting (off by default) | `applyRetention` (tick) |
| Hiring candidates | Per job retention setting | `purgeExpiredCandidates` (tick) |
| Forms responses, partial responses (30 days), unsent uploads, old visits | Per form setting | `purgeFormsRetention` (tick) |
| Assistant attachments never sent | 24 hours | `sweepUnclaimedAttachments` (tick) |
| Link history and deferred clicks | Bounded windows | `pruneLinkHistory`, `pruneDeferredClicks` (tick) |
| Pulse cookieless salts | 2 days (after that, visitor ids cannot be recomputed) | `lib/analytics/cookieless.ts` |
| Send download cache and leftovers | Short-lived | `purgeSendLeftovers` (minute) |
| Recordings and transcripts (Voice, Rec) | While the customer keeps them | The customer; account/workspace deletion |

Customer-configurable retention (Talk, Flow, Hiring, Forms) lets each controller apply its own
policy. Changes to this table go through a PR like any other change.
