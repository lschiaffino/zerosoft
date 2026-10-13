---
title: "One codebase, two databases: a local SQLite file or Turso"
description: "zerosoft runs on a SQLite file on disk or on a remote Turso database, switched by one environment variable. How it works in the code and how to choose."
date: "2026-10-10"
author: "zerosoft"
tags: ["engineering", "sqlite", "self-hosting"]
---

We've already made the case that [SQLite is enough](/blog/sqlite-es-suficiente) for apps like ours. This post is about something narrower and more practical: the same zerosoft code runs on a SQLite file sitting next to the app *and* on a remote [Turso](https://turso.tech) database, and the only thing that changes is an environment variable.

zerosoft Cloud runs on Vercel + Turso. A self-hosted container runs on a file. Same queries, same migrations, same tests. Here's how, and what you're actually choosing between.

## The switch is four lines

From `lib/db.ts`:

```ts
const DB_PATH = path.join(process.cwd(), 'data', 'zerosoftware.db');
const DB_URL = process.env.TURSO_DATABASE_URL ?? `file:${DB_PATH}`;
const IS_REMOTE = !DB_URL.startsWith('file:');

createClient({ url: DB_URL, authToken: IS_REMOTE ? process.env.TURSO_AUTH_TOKEN : undefined });
```

That works because of the client underneath: `@libsql/client`. libSQL is Turso's open-source fork of SQLite, and its client speaks to both a local file (`file:` URLs) and a remote server (`libsql://` URLs) with the same API. The SQL dialect is SQLite's in both cases, so there's nothing to translate.

So:

```bash
# Local file (the default): leave it unset
TURSO_DATABASE_URL=

# Remote Turso
TURSO_DATABASE_URL=libsql://zerosoft-yourorg.turso.io
TURSO_AUTH_TOKEN=...   # turso db tokens create <db>
```

A fun detail: the `Dockerfile` uses this same switch at build time. Next.js prerenders some pages during `npm run build`, which needs a database, so the build runs with `TURSO_DATABASE_URL=file:/tmp/build.db`: a throwaway file that never reaches the final image.

## What the code does differently

Almost nothing, and that's the point. The differences that do exist are deliberate:

- **PRAGMAs only run locally.** On a file, the app turns on `foreign_keys`, sets `busy_timeout = 5000` (wait up to 5 seconds for a lock instead of failing) and switches to `journal_mode = WAL`. On a remote database, the server owns those settings, so the app doesn't send them.
- **The data directory is only created locally.** `data/` gets a `mkdir -p` when the URL is a file.

Everything else goes through one small wrapper. The app was originally written against `better-sqlite3`, which is synchronous. libSQL's client is async: it has to be, since the remote case is a network call. Rather than rewrite every query, `getDb()` returns a shim with the same shape (`prepare(sql).get/all/run`) where every method returns a promise. It also copies libSQL's row objects into plain JS objects, so they can be passed from React Server Components to client components without surprises. For multi-statement work that has to be atomic, code opens an interactive transaction with `getClient().transaction()` and wraps it with `txDb(tx)`, same interface.

Migrations run the same way on both: lazily, before the first query, one list for every database. ([More on that](/blog/migraciones-versionadas-sin-orm).)

## The real difference: where the bytes live

Same code doesn't mean same behavior. The tradeoffs are physical.

**Latency per query.** A local file is in-process: a query is a function call, no network. A Turso query is a round trip. That's fine for one query, but it multiplies. Some screens run several queries in sequence, and a few do a query per row (listing webhooks fetches each one's last delivery separately, for example). On a file, nobody notices. Over a network, those add up. If you go remote, put the app and the database in the same region: it matters more than any query optimization.

**Where the app can run.** A file needs a persistent disk and, realistically, a single app process writing to it. That's a VPS or a container with a volume. Serverless platforms like Vercel give you neither a durable filesystem nor a single instance, so there the database *must* be remote. That's the reason zerosoft Cloud uses Turso.

**Concurrent writes.** SQLite has one writer at a time. Locally, `busy_timeout` makes concurrent writers wait their turn instead of erroring, and WAL lets reads continue during writes. With Turso, the server serializes writes for you, and many app instances can connect at once.

**Backups and operations.** A file is yours to back up: the [Docker guide](/blog/self-hosting-con-docker-paso-a-paso) shows how to do it safely while the app is running. Turso is a managed service: backups and restore are part of the platform (check their docs for what your plan includes). You trade a cron job for a vendor.

**Cost.** A file costs whatever your disk costs. Turso has a free tier and paid plans beyond it: check their current pricing page rather than trusting a number in a blog post.

## Moving between them

Because both sides are SQLite-compatible, moving is a data copy, not a migration project.

From a local file to Turso, stop the app (so the WAL is flushed into the main file), then let the Turso CLI create a database from the file:

```bash
sqlite3 data/zerosoftware.db "PRAGMA wal_checkpoint(TRUNCATE);"
turso db create zerosoft --from-file data/zerosoftware.db
```

From Turso back to a file, dump and load:

```bash
turso db shell zerosoft .dump > zerosoft.sql
sqlite3 data/zerosoftware.db < zerosoft.sql
```

Flags change between CLI versions, so run `turso db create --help` before relying on ours. Either way, point the env vars at the new location, start the app, and the migration runner sees the existing `schema_migrations` table and does nothing.

That's also the honest answer to "what if Turso goes away?": your data is a SQLite database. Dump it, and you're back on a file.

## How to choose

Use a **local file** if:

- You're self-hosting on one VPS or one machine.
- You want zero external dependencies and the lowest possible latency.
- You're fine owning backups (one nightly command, tested once in a while).
- You need it to work offline or air-gapped.

Use **Turso** if:

- You deploy to serverless (Vercel and friends) or run more than one app instance.
- You'd rather have managed backups and restore than run them yourself.
- Your app and your database can live in the same region.

What we don't do yet: libSQL also supports embedded replicas (a local copy that syncs from a remote primary), which could combine fast local reads with a remote source of truth. zerosoft doesn't use them today. And there's no Postgres option; the whole codebase speaks SQLite.

One codebase, one env var, and your data in a format you can always take with you. Start on the file. Move when you have a reason to.
