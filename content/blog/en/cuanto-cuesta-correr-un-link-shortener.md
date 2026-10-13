---
title: "What it costs to run a link shortener: the full math"
description: "Bitly charges $35 a month. We priced redirects, analytics and storage on Link's real architecture. It comes to cents."
date: "2026-07-09"
author: "zerosoft"
tags: ["link", "costs", "cloud"]
---

Bitly charges $35 per month for its basic paid plan. Let's see what exactly those $35 buy: redirects (301/302), a click counter, some charts, QR codes.

Now let's do the math of what that actually costs to serve. Real numbers, from the real architecture of Link, our shortener.

## What a redirect is, technically

A request hits `yourdomain/launch`. The server runs a `SELECT` on a database, writes an `INSERT` for the click, and returns a ~300-byte response with a `Location` header.

That's it. It's probably the lightest workload on the web. It reads one row and answers.

## The math, no tricks

Assume a heavy user: 50 active links, 100,000 clicks per month.

- **Compute.** 100,000 monthly requests are ~2.3 requests per minute. A $5/month VPS (1 vCPU, 1GB RAM) handles hundreds of requests per *second* for this. You're using under 2% of the machine. Real allocated cost: **$0.10/month**.
- **Database.** SQLite on the same VPS. 100,000 clicks are 100,000 small rows: ~20MB per month. In a year, 240MB. The VPS's 25GB disk covers a decade. Cost: **$0**.
- **Bandwidth.** 300 bytes per redirect plus the analytics page you look at. Under 100MB per month. The VPS includes 1TB. Cost: **$0**.
- **Backups.** Weekly snapshot: ~$0.50/month.

**Total: under $1 per month.** And if you have 10,000 clicks instead of 100,000, under $0.20.

## So what are the $35?

Not infrastructure. They're:

- The pretty short domain (which you can also have: they cost $10/year).
- The sales team.
- The 3,400% margin.

When something costs 35 times its cost, you're not buying technology. You're buying the absence of an alternative. Until there's an alternative.

## Our commitment

Link is open source: download it and run it on that $5 VPS. If you want us to run it (login, backups, uptime), zerosoft Cloud has a free tier, then charges per workspace for usage (clicks, bookings, emails, storage), with free seats.
