---
title: "Rate limiting without Redis: one table and one UPSERT"
description: "How Zerosoft rate-limits its API and public endpoints with a fixed-window counter stored in the same SQLite/libSQL database, and when that stops being a good idea."
date: "2026-09-10"
author: "Zerosoftware"
tags: ["engineering", "architecture", "sqlite"]
---

Ask the internet how to rate-limit a web app and the answer arrives in under a second: Redis. `INCR`, `EXPIRE`, done. It's a good answer. It's also one more service to run, secure, monitor and pay for — and for a project whose self-host story is "one container, one file", one more service is a real cost.

So Zerosoft rate-limits in the database it already has. Here's how it works, why it's correct, and where it falls short.

## The problem: counters need to be shared

The obvious first version is a `Map` in memory: key → count. It works perfectly on your laptop and does nothing useful in production.

Zerosoft Cloud runs on serverless functions. Each instance has its own memory, instances come and go, and a burst of traffic can spread across a dozen of them. An in-memory limit of 100 per minute becomes "100 per minute per instance, times however many instances exist right now". That's not a limit, that's a suggestion.

The counter has to live somewhere every instance can see. Redis is one such place. The database is another — and we already pay for that one.

## The whole implementation

It's in `lib/rate-limit.ts`, and it's short. The table:

```sql
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_expires ON rate_limits(expires_at);
```

And the check, one statement per request:

```ts
const windowStart = Math.floor(now / windowMs) * windowMs;
const row = await db.prepare(
  `INSERT INTO rate_limits (key, window_start, count, expires_at) VALUES (?, ?, 1, ?)
   ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1
   RETURNING count`,
).get(key, windowStart, windowStart + windowMs);

return { ok: count <= limit, remaining: Math.max(0, limit - count), resetAt: windowStart + windowMs };
```

That's a **fixed window**. Time is cut into buckets aligned to the clock (every minute starts at :00), and each key gets a counter per bucket.

The important part is that the increment and the read are the same statement. There's no "read the count, add one, write it back" in application code — the pattern that breaks under concurrency because two requests read 99, both write 100, and both get through. SQLite executes the UPSERT atomically, and `RETURNING` hands back the value it just wrote. Two simultaneous requests get 100 and 101, not 100 and 100.

## Cleaning up

Every window leaves a row behind. Instead of a separate job, cleanup is lazy: at most once a minute per instance, a request fires a `DELETE FROM rate_limits WHERE expires_at < ?` and doesn't wait for it. The `expires_at` index keeps that cheap. The table stays small without anyone thinking about it.

## Where it's used

Two layers sit on top of `rateLimit()`.

**The API.** Every `/api/v1` request is limited to **100 per minute per key**. The bucket is the SHA-256 of the key, and the check runs *before* the key is validated — so guessing keys burns the same budget. Requests with invalid keys get a second limit: 20 per minute per IP. (The [API guide](/blog/api-rest-v1-con-claves-personales) covers what a client sees.)

**Public endpoints.** `limitByIp()` builds the key from a bucket name plus the client IP, and returns a ready-made `429` with a `Retry-After` header. Some real values from the code:

- Booking a slot in Cal: 10 per 10 minutes.
- Fetching available slots: 120 per minute.
- Password-protected link gate: 30 per minute per IP, plus 5 per minute per IP *and* per link.
- Sending a chat message from the widget: 30 per minute.
- Importing links (from Bitly or a CSV): 5 per 10 minutes.

For load testing locally, `RATE_LIMIT_DISABLED=true` turns off the per-IP limits.

## The IP problem

Per-IP limits are only as good as the IP you read. `clientIp()` takes `x-vercel-forwarded-for`, then the first entry of `x-forwarded-for`, then `x-real-ip`. On Vercel those are set by the edge, not the client. When you self-host, they're set by your reverse proxy — so configure it to overwrite `X-Forwarded-For` rather than append to it, or a client can just send its own. The [Docker guide](/blog/self-hosting-con-docker-paso-a-paso) has the one-liner for Nginx.

## The honest tradeoffs

This design is a choice, not a free lunch.

**Every limited request is a write.** On a local SQLite file that's microseconds, but SQLite has a single writer, so rate-limit writes queue up with every other write. On Turso it's a network round trip. Redis does an `INCR` in memory in well under a millisecond. If you're rate-limiting tens of thousands of requests per second, the database is the wrong place for this.

**Fixed windows allow bursts at the edges.** A client can send 100 requests at 12:00:59 and another 100 at 12:01:00. Over that two-second span it got 200. Sliding windows or token buckets fix this; they're easy in Redis with a Lua script and awkward in SQL. For "stop abuse" limits, fixed windows are fine. For strict billing quotas, they aren't.

**Rejected requests still count.** The UPSERT always increments, so a client hammering after its limit keeps the counter growing. Harmless — it resets next window — but don't use `count` as a metric of legitimate traffic.

**Shared fate.** If the database is down, rate limiting fails with it. We consider that a feature: if the database is down, nothing else works either, and one dependency fails more simply than two.

## When to reach for Redis

Move the counters out when one of these becomes true:

- Rate-limit writes are a meaningful share of your total database writes.
- The added latency per request shows up in your p99.
- You need sliding windows, token buckets or per-second precision.
- You already run Redis for something else, so the extra-infrastructure argument is gone.

Until then, one table, one index and one UPSERT do the job — and the self-hoster gets rate limiting with zero extra containers.
