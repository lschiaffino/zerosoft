---
title: "SQLite is enough for apps like ours"
description: "The most deployed database runs in your phone, your browser and Link. Millions of rows, WAL mode, and backups that are a file copy."
date: "2026-06-12"
author: "zerosoft"
tags: ["sqlite", "self-host", "architecture"]
---

Saying out loud that your app runs on SQLite triggers a predictable reaction: the "that's a toy database" face. It's the opposite. SQLite is the most deployed and most tested database in the world: it's in every iPhone, every Android, every browser, every TV. Billions of instances in production. The "toy" has more flight hours than any other piece of data software ever written.

## What SQLite can do today

- **WAL mode.** With Write-Ahead Logging, reads don't block writes and writes don't block reads. Hundreds of concurrent readers while data is being written.
- **Volume.** Millions of rows are routine. A SQLite database's theoretical limit is 281 TB. A full year of Link analytics fits in a few GB.
- **Speed.** It runs in-process, inside your app: no network, no socket, no latency hop between query and data. Many queries answer faster than against a Postgres in another container.
- **Backups.** `cp link.db backup.db`. End of runbook. With Litestream, continuous replication to object storage for cents.
- **Battle-tested.** sqlite.org itself runs on SQLite. Its own docs say it handles sites up to ~100,000 requests a day without drama, and that's conservative.

## Why Link uses SQLite

Link's workload is SQLite paradise: a redirect is a primary-key `SELECT` plus a small `INSERT`. Read-heavy, write-light, single server. A heavy user's entire database (hundreds of thousands of clicks) is tens of megabytes.

For the self-hoster, the difference is brutal: there is nothing to install. There's no Postgres to configure, Redis to tune or six-service docker-compose, no persistent volume to map. Download Link, run it, done. One process, one file.

And that file is everything: your database, your backup and your exit plan. If you ever leave, you take `link.db` with you and you have all your data, complete, readable and portable. No proprietary dump, no exporter locked behind a paid tier.

## When you DO need Postgres

Heresy has limits, and naming them is part of being honest:

- **High concurrent writes.** SQLite has a single writer. If your app inserts thousands of rows per second from many processes, you need a network database.
- **Multiple writing nodes.** If you scale horizontally with several app servers, you need Postgres (or an equivalent).
- **Specific features.** Row-level security, logical replication, extensions like PostGIS: the Postgres ecosystem has no rival.

That said: your CRM, your link shortener, your internal dashboard are nowhere near those limits. They live on a $5 VPS with traffic to spare. Choosing Postgres "just in case" means paying complexity today for a problem that may never arrive. And if it does arrive, starting with SQLite wasn't a dead end: your database is a file, and exporting it is a one-afternoon script.

Start simple. The scale you imagine is probably not the scale you have.
