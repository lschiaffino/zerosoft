---
title: "Why we charge the cloud at cost (and exactly how it works)"
description: "Our full model on one page: software is $0, infrastructure is passed through at cost, zero margin. The math and the uncomfortable questions, answered."
date: "2026-07-13"
author: "Zerosoftware"
tags: ["model", "pricing", "cloud"]
---

Every time we explain the model, the first reaction is the same: "so what's the catch?". So here it all is, complete, with open math and answers to the uncomfortable questions.

## The model in three lines

1. **Software is $0.** All the code is open source. Download it, run it, modify it. Free forever, no user limits.
2. **The cloud is charged at cost.** If you'd rather we run it for you, you pay exactly what the infrastructure costs: servers, databases, bandwidth, backups. No margin.
3. **The bill is open.** We publish how it's calculated. You can verify it against the public prices of cloud providers.

## An example with real numbers

A 25-person team using Link on our cloud:

- A shared server serving ~500 teams like yours: $40/month → **$0.08 per team**.
- Managed database (proportional share): **~$0.60**.
- Bandwidth and backups: **~$0.30**.

Total: **~$1 per month per team**. That's what you pay. Not a promise: arithmetic.

## The uncomfortable questions

**How does Zerosoftware sustain itself?**
The cost of building the software is absorbed by us (and the open source community that joins). The cost of running it is paid by cloud users, at cost. There's no margin because we don't need one: software stopped being the business.

**What if cloud prices go up?**
Your bill goes up by exactly what the cloud goes up. And it goes down when it goes down. It's a cost pass-through, not a price: in both directions.

**What if Zerosoftware shuts down?**
You take your data and the full code and run it elsewhere in an afternoon. That's why we insist so much on self-host: it's the guarantee you'll never be trapped with us, or with anyone.

**And support?**
The open source community first. If you need more, we offer support as a separate service — charged as a service, not disguised as a software license.

## Why nobody did this before

Some tried. The problem was that building software was extremely expensive, and someone had to pay those salaries. The equation changed: today you can build in weeks what used to take years. When the cost of creating software collapses, charging for it as if nothing happened stops being a business and becomes a museum.

Software is dead. What's left is honesty and cents of cloud.
