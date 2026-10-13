---
title: "How zerosoft Cloud is priced"
description: "The software is AGPLv3 and costs $0 to self-host. The cloud has a free tier and then charges per workspace for usage. The details, and the questions people ask."
date: "2026-07-13"
author: "zerosoft"
tags: ["model", "pricing", "cloud"]
---

The first question about our model is usually "what's the catch?". Here's the whole thing.

## The model

1. **The software costs $0.** All the code is AGPLv3. Download it, run it, change it. No user limits.
2. **zerosoft Cloud charges for usage, per workspace.** There's a free tier. Past it, you pay for what you consume: clicks, bookings, emails and storage.
3. **Seats are free.** Add the whole company. The bill moves with usage, not headcount.
4. **AI is billed by tokens,** at the model provider's price ×1.2.

## Why usage and not seats

What costs us money is compute, storage, bandwidth and email delivery. A person logging in costs close to nothing. So we bill the things that cost something. A short link that gets clicked a million times uses more server than a team of fifty that rarely opens the dashboard.

When this post was first published, the plan was to charge the cloud strictly at cost. We moved to per-workspace usage pricing because it's easier to predict and to read on an invoice. The principle is the same: you pay for the machine you use.

## Questions

**How does zerosoft pay for itself?**
Cloud usage beyond the free tier, and Enterprise licenses with direct support for the features in `/ee`.

**What if cloud prices go up?**
Usage prices are published before you're charged for anything. If they change, we announce it first.

**What if zerosoft shuts down?**
You take your data and the code and run it on your own server. That's why self-hosting gets as much attention as the cloud: you're never stuck with us.

**And support?**
The open source community first, through GitHub issues. Direct support comes with an Enterprise license.

## Why now

Building software used to be expensive enough to justify high subscription prices. AI tools cut that cost a lot. What's left is the cost of running it, and that's what we charge for.
