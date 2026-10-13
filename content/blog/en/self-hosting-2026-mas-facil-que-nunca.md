---
title: "Self-hosting in 2026: a $5 VPS and three commands"
description: "Containers, managed DNS and SQLite made self-hosting a small job. What it takes today, and when it still isn't worth it."
date: "2026-07-11"
author: "zerosoft"
tags: ["self-hosting", "open source", "tutorial"]
---

For years, the SaaS answer to self-hosting was always the same: "sure, you can run it yourself, but who wants that pain". Servers to configure, databases to maintain, certificates, backups, updates. It was true: it was a pain.

That truth got old. In 2026, self-hosting a well-made app is easier than setting up your printer.

## What changed

Three things collapsed the difficulty:

1. **Containers won.** Docker and its successors package an entire app (code, runtime, configuration) into something that starts with one command. You no longer "install" software: you *run* it.
2. **VPSs got cheap and simple.** Hetzner, DigitalOcean, Fly.io, Railway: a server in two minutes, $5 a month, with automatic snapshots and private networks.
3. **Software got designed for this.** Good modern apps treat self-host as a first-class citizen: a single embedded database (SQLite), documented environment variables, zero mandatory external services.

## The proof: Link in three commands

Our link shortener runs like this:

```bash
git clone https://github.com/lschiaffino/zerosoft && cd zerosoft
cp .env.example .env
docker compose up -d
```

No database to install (SQLite creates itself). One Node process and one data file. The backup is copying that file.

Login? Google OAuth with two environment variables. HTTPS? Caddy or your favorite proxy in ten lines. Updates? `git pull && npm run build`.

## What you actually have to maintain

Let's be honest: self-hosting isn't *zero* work. In a well-designed app, it's:

- An `apt update` once in a while.
- Checking the backup exists (or automating it: a one-line cron).
- Updating the app when something you want ships.

That's less time per year than you spend fighting plan changes, price increases and features your vendor moved to another tier.

## And if you don't want even that

That's what the other option is for: we run it for you on zerosoft Cloud, with a free tier and usage pricing. But the important point isn't that you choose self-host. It's that you *can*. An open door changes the entire relationship: you're no longer trapped, you're choosing.

The goal isn't that everyone runs servers. It's that nobody is stuck with a vendor.
