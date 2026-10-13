---
title: "The zerosoft manifesto: what work software costs to run, and what we charge"
description: "Moving cards, storing contacts and shortening links cost cents to run. We publish the code under AGPLv3 and charge for usage, not for seats."
date: "2026-07-01"
author: "zerosoft"
tags: ["manifesto", "open source", "saas"]
---

A project tool charges about $30 per user per month to move cards between columns. A CRM charges $50 to keep contacts in a table. A link shortener charges $12 to answer a redirect. Running any of those costs cents.

The price comes from somewhere else. Your team is already inside, moving out is painful, and the first vendor in each category set a number the rest copied.

## The math

A card is a row in a database. A contact is a row. A redirect is one read and one HTTP response. A $5 server handles a small company's traffic for all three, with room to spare. Bandwidth is billed by the terabyte and storage by the gigabyte, at prices anyone can look up.

Per-seat pricing ignores all of that. Hire ten people and the bill goes up, even though the server didn't notice.

## What changed

Two costs used to justify the subscription: distributing software and building it. The browser solved distribution years ago. AI tools cut the cost of building software enough that one small team can rebuild a category in weeks, not years. What's left is the cost of running it, and that has a public price.

## What we do

zerosoft rebuilds the everyday work tools as one open source suite. Today that's eleven apps: CRM, Chat, Agents, Flow, Robots, Track, Link, Docs, Notes, Cal and Board.

1. **The code is AGPLv3.** Every core feature is in the repository. Read it, run it on your own server, change it. Self-hosting costs $0.
2. **zerosoft Cloud runs it for you.** Login, backups, updates and uptime. There's a free tier, then you pay for usage per workspace: clicks, bookings, emails and storage. Seats are free. AI is billed by tokens at the provider's price ×1.2.

Because the code is public, you can always leave with your data and the software. That keeps us honest on price and on quality.

## What's missing

Each product page and the README list the known gaps next to the features. We'd rather you find them there than after a migration.

Start with one app, or [read how to self-host it](/blog/self-hosting-con-docker-paso-a-paso).
