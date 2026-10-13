---
title: "Track vs Linear: what each does today"
description: "Where Linear is ahead, where Track holds up, and who shouldn't switch. Written by the people who build Track, gaps included."
date: "2026-09-08"
author: "zerosoft"
tags: ["track", "linear", "comparison"]
---

When we started Track, we wrote that [Linear is probably the best issue tracker ever built](/blog/linear-cuesta-8-track-costara-0). We still think so. That post was about price. This one is about product: what each tool actually does today, where Linear is ahead, and who should stay put.

A note before we start: the same post promised Track would be keyboard-first and have an API from day one. It isn't, and it doesn't, not yet. We'd rather say that up front than have you discover it.

## The short version

- **Linear** is the more mature, faster, more polished product, with a big integrations ecosystem. If your team is engineering-heavy and lives in GitHub, it's very hard to beat.
- **Track** covers the core of issue tracking (projects, issues, sub-issues, relations, cycles, four views) and is open source (AGPLv3), self-hostable, and part of a suite with a CRM, chat, docs and scheduling. It's a good fit for small teams that want to own their data and don't need the integrations.

Now the details.

## Where Linear is clearly ahead

**Speed and keyboard UX.** Linear's interface is built around optimistic updates and a command palette; you can do almost everything without touching the mouse. Track has no keyboard shortcuts yet. It's a normal web app: you click, it saves.

**Realtime.** In Linear, a teammate's change shows up on your screen as it happens. In Track you refresh. For a team of four that's a minor annoyance; for a team of forty triaging the same board, it's a real difference.

**Git integrations.** Linear links issues to branches, commits and pull requests in GitHub and GitLab, and can move issues automatically when a PR merges. Track has no Git integration at all. If "the PR closes the issue" is part of your workflow, that alone decides it.

**API and webhooks.** Linear has a public API and webhooks, and a whole ecosystem of tools built on them. Track has no public API or webhooks yet; its endpoints are internal and session-authenticated. (Link, CRM and Cal do have a public API; Track doesn't.)

**Planning above the issue.** Linear has roadmaps and higher-level planning across projects. Track has projects and cycles, and stops there. No roadmaps.

**Cycle tooling.** Linear's cycles come with progress tracking and automatic rollover of unfinished work. In Track, a cycle is a name and two dates; issues belong to it, and you can filter by it. There are no velocity or burndown charts, no rollover, and (today) cycles and custom statuses are created through an endpoint rather than a settings screen. We wrote a [playbook for running cycles in Track](/blog/ciclos-en-track) that's honest about the workarounds.

**Import.** Linear can import from Jira, Asana, GitHub Issues and others. Track has no Linear import, and no importer for anything else.

**Polish and breadth.** Mobile apps, a desktop app, integrations with Slack and many other tools, triage flows, years of refinement. Linear has had a lot of time and a strong team. It shows.

## Where Track holds up

**The core model is there.** Issues with title, rich description, status, priority, assignee, labels, due date, estimate and cycle. Sub-issues that are full issues. Relations (`blocks`, `related`, `duplicates`), visible from both ends. Comments with @mentions, attachments up to 10 MB, a per-issue activity log, and a notifications inbox for mentions, assignments and status changes. Custom statuses mapped to five categories (backlog, todo, in progress, done, cancelled).

**Four views out of the box.** List, board, calendar (by due date) and Gantt (drag bars to change start and due dates). Any combination of view, filters and sort can be saved as a personal view, and one can be your default.

**You can own it.** Track is AGPLv3. You can read every line, self-host it on your own server for free, and your issues live in a SQLite file (or a libSQL/Turso database) you control. Nobody can change the terms on you, sunset a plan, or keep your history from you. We wrote more about [why that matters](/blog/el-lock-in-es-el-producto).

**It's part of a suite.** The same login and team give you a CRM, a support chat, docs, scheduling and links. A sprint retro can live in Docs; a bug reported in Chat can become a Track issue by a human copying it over (there's no automatic link between them yet. We're being precise). If you're a small company trying to cut the number of tools and invoices, that counts.

**Pricing that doesn't scale with headcount.** Linear charges per seat on its paid plans and has a free plan with limits; check their pricing page for current numbers. Track self-hosted costs $0. zerosoft Cloud has a free tier, then charges per workspace for usage (clicks, bookings, emails, storage), with free seats. No per-seat line item.

## Who should stay on Linear

Be honest with yourself. Stay on Linear if:

- Your engineering team links PRs to issues and relies on that automation.
- People on your team live on the keyboard and would feel Track's lack of shortcuts every hour.
- More than a handful of people work the same board simultaneously and need realtime.
- You use Linear's API, webhooks or integrations (Slack, Sentry, support tools, and so on).
- You plan with roadmaps, or rely on cycle analytics and automatic rollover.
- You need mobile apps.

For those teams, switching to Track today would be a downgrade, and we don't want you to do it.

## Who Track is for

Track makes sense if:

- You're a small team (agency, studio, early-stage startup, internal ops team) that needs issues, cycles and a board, not an engineering platform.
- You want your data on your own server, or at least in an open-source tool you could take there.
- You already use, or want to use, other zerosoft products and prefer one stack.
- Per-seat pricing is a real cost for you, especially with occasional collaborators who only need to see the board.

## How to try it without risk

Spin up Track locally with `DEMO_MODE=true` and poke around the demo data, or create a free account on zerosoft Cloud. Run one real cycle with a small project before moving anything important. There's no Linear importer, so moving means recreating your open issues: fine for a team with fifty open tickets, painful for one with five thousand.

## The bottom line

Linear is the better product today, and for many teams it's worth every cent. Track is the honest, open, self-hostable alternative that covers the core, and that you own. We'll keep closing the gap. When keyboard shortcuts, realtime or an API land, we'll say so here, not before.
