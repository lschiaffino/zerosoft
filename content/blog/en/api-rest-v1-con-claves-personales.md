---
title: "The REST API v1 by example: personal keys, curl and real errors"
description: "Create a zs_ key, shorten links, read click stats and create CRM contacts and deals from a script. Every example matches the route handlers, errors included."
date: "2026-08-13"
author: "zerosoft"
tags: ["api", "developers", "tutorial"]
---

We've written about [why we document every API](/blog/apis-abiertas-por-que-documentamos-todo). This is the practical side: a walkthrough of zerosoft's REST API v1 with copy-pasteable `curl` commands for Link and the CRM, plus the errors you'll actually hit.

Everything here was checked against the route handlers in `app/api/v1`, not just the docs page. The base URL is `https://zerosoft.ai/api/v1` on zerosoft Cloud, or `https://your-host/api/v1` if you self-host.

## Get a key

Go to Dashboard → Settings → API keys, give the key a name ("CI deploy", "zapier-replacement", whatever), and create it.

Three things to know:

- **It's shown once.** The key looks like `zs_` followed by 32 random characters. We store only its SHA-256 hash and the first 10 characters as a visible prefix. Lose it and you make a new one.
- **It acts as the workspace.** Records created through the API land in the same workspace you see in the dashboard. Admins see every key in the workspace; members see only the ones they created. The list shows when each key was last used, and revoking takes effect on the next request.
- **100 requests per minute, per key.** More on that below.

Put it in an environment variable and stop thinking about it:

```bash
export ZS_KEY="zs_..."
export ZS="https://zerosoft.ai/api/v1"
```

## Links

Create a short link. Only `url` is required; `slug` (up to 32 characters), `title`, `tags` (up to 5) and `domain` (a custom domain you've verified) are optional.

```bash
curl -X POST "$ZS/links" \
  -H "Authorization: Bearer $ZS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/spring-launch", "slug": "spring", "tags": ["launch"]}'
```

You get a `201` with `id`, `slug`, `domain`, `short_url`, `url`, `title`, `tags` and `created_at`.

List them, paginated (`pageSize` maxes out at 50):

```bash
curl "$ZS/links?page=1&pageSize=50" -H "Authorization: Bearer $ZS_KEY"
```

The response is `{ "links": [...], "total": n }`, archived links included, each with its click count.

Clicks per day for the last 30 days:

```bash
curl "$ZS/links/LINK_ID/stats" -H "Authorization: Bearer $ZS_KEY"
# { "slug": "spring", "total": 312, "byDay": [{ "date": "...", "count": 41 }, ...] }
```

That's enough to build a weekly report in a cron job without ever opening the dashboard.

## CRM: contacts

Search and paginate (`pageSize` up to 100):

```bash
curl "$ZS/crm/contacts?q=ana&page=1&pageSize=25" -H "Authorization: Bearer $ZS_KEY"
```

Create one. Note that request bodies use **camelCase** field names, while responses return the stored row with **snake_case** columns:

```bash
curl -X POST "$ZS/crm/contacts" \
  -H "Authorization: Bearer $ZS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"firstName": "Ana", "lastName": "Garcia", "email": "ana@example.com", "lifecycleStage": "lead", "source": "event"}'
# 201 → { "id": "...", "first_name": "Ana", "last_name": "Garcia", "lifecycle_stage": "lead", ... }
```

Update with `PATCH`: every field is optional:

```bash
curl -X PATCH "$ZS/crm/contacts/CONTACT_ID" \
  -H "Authorization: Bearer $ZS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jobTitle": "Head of Ops", "city": "Montevideo"}'
```

Companies work the same way at `/crm/companies` and `/crm/companies/:id`.

## CRM: deals and tasks

Deals need a pipeline and a stage, so ask for those first:

```bash
curl "$ZS/crm/pipelines" -H "Authorization: Bearer $ZS_KEY"
```

Each pipeline comes with its stages (`id`, `name`, `probability`, `isWon`, `isLost`). Then:

```bash
curl -X POST "$ZS/crm/deals" \
  -H "Authorization: Bearer $ZS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"pipelineId": "PIPELINE_ID", "stageId": "STAGE_ID", "name": "Acme renewal", "amount": 4800, "currency": "USD", "contactIds": ["CONTACT_ID"]}'
```

`GET /crm/deals` lists deals for `?pipelineId=…`, or for your first pipeline if you omit it.

Tasks hang off contacts, companies or deals:

```bash
curl -X POST "$ZS/crm/tasks" \
  -H "Authorization: Bearer $ZS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"subject": "Send renewal proposal", "dueAt": "2026-08-20 15:00", "dealId": "DEAL_ID"}'

curl "$ZS/crm/tasks?bucket=overdue" -H "Authorization: Bearer $ZS_KEY"
```

`bucket` accepts `overdue`, `today`, `upcoming` or `done`. Dates use `YYYY-MM-DD`, optionally followed by a time.

There are also Cal endpoints (event types, bookings, cancel) under `/calendar`: the [docs](/docs) have them.

## Errors: one shape for everything

Every v1 error has the same body:

```json
{ "error": { "code": "slug_taken", "message": "That slug is already taken." } }
```

Branch on `code`, show `message` to humans. The ones you'll meet:

| Status | Code | When |
| --- | --- | --- |
| 401 | `invalid_key` | Missing `Authorization: Bearer …` header, or the key is wrong or revoked. |
| 429 | `rate_limited` | More than 100 requests in the current minute for this key. |
| 400 | `invalid_url`, `invalid_slug`, `slug_taken`, `invalid_domain` | Link creation problems. |
| 400 | `invalid_input`, `invalid_email`, `missing_name` | The CRM body didn't validate. |
| 400 | `invalid_pipeline`, `invalid_stage` | The pipeline doesn't exist, or the stage isn't in it. |
| 404 | `not_found` | The record doesn't exist in your workspace. |

## About that rate limit

The limit is a fixed one-minute window per key, counted in the database (we wrote [a whole post about how](/blog/rate-limiting-en-la-base-de-datos)). Two details worth knowing:

- **It's counted before the key is validated.** Brute-forcing keys burns the same budget. Invalid keys are also capped at 20 attempts per minute per IP.
- **The 429 has no `Retry-After` header.** Windows align to the clock minute, so the simplest correct client sleeps until the next minute starts and retries.

```bash
# naive but correct
until curl -fsS "$ZS/links" -H "Authorization: Bearer $ZS_KEY"; do sleep 15; done
```

For bulk imports, pace yourself at well under 100 per minute and you'll never see a 429.

## What's not there (yet)

Being honest about the edges: there's no public API for Track or Chat yet, and there's no OAuth for third-party apps: keys are personal. If the dashboard can do something the API can't, that's a gap, not a design choice. Open an issue.
