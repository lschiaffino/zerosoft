---
title: "The real cost of the cloud, in public numbers"
description: "A VPS costs $5. A GB of storage costs cents. Bandwidth comes by the terabyte. All of this is public — and it's exactly what SaaS doesn't want you to add up."
date: "2026-06-10"
author: "Zerosoftware"
tags: ["costs", "cloud", "transparency"]
---

Cloud prices are public. Anyone can open any provider's pricing page and see what a server, a GB of storage, or a terabyte of traffic costs. Almost nobody does. The SaaS industry built its margins on that laziness. Let's do the math.

## The price list everyone can read

| Resource | Typical public price |
| --- | --- |
| VPS (1 vCPU, 1GB RAM, 25GB disk, 1TB transfer included) | $5/month |
| Object storage | ~$0.02 per GB/month |
| Extra bandwidth | cents per GB (and 1TB already included) |
| Custom domain | ~$10/year |
| SQLite as the database | $0 |

With that table you can run, literally, most of the tools your company uses: links, CRM, analytics, calendar. The infrastructure cost of a product like Link for a heavy user — 100,000 clicks a month — lands under $1/month. We did that math in detail in another post, and the conclusion is always the same: infrastructure stopped being the cost years ago.

## So what does SaaS charge for?

The margins are public too: SaaS companies' financial reports show gross margins around 70-80%. In other words, out of every $100 you pay in subscription, $70 to $80 are not infrastructure or service: they are margin. Marketing, sales, offices, growth.

Product by product:

- The link shortener charges $35/month for something that costs under $1 to serve.
- The CRM charges ~$50 per user to store contacts in a table.
- The project manager charges ~$30 per user to move cards between columns.

Markups of 10x to 50x over the real cost of serving the product. It's not illegal or secret. It's simply uncomfortable to look at up close, which is why almost nobody looks.

## Why we publish our formula

Zerosoftware works the other way around. The software is open source and free: download it and run it wherever you want. And if you choose the cloud, you pay the cloud at cost. The formula is public and boring:

> Price = real allocated infrastructure + taxes and payment fees. Margin: $0.

We publish it first to protect ourselves from ourselves. If someone at this company ever wants to inflate a price, they'll have to publicly explain why they're deviating from the formula. Transparency is not a brand value: it's a control mechanism.

And it protects you. You can audit the price against the cloud's public price list, the same way you audit the code. And if any number doesn't add up, self-hosting is waiting with the same software, the same code, and your database in a single file.

Cloud prices were always public. The only thing missing was someone willing to add them up out loud.
