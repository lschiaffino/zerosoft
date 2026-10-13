---
title: "What the cloud costs, from public price lists"
description: "A VPS costs $5. A GB of storage costs cents. Bandwidth is sold by the terabyte. All of it is public, and almost nobody adds it up."
date: "2026-06-10"
author: "zerosoft"
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

With that table you can run, literally, most of the tools your company uses: links, CRM, analytics, calendar. The infrastructure cost of a product like Link for a heavy user (100,000 clicks a month) lands under $1/month. We did that math in detail in another post, and the conclusion is always the same: infrastructure stopped being the cost years ago.

## So what does SaaS charge for?

The margins are public too: SaaS companies' financial reports show gross margins around 70-80%. In other words, out of every $100 you pay in subscription, $70 to $80 are not infrastructure or service: they are margin. Marketing, sales, offices, growth.

Product by product:

- The link shortener charges $35/month for something that costs under $1 to serve.
- The CRM charges ~$50 per user to store contacts in a table.
- The project manager charges ~$30 per user to move cards between columns.

Markups of 10x to 50x over the real cost of serving the product. It's not illegal or secret. It's simply uncomfortable to look at up close, which is why almost nobody looks.

## Why we publish our formula

zerosoft works the other way around. The software is open source: download it and run it wherever you want. If you choose zerosoft Cloud, there's a free tier and then per-workspace usage pricing for what costs us money: clicks, bookings, emails and storage. Seats are free, and AI is billed by tokens at the provider's price ×1.2.

We publish the prices before charging anything, so a change has to be explained in public. That's a control on us as much as a promise to you.

And it protects you. You can compare the price with the cloud's public price list, the same way you audit the code. And if any number doesn't add up, self-hosting is waiting with the same software, the same code, and your database in a single file.

Cloud prices were always public. The only thing missing was someone willing to add them up out loud.
