---
title: "What we took from Linear for Track, and what Linear's per-seat price adds up to"
description: "Linear is a great issue tracker: fast, keyboard-driven, built around cycles. Its price grows with every hire. Why we built Track, and what it does and doesn't do yet."
date: "2026-06-21"
author: "zerosoft"
tags: ["track", "linear", "open source"]
---

Linear is probably the best issue tracker built so far. We wrote this post when we started Track, and the opinion hasn't changed.

## What Linear gets right

- **Speed.** Optimistic updates, real-time sync, no spinners. A fast tool is a tool people keep up to date.
- **Keyboard.** `Cmd+K` and you can create, assign, move and close without the mouse.
- **Cycles.** Sprints without ceremony: plan, ship, look at what's left.

Linear showed an issue tracker can feel like a good text editor. That's hard to do.

## The bill

The Standard plan is $8 per user per month. Per year:

- Team of 10: $960.
- Team of 50: $4,800.
- Team of 200: $19,200.

What's stored is issues: title, description, status, priority and a few timestamps. The infrastructure cost per seat is cents, and the price grows with headcount.

## What Track does today

Track shipped after this post was first written. Today it has:

- Issues with custom statuses, priorities, labels, assignees, estimates and due dates.
- Sub-issues and relations (blocks, duplicates).
- Cycles.
- Four views: list, board, calendar and Gantt, plus saved views.
- Comments, attachments, an activity log and an inbox.

What it doesn't have yet: keyboard shortcuts, a public API, real-time sync and velocity charts. When we started we promised the first two from day one. We didn't deliver them yet, and [the Track vs Linear comparison](/blog/zerosoft-track-vs-linear) spells out the rest.

## What it costs

Track's code is AGPLv3. Self-hosting costs $0 for any team size. On zerosoft Cloud seats are free and you pay for usage beyond the free tier.
