---
title: "Exporting your data should be a right"
description: "Portability isn't a premium feature: it's a right. Every Zerosoftware product ships with complete export in JSON, CSV and API from day one. Here's the test to prove it."
date: "2026-06-15"
author: "Zerosoftware"
tags: ["export", "lock-in", "open source", "link"]
---

There's one question almost nobody asks before signing up for a SaaS: how do I leave? Not whether you can — the export button exists almost everywhere — but what actually comes out through that door, and in what condition. Most of the time the answer is: less than you think, in a worse format than you need.

We start from the opposite end: exporting your data isn't a courtesy from the vendor. It's a right, and software should be born with it.

## The ten-minute test

The test is simple: can you leave in ten minutes? Not cancel the subscription — that's always easy, because it suits them — but take everything, in an open format, without talking to anyone, and rebuild your operation somewhere else the same day.

The test has four parts:

- **Complete**: everything that went in and everything that was generated along the way. If you export the links but not the click analytics, that's not an export — it's a souvenir.
- **Open**: JSON, CSV — formats that have been around for decades and that any tool can read. A proprietary file is a safe with your name on it and somebody else's key.
- **No middlemen**: no support ticket, no "contact your account manager", no 48-hour wait. A button and an API.
- **Verifiable**: you can run the test on day one, with dummy data, before migrating anything. If a product fails the test with fake data, it won't pass with yours.

## How Link exports today

Link, our shortener, passes the whole test:

- From the dashboard you export all your links — alias, destination, password, expiration, max clicks, tags, UTM parameters — in JSON or CSV, in one click.
- The analytics travel with them: every recorded click, with timestamp, referrer, country, device, browser and OS. Raw rows, not just the pretty aggregates on the dashboard.
- The v1 API exposes all of the above over HTTP with your API key. A twenty-line script downloads your entire account. No permission needed from us.
- And if you self-host, the most brutal export of all: your database is a single SQLite file. Copy it and you're done. That's portability.

## What happens out there

The market, meanwhile:

- **Slack**: on the free plan, the export covers public channels only. Your direct messages and private channels don't come out through the regular door.
- **Notion**: yes, it exports. Databases come out as flat CSVs: the relations between tables, the rollups, the structure that gave your information meaning — that doesn't travel. You take the rows; the model stays.
- And then there's the most honest tactic of all: the tools that simply have no export and redirect you to support, where a human decides when — and whether — you get your data back.

None of this is an accident. A complete export is a customer who can leave.

## Our rule: export ships with the product

At Zerosoftware the rule is single and non-negotiable: no product launches without complete export from day one. JSON and CSV from the interface, a documented public API, open formats. Link already does it. The CRM, Cal and Track — all coming soon — will open with the same guarantee the day they launch.

And the code is open source: if we ever do things wrong, you won't need the export — you'll need a $5 VPS and an afternoon.

Your data is yours. Software that doesn't get that is telling you, in advance, exactly how much leaving will cost.
