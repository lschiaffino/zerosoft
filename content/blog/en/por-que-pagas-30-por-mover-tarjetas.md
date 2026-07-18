---
title: "Why you pay $30 to move cards"
description: "A project manager is a database, a drag-and-drop UI and a login. We take the SaaS price apart, piece by piece."
date: "2026-07-03"
author: "Zerosoftware"
tags: ["saas", "pricing", "track"]
---

Open your project management tool. What do you see? Cards moving between columns. A text field with formatting. Assignments, dates, labels. Notifications.

Now ask yourself: which part of that costs $30 per user per month?

## The anatomy of a kanban

Technically, a modern project manager is:

1. **A database.** Postgres or similar. It stores tables: projects, tasks, users, comments. Cost per active user: cents.
2. **A drag-and-drop frontend.** React, a DnD library, websockets to sync. Written once, serves millions.
3. **A login.** Google OAuth. Solved, free, for a decade.
4. **A server.** A $20 VPS runs this for hundreds of small companies.

The marginal cost of adding one more user is, literally, zero. There's no factory, no stock, no shipping. It's an `INSERT` into a table.

## So what are you paying for?

You're not paying for technology. You're paying for:

- **Habit.** "It always cost that" is not an argument — it's an inheritance.
- **Lock-in.** Your projects, your history, your workflows are inside. Migrating costs more than keep paying. The price doesn't reflect the software's value: it reflects the cost of leaving.
- **Positioning.** When the first tool set $8/user and it worked, everyone copied. That's not a market price — it's a de facto cartel.
- **Marketing.** A huge share of your subscription pays for the ads that brought you and the next customer. You pay to be sold to.

## The litmus test

There's a simple way to know if a price is honest: how much does it cost to run it yourself?

An open-source project manager on a $5/month VPS serves an entire team. No user limits. Your data on your server. The gap between $5 and $30×10 users isn't engineering: it's margin.

## That's why Track exists

Track is our project manager. Open source, fast, keyboard-first, with cycles and roadmaps. Self-hosted, it costs $0. If we run it for you, you pay the cloud at cost: a few dollars per team, not per user.

It's not cheaper because it's worth less. It's cheaper because we charge what it costs.

Software is dead. And so is its price.
