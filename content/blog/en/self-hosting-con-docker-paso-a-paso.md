---
title: "Self-hosting zerosoft with Docker, step by step"
description: "From a blank VPS to a running zerosoft with HTTPS, Google login, backups, updates and the cron job people forget. Every command."
date: "2026-07-29"
author: "zerosoft"
tags: ["self-hosting", "docker", "tutorial"]
---

We already argued that [self-hosting in 2026 is easier than ever](/blog/self-hosting-2026-mas-facil-que-nunca). This post is the boring, useful sequel: the exact steps to go from an empty VPS to a zerosoft instance you'd trust with your team's links, contacts and bookings.

It assumes a Linux VPS with Docker and Docker Compose installed, a domain you control, and about an hour. We'll use `zs.example.com` as the hostname: swap in yours.

## 1. Clone and look at what you're running

```bash
git clone https://github.com/lschiaffino/zerosoft && cd zerosoft
cp .env.example .env
```

Three files matter. The `Dockerfile` builds a Node 24 image in three stages, runs as a non-root user (`zerosoft`, uid 1001) and declares two volumes: `/app/data` and `/app/public/uploads`. The `docker-compose.yml` runs one service, maps port 3000 and mounts two named volumes, `zerosoft-data` and `zerosoft-uploads`. And `.env` is where all configuration lives.

That's the whole stack. One container, no Postgres, no Redis, no queue workers. The database is a single SQLite file at `/app/data/zerosoftware.db`, created and migrated automatically on first start.

## 2. Set up Google OAuth

zerosoft only does Google login ([here's why](/blog/por-que-solo-login-con-google)), so you need OAuth credentials before anyone can sign in.

In the Google Cloud console, go to APIs & Services → Credentials, create an OAuth client of type "Web application", and add these authorized redirect URIs:

```
https://zs.example.com/api/auth/callback/google
https://zs.example.com/api/integrations/gmail/callback
https://zs.example.com/api/integrations/google-calendar/callback
```

The first one is login. The other two are only needed if you want the CRM's Gmail integration or Cal's Google Calendar sync, in that case also enable the Gmail API and Google Calendar API in the project.

One thing to know: zerosoft doesn't have an email allowlist. Anyone with a Google account who can complete your OAuth flow can create an account on your instance. If you're on Google Workspace, set the consent screen's user type to **Internal** and only people in your organization can sign in. Otherwise, keep the URL to yourself and check Google's current rules for consent screens in testing vs. production.

## 3. Fill in `.env`

Here's a sane production `.env`:

```bash
NEXTAUTH_URL=https://zs.example.com
NEXTAUTH_SECRET=        # openssl rand -base64 32
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
SHORT_DOMAIN=zs.example.com
DEMO_MODE=false
CRON_SECRET=            # openssl rand -hex 32
ENCRYPTION_KEY=         # openssl rand -base64 32
RESEND_API_KEY=         # optional: without it, emails are only logged
EMAIL_FROM=cal@example.com
```

A few notes from reading the code:

- **`DEMO_MODE`** turns every visitor into a shared demo user. The image runs with `NODE_ENV=production`, where demo mode is ignored unless you also set `DEMO_MODE_ALLOW_PRODUCTION=true`. Set it to `false` anyway; future-you will thank you.
- **`ENCRYPTION_KEY`** encrypts OAuth tokens and webhook secrets at rest (AES-256-GCM). If unset, it's derived from `NEXTAUTH_SECRET`. Either way: if you rotate it, stored tokens can no longer be decrypted and integrations need reconnecting. Back up `.env` together with the database: a backup without its key is half a backup.
- **`RESEND_API_KEY`** is what makes Cal's confirmation and reminder emails actually go out. Without it, they're written to the container logs.
- **Leave `TURSO_DATABASE_URL` empty.** Empty means local SQLite file. If you'd rather use a remote Turso database, that's [a separate decision](/blog/un-codigo-sqlite-local-o-turso).

## 4. Start it

```bash
docker compose up -d --build
docker compose logs -f
```

The first build takes a few minutes. When it's up, `curl -I http://localhost:3000` from the VPS should answer.

Before going further, one hardening tweak to your local `docker-compose.yml`: change `"3000:3000"` to `"127.0.0.1:3000:3000"`. Docker publishes ports by writing its own firewall rules, which can bypass `ufw`. Binding to localhost means only your reverse proxy can reach the app.

## 5. HTTPS with a reverse proxy

Any proxy works. Caddy is the shortest path because it gets certificates on its own:

```
zs.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Point your DNS A record at the VPS, reload Caddy, done.

If you use Nginx instead, set `proxy_set_header X-Forwarded-For $remote_addr;` rather than appending. zerosoft's per-IP rate limits read the first address in `X-Forwarded-For`, and an appended header lets a client put whatever it wants in that first slot. Caddy doesn't trust incoming forwarding headers from unknown clients by default, so it's fine out of the box.

## 6. The cron job (don't skip this)

Some work in zerosoft happens on a schedule, and it all goes through one endpoint: `GET /api/cron/tick`. Each tick sends due Cal reminders, retries failed webhook deliveries and fires CRM workflow triggers for tasks that just became due.

On Vercel, Vercel Cron calls it. On your VPS, nobody will unless you tell them to. In production, the endpoint refuses to run without `CRON_SECRET` and requires it as a Bearer token:

```bash
# crontab -e
*/5 * * * * curl -fsS -H "Authorization: Bearer YOUR_CRON_SECRET" https://zs.example.com/api/cron/tick > /dev/null
```

Every five minutes is a reasonable default: reminders and webhook retries are only as punctual as your tick.

## 7. Backups

Your data lives in two Docker volumes. Compose prefixes them with the project name (the directory name by default), so check with `docker volume ls`, with a `zerosoft` directory they're `zerosoft_zerosoft-data` and `zerosoft_zerosoft-uploads`.

The database runs in WAL mode, so copying the file while the app is writing isn't guaranteed to be consistent. Use SQLite's online backup instead, from a throwaway container:

```bash
mkdir -p /srv/backups
docker run --rm -v zerosoft_zerosoft-data:/data -v /srv/backups:/backups alpine \
  sh -c 'apk add -q sqlite && sqlite3 /data/zerosoftware.db ".backup /backups/zerosoftware.db"'
docker run --rm -v zerosoft_zerosoft-uploads:/u -v /srv/backups:/backups alpine \
  tar czf /backups/uploads.tgz -C /u .
```

Put that in a nightly script, add a date to the filenames, and ship `/srv/backups` off the machine (object storage, another server, your laptop). A backup on the same disk is a copy, not a backup. And restore it once on a test box: an untested backup is a hope.

## 8. Updates

```bash
# back up first, then:
git pull
docker compose up -d --build
```

You don't run migrations by hand. On boot, the app compares the migrations in the code against a `schema_migrations` table and applies the pending ones before the first query runs ([how that works](/blog/migraciones-versionadas-sin-orm)). That's also why the backup goes first: migrations only move forward.

## What you've got

One container, two volumes, one cron line, one proxy block. Links, CRM, Cal, Track, Chat and Docs on your own hardware, with your data in a file you can copy anywhere.

What you don't get is someone else watching it. Uptime, OS patches, disk space and restore drills are yours now. If that trade sounds bad, zerosoft Cloud exists for exactly that reason: same code, a free tier, and per-workspace usage pricing with free seats. If it sounds good, welcome. Your server, your rules.
