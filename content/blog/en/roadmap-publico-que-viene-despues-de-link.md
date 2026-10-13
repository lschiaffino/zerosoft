---
title: "Our public roadmap: how we decided what came after Link"
description: "We published the roadmap with quarters and criteria. What we planned after Link, how we chose the order, and where to follow it now."
date: "2026-06-06"
author: "zerosoft"
tags: ["roadmap", "open source", "link", "coming soon"]
---

*Update: Track, CRM and Cal have all shipped, and the suite is now eleven apps. The current roadmap lives at /roadmap. This post is kept as it was planned, with the dates we committed to.*

In traditional SaaS, the roadmap is a classified document that leaks once a year during a keynote, between smoke machines and epic music. Users find out about features when those features show up on the invoice.

We can't operate that way. The code is open: anyone can see what we're working on by reading the repos. Hiding the roadmap while being open source would be like hanging curtains in a glass house. So we publish the whole thing: quarters and criteria included.

## What's coming, in order

- **Track: Q4 2026.** Our project manager. Issues, cycles, keyboard-first, roadmaps. Think Linear, but open source and $0 self-hosted. It's in construction now.
- **CRM: Q1 2027.** Contacts, pipeline, activity. The HubSpot that doesn't charge you per stored contact. API-first, like everything we make: it ships with its public API documented from day one.
- **Cal: Q2 2027.** Scheduling. Your availability, a public link, events landing on your calendar. The Calendly that doesn't charge $12 per user for two components.

All three inherit Link's contract: open code, free self-hosting with SQLite on a $5 VPS, cloud at real infrastructure cost, full export in JSON/CSV/API.

## How we pick the order

No dice involved. Three criteria, in this order:

1. **Where the invoice hurts most.** We measure the ratio between what the market charges and what the infrastructure costs. A CRM charges around $50 per user for storing contacts in a table; a link shortener charged $35 for 300-byte redirects. The more absurd the margin, the sooner we attack it.
2. **What builds on what.** Track needs a projects-and-permissions base that CRM and Cal will reuse later. Building in this order is cheaper and faster than the reverse.
3. **What the community asks for.** Repo issues and discussions are public, and they carry weight. If a thousand people ask for whatever sits at number five, it moves up.

## Why publishing it helps us (and you)

A public roadmap does three things a secret one can't:

- **It gives us a deadline.** If we say "Q4 2026" in public, Q4 2026 is real. Free accountability: a commitment to strangers focuses the mind better than a hundred internal meetings.
- **It lets you plan.** If your company is about to renew a two-year scheduling contract, you deserve to know a $0 alternative lands in Q2 2027. Hiding that would be doing you the harm we criticize others for.
- **It invites correction.** A private roadmap only gets corrected in hindsight. A public one gets arguments before the mistake is made.

What about competitors? They already know what we're doing: the code is on GitHub. The only party left out by a secret roadmap is the user. That math doesn't work.

## What we don't promise

Quarters are quarters, not days. You won't see "Track ships October 14th at 9 AM" because we don't know; pretending would be the first hype of a long series. If something slips, you'll read it on this same roadmap, with the reason. No dramatic post-mortems: it moved, here's why, here's the new window.

We also don't promise frozen feature lists. Each product's short list is in its dedicated post, but the final detail is decided by real usage and the community, not by a year-old mockup.

## How to follow it (and move it)

The roadmap lives at zerosoftware.ai/roadmap and in the repos: every item links to its issues. Vote by commenting, propose new features, or just build them: PRs are the fastest way to move a priority.

Link was the proof that the model works: open source software, a cloud you can leave, no lock-in. Track, CRM, and Cal are the proof it wasn't luck. The order is set, the windows are public, and so is the board. See you in Q4.
