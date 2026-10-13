---
title: "What's inside a $30-per-user project tool"
description: "A project tool is a database, a drag-and-drop interface and a login. We list each part, what it costs to run, and where the rest of the price comes from."
date: "2026-07-03"
author: "zerosoft"
tags: ["saas", "pricing", "track"]
---

Open your project tool. Cards move between columns. There's a text field with formatting, assignees, dates, labels and notifications. Some of these tools charge around $30 per user per month. Here's what that buys, part by part.

## The parts

1. **A database.** Postgres or similar, with tables for projects, tasks, users and comments. Cost per active user: cents.
2. **A drag-and-drop frontend.** React and a drag-and-drop library. Written once, served to everyone.
3. **A login.** Google OAuth, a solved problem for over a decade.
4. **A server.** A $20 VPS can run this for hundreds of small teams.

Adding a user is an `INSERT` into a table. There's no stock and no shipping.

## Where the rest of the price comes from

- **Habit.** The first tools set a price and buyers got used to it.
- **Switching cost.** Your projects, history and workflows are inside, and moving them takes work. The price tracks the cost of leaving.
- **Copying.** When one vendor proved a per-seat price worked, the category followed.
- **Sales and marketing.** Part of every subscription pays for the ads that found the next customer.

## A quick test

Ask what it costs to run the tool yourself. An open source project tool on a $5/month VPS serves a whole team, with no user limit and your data on your server. The gap between $5 and $30 × 10 users is margin.

## Track

Track is our project tool: issues, sub-issues, relations, cycles, estimates and four views (list, board, calendar and Gantt). It has gaps; [the comparison with Linear](/blog/zerosoft-track-vs-linear) lists them. Self-hosting costs $0. On zerosoft Cloud seats are free and you pay for usage beyond the free tier.
