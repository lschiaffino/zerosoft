---
title: "Bitly Core costs $35 a month. Here's what the redirects cost to serve."
description: "We go through Bitly's paid plan item by item and put each one next to the infrastructure it needs. The difference is margin, not engineering."
date: "2026-06-26"
author: "zerosoft"
tags: ["bitly", "link", "pricing"]
---

Bitly's Core plan costs $35 a month, billed annually. We went through what it includes, item by item, and priced the infrastructure behind each one.

## What the $35 includes

- **Around 1,500 branded links per month.** A link is a row: slug, destination, date, a few flags. About 100 bytes. A month of links is 150 KB, smaller than a phone photo.
- **Unlimited redirects.** Each click is a `SELECT`, an `INSERT` and a ~300-byte 302 response. A million redirects a month move under 1 GB of traffic.
- **QR codes.** An SVG or PNG generated from the URL string. No meaningful compute or storage.
- **Click analytics.** Per day, referrer, country and device. Each click is a ~200-byte row. A hundred thousand clicks a month for a year is about 240 MB. A $5 VPS comes with 25 GB.
- **A custom domain.** You register it yourself, for about $10 a year. Bitly doesn't pay for it.
- **UTM builder.** A form that appends `?utm_source=...` to a URL.

## The numbers

The infrastructure for a heavy user comes to under $1 a month. We did the full breakdown in [what it costs to run a link shortener](/blog/cuanto-cuesta-correr-un-link-shortener).

$35 against $1 is a large margin. It pays for sales, advertising and a long habit of paying for branded links.

## Link

**Link** is our shortener: custom aliases, custom domains, cookie-less analytics by day, referrer, country, device, browser and OS, QR codes in SVG and PNG, password-protected links, expiration, click limits, tags, a UTM builder, Bitly import and a public API.

The code is open. Self-hosting costs $0. On zerosoft Cloud there's a free tier, and then you pay for clicks and storage beyond it. Seats are free.
