# Status monitoring (status.zerosoft.ai)

zerosoft checks its own services every minute, opens and resolves incidents
on its own, emails the owner, and publishes the result at `/status` (and at
`status.zerosoft.ai` once its DNS points to the project). A watcher outside
Vercel (the Mac mini) reads the open incidents, reports what the web side
can't see, and writes to each incident's timeline.

Code: `lib/status/` (components, checks, state machine, storage, emails),
`app/api/status/` (the watcher API), `app/[locale]/status/page.tsx` (the page).

## Environment

| Variable | What |
| --- | --- |
| `STATUS_AGENT_TOKEN` | Bearer token for the watcher API. At least 16 characters (`openssl rand -hex 32`). Unset: the API answers 503. Never logged. |
| `ALERT_EMAIL` | Who gets alert emails, one address or several separated by commas. Unset: incidents are tracked but nobody is emailed. |
| `STATUS_SITE_URL` | Optional. The site the cron checks. Default `NEXTAUTH_URL`. |
| `STATUS_HOST` | Optional. Hostnames that serve the page at their root. Default `status.zerosoft.ai`. |
| `STATUS_CHECKS_FAKE` | `1` in e2e and offline development: the cron's checks don't go to the network (only the local database is checked). |

The checks also use `GROUPS_BRIDGE_URL` / `GROUPS_BRIDGE_KEY` (Evolution) and
`RESEND_API_KEY` (email). A check whose variables are missing is skipped.

## Components

Defined in one file, `lib/status/components.ts`: internal id, internal
label, source and the public row it feeds.

| id | Label | Source | Public row |
| --- | --- | --- | --- |
| `web` | Website (home and `/api/version`) | cron | Website |
| `database` | Database (Turso), `SELECT 1`; plan quota blocks are marked as such | cron | Apps and API |
| `whatsapp` | Evolution API: `/instance/fetchInstances` plus a 1-record `findMessages` (goes through its Postgres) | cron | WhatsApp (Lines and Inbox) |
| `evolution-db` | Evolution database | watcher report | WhatsApp (Lines and Inbox) |
| `evolution-db-disk` | Evolution database disk | watcher report | WhatsApp, only when `down` |
| `email` | Resend API reachable | cron | Email |

The public page shows only the public rows, their state, 90 days of bars,
public incidents and their timeline. Never an internal name, host, instance,
error, detail or metric.

## Incident rules

- A check that isn't `up` is a failure (`degraded`, `down`, or `unknown` when
  the watcher stopped reporting).
- An incident opens after **2 consecutive failures** and resolves after **3
  consecutive passes**. A single failure followed by a pass opens nothing.
- One open incident per component (unique index). If the component fails
  again within 30 minutes of resolving, the same incident is reopened.
- While open, each failure increments `failures`; getting worse (degraded to
  down, or unknown to a measured state) adds a timeline entry.
- Report-fed components become `unknown` when no report arrives for **10
  minutes**, which opens an internal incident ("is the watcher down?"). A
  component that never reported is not counted.
- `unknown` incidents and the disk at `degraded` are internal: they email the
  owner but don't appear on the public page.
- The disk also gets a floor from its metrics: 90% used is at least
  `degraded`, 97% at least `down`.

## Emails

To `ALERT_EMAIL` on open, reopen, worse and resolve, with the component, the
raw error (secrets removed) and links. Limits, stored in the database: one
open/reopen email per incident every 30 minutes, a "resolved" email only when
that round's opening was emailed, at most 20 alert emails per hour overall.

If the database itself doesn't answer (Turso blocked or down), nothing can be
stored. The cron then emails the raw error and every check result directly,
at most once every 3 hours (Resend idempotency key).

## Storage and load

One cron run (from `/api/cron/minute`, before anything else) claims the
minute with a compare-and-set on `status_meta`, reads one row per component
and one per public row, and writes in batches. History: `status_minutes`
(one row per component per minute, 7 days), rolled up into `status_hours`
once an hour (90 days). The page's 90-day bars are counters per day stored as
JSON in `status_public.days` (4 rows). The page caches its read for 30
seconds.

## Watcher API

All endpoints need `Authorization: Bearer <STATUS_AGENT_TOKEN>`. Wrong or
missing token: `401`. Token not configured: `503`. Database unavailable:
`503 {"error":"database_unavailable"}` (the watcher should treat that as an
incident of its own).

### GET /api/status/incidents?state=open

`state`: `open` (default), `resolved` or `all`. `limit`: 1 to 100 (default 50).
Returns a bare JSON array, newest first:

```json
[
  {
    "id": "6c0f…",
    "component": "evolution-db",
    "componentName": "Evolution database",
    "title": "Evolution database down",
    "severity": "down",
    "state": "open",
    "public": true,
    "startedAt": "2026-11-14T19:24:00.000Z",
    "lastFailureAt": "2026-11-14T19:31:00.000Z",
    "resolvedAt": null,
    "failures": 8,
    "lastError": "pg: No space left on device",
    "notes": [
      { "id": "…", "at": "2026-11-14T19:25:00.000Z", "by": "system", "kind": "opened", "text": "2 consecutive failed checks: …", "public": true },
      { "id": "…", "at": "2026-11-14T19:27:00.000Z", "by": "watcher", "kind": "note", "text": "Volume at 100%", "public": false }
    ]
  }
]
```

`severity`: `degraded`, `down` or `unknown`. Note `by`: `system`, `watcher`
or `claude`. Note `kind`: `opened`, `reopened`, `now_down`, `now_degraded`,
`resolved` (system) or `note` (written through the API). For system notes the
page shows a fixed sentence per kind, never `text`.

### POST /api/status/incidents/{id}/notes

```json
{ "by": "watcher", "text": "Resized the volume to 1 GB", "public": false }
```

`by`: `watcher` or `claude`. `text`: 1 to 4000 characters. `public`:
optional, default `false`. A public note is shown on the page after removing
URLs, hostnames, IPs, emails and long numbers. Returns `201 {"note": {…}}`,
`404` for an unknown incident, `400` for invalid input.

### POST /api/status/report

```json
{ "component": "evolution-db-disk", "status": "degraded", "detail": "volume almost full", "metrics": { "volumeUsedMB": 462, "volumeSizeMB": 500 } }
```

`component`: `evolution-db` or `evolution-db-disk`. `status`: `up`,
`degraded` or `down`. `detail`: optional, up to 1000 characters (internal).
`metrics`: optional, non-negative numbers. Each report is one check for the
state machine above, so report once a minute. Returns
`200 {"component","status","incidentId"}`, where `status` is the effective
one (after the disk floor) and `incidentId` is the open incident or `null`.

### GET /api/status/summary

Internal state of every component and `lastRunAt`, the last time the cron
ran. If `lastRunAt` is more than a few minutes old, the Vercel cron isn't
running: nothing on the web side can notice that, so the watcher has to.

```json
{
  "lastRunAt": "2026-11-14T19:31:00.000Z",
  "components": [
    { "id": "database", "name": "Database (Turso)", "source": "cron", "status": "up", "incident": null,
      "checkedAt": "…", "reportedAt": null, "lastOkAt": "…", "lastError": null, "detail": null, "metrics": null }
  ]
}
```

## What only the watcher can catch

- The Vercel cron not running (`lastRunAt` stale) or the whole deployment down.
- The database blocked: the web side emails once every 3 hours, and the API
  answers 503.
- Resend down: alert emails can't go out; the incident is still in the API.
