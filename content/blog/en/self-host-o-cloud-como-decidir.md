---
title: "Self-host or Zerosoft Cloud? An honest checklist"
description: "Self-hosting Zerosoft is free and one docker compose away. Running it well is a list of small jobs: HTTPS, Google OAuth, email, cron, backups, custom domains. Here's the list, so you can decide."
date: "2026-08-30"
author: "Zerosoftware"
tags: ["self-hosting", "cloud", "guide"]
---

We say it everywhere: self-hosting Zerosoft costs $0, forever. That's true, and it's not the whole truth. The software is free. The hour you spend on a broken reminder email at 11 p.m. is not.

This post is the checklist we'd want if we were deciding. No sales pitch for either side: we make money when you pick the cloud, and we built every product to run on your own server anyway. Pick the option whose chores you'd rather own.

## What "self-host" actually means here

The starting point is genuinely small:

```bash
git clone https://github.com/lschiaffino/zerosoft && cd zerosoft
cp .env.example .env
docker compose up -d
```

One container, one Node process, a SQLite file in the `zerosoft-data` volume and attachments in `zerosoft-uploads`. Database migrations run on their own when the app starts. No Postgres, no Redis, no queue workers.

That gets you a running app on port 3000. Getting from "running" to "my team relies on it" is the checklist below.

## The checklist

### 1. HTTPS and a reverse proxy

The container speaks plain HTTP. You put a reverse proxy in front — Caddy, nginx, Traefik, whatever you know — and give it a certificate. With Caddy that's a few lines and automatic certificates. Set `NEXTAUTH_URL` to the public HTTPS address, because login callbacks depend on it.

**Effort:** an hour the first time, near zero afterwards.

### 2. Google OAuth (the only login)

Zerosoft's login is Google OAuth. `DEMO_MODE` is for exploring, and it's ignored in production unless you explicitly force it — don't. So you need a Google Cloud project with `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and the redirect URI `<NEXTAUTH_URL>/api/auth/callback/google`.

If you want the CRM's Gmail sync or Cal's Google Calendar sync, add their callbacks (`/api/integrations/gmail/callback`, `/api/integrations/google-calendar/callback`) and enable the Gmail and Calendar APIs. Gmail read access is a sensitive scope on Google's side: for an app used only inside your own Google Workspace it's usually painless; for anything wider, check Google's current verification rules before you promise it to anyone.

**Effort:** 30–60 minutes of clicking through Google Cloud Console. Annoying once.

### 3. Email that actually arrives

Booking confirmations, host notifications, 24h reminders, cancellation emails and CRM workflow emails go out through Resend when `RESEND_API_KEY` and `EMAIL_FROM` are set. Without them, emails are **logged to the console** — the app works, and nobody gets anything. That's the most common "it's broken" that isn't.

You'll need a Resend account and a sending domain verified with the DNS records they give you.

**Effort:** 20 minutes plus waiting for DNS.

### 4. The cron job

Some work happens on a timer: Cal's reminders, webhook retries, and the CRM's `task_due` workflow trigger. All of it runs through one endpoint, `/api/cron/tick`. On our cloud, Vercel Cron calls it every hour. On your server, *you* call it, with the secret:

```bash
# crontab -e
17 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://zs.example.com/api/cron/tick > /dev/null
```

In production the endpoint refuses to run without `CRON_SECRET` set. Forget this step and nothing crashes — reminders just quietly never go out.

**Effort:** 5 minutes. Easy to forget, which is why it's on the list.

### 5. Backups and restores

Your data is two volumes plus your `.env`. Backing it up properly is not hard, but "copy the file" is not the full story for a live SQLite database in WAL mode. We wrote a whole post on it: [backups that actually work](/blog/backups-que-funcionan). Read it before you put real customers in your CRM.

**Effort:** an hour to set up, ten minutes a quarter to test a restore. The test is the part people skip.

### 6. Custom domains for Link

On our cloud, `go.yourcompany.com` gets HTTPS automatically. Self-hosted, domains are verified by DNS (a CNAME or A record pointing at your server) — but the certificate for each custom domain is your reverse proxy's job. Caddy's on-demand TLS or a manually added certificate both work. If extra hostnames serve the app itself, list them in `APP_HOSTS` so they aren't mistaken for short-link domains.

**Effort:** small per domain, but it's another moving part.

### 7. Updates and the server itself

`git pull`, rebuild the image, restart. Migrations apply themselves. Plus the boring server stuff: OS updates, disk space, someone noticing when it's down. Our status page lists services but live monitoring isn't wired up yet — on your server, monitoring is yours anyway.

**Effort:** minutes a month, as long as someone owns it.

### 8. File uploads

Attachments in Chat, Track and CRM tasks go to the `zerosoft-uploads` volume, up to 10 MB each. Nothing to configure — just remember it's part of the backup.

## When self-hosting is the right call

- Someone on the team is comfortable with a Linux box and will own it.
- Your data has to stay on infrastructure you control — for a client contract, a regulator or plain principle.
- You want to modify the code. (Read [why AGPLv3](/blog/por-que-agpl) for what that implies.)
- You'd rather spend an afternoon once than pay anything, ever.

## When the cloud is the right call

- Nobody wants to be on call for a server, and that's a reasonable decision.
- You need email, cron, HTTPS on custom domains and backups to just exist, today.
- You're a non-technical team and the checklist above made you tired.

Zerosoft Cloud starts with a generous free plan; past that, you pay for usage — what scales — never seats, with transparent prices published before we ever charge you. We're not putting numbers in this post because the honest number to compare is your own time.

## Switching later: what's portable today

Be clear-eyed about this, because it's where self-host vs cloud decisions get sticky:

- **Link:** exportable — JSON via the API and CSV per link.
- **CRM:** full CSV/JSON export (admin-only), and CSV import with mapping and dedupe on the other side.
- **Track, Cal, Chat, Docs:** no export feature yet. Chat conversation export and Docs JSON/Markdown export are known gaps.
- **Self-hosted:** the SQLite file *is* the export. Everything is in it, readable with any SQLite tool.

There's no one-click "move my workspace from cloud to server" (or back) today. If portability across both is a hard requirement, start where you intend to stay — or start self-hosted, where you hold the whole file.

## The short version

Self-host if you have an owner for it and a reason to want it. Use the cloud if you'd rather not think about cron jobs. Both are the same code, and that's the point: whichever you pick, the other door stays open.
