---
title: "From 0 to 1: cloning a SaaS in a week"
description: "What used to take a team six months now takes days. Link was built exactly like that. When the cost of building software collapses, the price has to follow."
date: "2026-05-30"
author: "Zerosoftware"
tags: ["ai", "open source", "saas", "link"]
---

Two years ago, cloning Bitly was a six-month project: a team of three or four, a roadmap, sprints, QA, and a six-figure budget. Today, one engineer with an LLM does it in a week. That is not a prediction. It is exactly how we built Link.

## What "a week" actually covers

When we say Link was built in days, we mean all of this:

- A redirect engine that resolves a custom alias and returns the destination in milliseconds.
- A dashboard with analytics by day, referrer, country, device, browser and OS — no cookies.
- QR codes in SVG and PNG, password-protected links, expiration, max clicks, tags and a UTM builder.
- A public v1 API with Bearer API keys.
- Google-only login. No signup forms, no passwords to store.

Each of those pieces was a two-week ticket in 2019. Today it is an afternoon.

## What actually changed

It is not that AI "codes by itself". It is that 80% of the work in a standard SaaS is code that has been written a thousand times before: CRUD endpoints, migrations, validation, tests, an API key scheme, a rate limiter. That code does not need genius; it needs time. LLMs cut that time from weeks to minutes.

The senior engineer did not disappear — the role changed. Nobody types boilerplate anymore. The job is what it always should have been: deciding the architecture, reviewing, cutting features, keeping the system coherent. AI writes fast; someone still has to know what to ask for and what to reject.

The result is a brutal asymmetry: the cost of *building* a typical SaaS dropped by one or two orders of magnitude. And the cost of *running* it was already public knowledge — a VPS, a database, bandwidth measured in cents.

## The consequence nobody says out loud

If building a link shortener costs one person one week, charging $12 a month to use one is not a business. It is rent collected out of habit.

SaaS prices rested on a reasonable argument: software was expensive to build, and someone had to pay those salaries. That argument is dead. When production costs collapse, prices follow — it happened to music, to storage, to international phone calls. Software is not special.

We simply make it explicit:

1. **Self-host, $0.** Link's code is open source. Download it, audit it, run it. It is yours.
2. **Cloud at cost.** If you don't want to operate anything, we run it for you and you pay exactly what the cloud costs. No margin, not a cent more.

The week it takes to clone a SaaS is not a productivity anecdote. It is the new price of software: zero for the bits, plus whatever the servers cost. And that number is published.
